/**
 * Local history indexer. Executed by $.process.run([node, script], {stdin}).
 * No network, packages, shell, credentials, prompt persistence, or Claude calls.
 * Source transcripts are opened read-only. All writes are inside cacheDir.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseTranscriptRow, mergeRecord, zero, dayKeyWithFormatter, total } from '../lib/usage.js';
import { createQuotaClock, quotaSettings, quotaSignature, quotaExportLabel } from '../lib/quota.js';
import { makeView } from '../lib/view-model.js';

import { addPriced as add, priceRecord, pricingMetadata, PRICING_VERSION, COST_CSV_HEADERS, costCsvCells } from '../lib/pricing.js';

const VERSION = 1; // Keep the existing cache and its archived history.
const DETAIL_VERSION = 2; // One-time read to recover cache-write TTLs from existing logs.
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const MAX_LINE = 32 * 1024 * 1024;
const ignoredDirs = new Set(['node_modules', '.git', '.cache', 'cache', 'plugins', 'debug', 'usage-data']);
const safeError = error => typeof error?.code === 'string' ? error.code : 'READ_ERROR';
const exists = async p => { try { return await fsp.stat(p); } catch { return null; } };

async function readJson(file, fallback) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return fallback; }
}
async function atomicJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.' + process.pid + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  try {
    await fsp.writeFile(tmp, JSON.stringify(value), { mode: 0o600 });
    await fsp.rename(tmp, file);
  } finally { await fsp.unlink(tmp).catch(() => {}); }
}

export function defaultRoots(env = process.env, home = os.homedir(), platform = process.platform) {
  const config = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  const roots = [path.join(config, 'projects')];
  if (!env.CLAUDE_CONFIG_DIR) roots.push(path.join(home, '.config', 'claude', 'projects'));
  // Desktop paths are optional discovery candidates, not an invented account API.
  if (platform === 'win32' && env.APPDATA) roots.push(path.join(env.APPDATA, 'Claude', 'claude-code-sessions'));
  if (platform === 'darwin') roots.push(path.join(home, 'Library', 'Application Support', 'Claude', 'claude-code-sessions'));
  return roots;
}
function inside(file, root) {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
async function canonicalRoots(roots, cacheDir, warnings) {
  const found = [];
  for (const raw of roots) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const expanded = raw.startsWith('~' + path.sep) || raw.startsWith('~/') ? path.join(os.homedir(), raw.slice(2)) : raw;
    const p = path.resolve(expanded);
    try {
      const real = await fsp.realpath(p);
      const s = await fsp.stat(real);
      if (!(s.isDirectory() || (s.isFile() && real.endsWith('.jsonl')))) continue;
      // Never walk the index as if it were source data.
      if (inside(real, cacheDir)) continue;
      if (!found.some(r => inside(real, r))) {
        for (let i = found.length - 1; i >= 0; i--) if (inside(found[i], real)) found.splice(i, 1);
        found.push(real);
      }
    } catch (e) { if (e.code !== 'ENOENT') warnings.push({ path: p, code: safeError(e) }); }
  }
  return found;
}
async function discover(roots, cacheDir, warnings) {
  const files = new Map();
  const queue = roots.map(p => ({ p, depth: 0 }));
  while (queue.length) {
    const { p, depth } = queue.shift();
    if (depth > 12 || inside(p, cacheDir)) continue;
    try {
      const stat = await fsp.lstat(p);
      // Explicit roots were realpathed above. Do not follow nested links/junctions.
      if (stat.isSymbolicLink()) continue;
      if (stat.isFile()) {
        if (p.toLowerCase().endsWith('.jsonl')) files.set(p, { path: p, size: stat.size, mtime: stat.mtimeMs, ino: stat.ino, dev: stat.dev });
        continue;
      }
      if (!stat.isDirectory()) continue;
      const entries = await fsp.readdir(p, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isSymbolicLink() || (entry.isDirectory() && ignoredDirs.has(entry.name))) continue;
        if (entry.isDirectory() || (entry.isFile() && entry.name.toLowerCase().endsWith('.jsonl'))) queue.push({ p: path.join(p, entry.name), depth: depth + 1 });
      }
    } catch (e) { warnings.push({ path: p, code: safeError(e) }); }
  }
  return [...files.values()].sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path));
}
async function prefix(file, count) {
  const handle = await fsp.open(file, 'r');
  try {
    const buffer = Buffer.alloc(Math.max(0, Math.min(count, 1024)));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return { bytes: bytesRead, hash: hash(buffer.subarray(0, bytesRead)) };
  } finally { await handle.close(); }
}

/** Incremental byte offsets, UTF-8 boundaries, cumulative usage and partial tails. */
export async function indexFile(file, old, deadline = Infinity, force = false) {
  const reusable = old?.version === VERSION && old.source === file.path;
  const migrate = reusable && old.detailVersion !== DETAIL_VERSION;
  if (reusable && !force && !migrate && old.size === file.size && old.mtime === file.mtime && old.complete) return old;
  // Preserve already-observed counters if Claude later prunes/truncates its logs.
  const records = new Map((reusable ? old.records : []).map(r => [r.id, r]));
  let offset = reusable && !force && !migrate ? old.offset || 0 : 0;
  let malformed = reusable && !force && !migrate ? old.malformed || 0 : 0;
  let oversized = reusable && !force && !migrate ? old.oversized || 0 : 0;
  const fingerprint = await prefix(file.path, reusable ? old.prefix?.bytes || 1024 : 1024);
  if (!reusable || force || migrate || file.size < (old?.size || 0) || fingerprint.hash !== old?.prefix?.hash || (old.ino && old.ino !== file.ino)) {
    offset = 0; malformed = 0; oversized = 0;
  }
  const startOffset = offset;
  let pending = Buffer.alloc(0), dropping = false, discarded = 0, complete = true;
  const consume = (bytes, trailing = false) => {
    // Skip unrelated conversation rows before parsing. Their text is never saved.
    if (bytes.length > MAX_LINE) { if (!trailing) oversized++; return; }
    const text = bytes.toString('utf8');
    if (!text.includes('"usage"')) return;
    let row;
    try { row = JSON.parse(text); } catch { if (!trailing) malformed++; return; }
    const r = parseTranscriptRow(row, file.path);
    if (!r) return;
    const id = hash(r.identity);
    const { identity, requests, ...reduced } = r;
    // Only these approved numeric/identity fields reach the cache.
    records.set(id, mergeRecord(records.get(id), { id, ...reduced }));
  };
  if (offset < file.size) {
    const stream = fs.createReadStream(file.path, { start: offset, end: file.size - 1, highWaterMark: 64 * 1024 });
    try {
      for await (const chunk of stream) {
        pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
        let cursor = 0, newline;
        while ((newline = pending.indexOf(10, cursor)) !== -1) {
          const line = pending.subarray(cursor, newline);
          if (!dropping) consume(line);
          dropping = false;
          offset += discarded + newline - cursor + 1;
          discarded = 0;
          cursor = newline + 1;
        }
        pending = pending.subarray(cursor);
        if (pending.length > MAX_LINE) {
          if (!dropping) oversized++;
          // Keep the checkpoint at the start, but discard bytes from memory.
          // Commit all discarded bytes only when the terminating newline arrives.
          dropping = true;
          discarded += pending.length;
          pending = Buffer.alloc(0);
        }
        if (Date.now() > deadline && offset > startOffset) { complete = false; stream.destroy(); break; }
      }
      if (complete && pending.length && !dropping) consume(pending, true);
      // A valid final JSON object without '\n' is counted, but kept uncommitted
      // so an append can re-read it and deduplicate it safely.
    } finally { stream.destroy(); }
  }
  return { version: VERSION, detailVersion: DETAIL_VERSION, source: file.path, size: file.size, mtime: file.mtime,
    ino: file.ino, dev: file.dev, prefix: fingerprint, offset, complete,
    malformed, oversized, records: [...records.values()] };
}

async function acquireLock(cacheDir) {
  const lock = path.join(cacheDir, 'scan.lock');
  const owner = { pid: process.pid, token: crypto.randomBytes(16).toString('hex'), created: Date.now() };
  await fsp.mkdir(cacheDir, { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await fsp.mkdir(lock, { mode: 0o700 });
      await atomicJson(path.join(lock, 'owner.json'), owner);
      return async () => {
        const current = await readJson(path.join(lock, 'owner.json'), {});
        if (current.token === owner.token) await fsp.rm(lock, { recursive: true, force: true });
      };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const current = await readJson(path.join(lock, 'owner.json'), null);
      const stat = await exists(lock);
      let alive = false;
      if (Number.isInteger(current?.pid)) {
        try { process.kill(current.pid, 0); alive = true; } catch (err) { alive = err.code === 'EPERM'; }
      }
      // A just-created lock may not have its owner file yet. Do not steal it.
      if (alive || (!current && stat && Date.now() - stat.mtimeMs < 60000)) return null;
      await fsp.rm(lock, { recursive: true, force: true });
    }
  }
  return null;
}
export function aggregateRecords(caches, options, now = Date.now()) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: options.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const merged = new Map();
  let duplicateCopies = 0, malformed = 0, oversized = 0;
  for (const cache of caches) {
    malformed += cache.malformed || 0; oversized += cache.oversized || 0;
    for (const record of cache.records || []) {
      if (merged.has(record.id)) duplicateCopies++;
      merged.set(record.id, mergeRecord(merged.get(record.id), record));
    }
  }
  const dates = new Map(), quotaWeeks = new Map();
  const clock = createQuotaClock(options);
  let weakIdentity = 0, futureRecords = 0, subagentRequests = 0;
  for (const record of merged.values()) {
    // Future-dated records cannot enter the next quota ahead of its reset.
    // They stay cached and become eligible on a later scan.
    if (record.timestamp > now) { futureRecords++; continue; }
    if (!options.includeSubagents && record.agent) continue;
    if (record.weakIdentity) weakIdentity++;
    if (record.agent) subagentRequests++;
    const date = dayKeyWithFormatter(record.timestamp, formatter);
    if (!dates.has(date)) dates.set(date, new Map());
    const models = dates.get(date);
    if (!models.has(record.model)) models.set(record.model, { id: record.model, ...zero() });
    const priced = { ...record, requests:1, cost:priceRecord(record) };
    add(models.get(record.model), priced);
    // Assign each de-duplicated request by its timestamp, NOT its calendar day.
    // A Thursday can legitimately occur in two quota-week records.
    const period = clock.periodAt(record.timestamp, date);
    if (!quotaWeeks.has(period.id)) quotaWeeks.set(period.id, { ...period, byDate: new Map() });
    const week = quotaWeeks.get(period.id);
    if (!week.byDate.has(date)) week.byDate.set(date, new Map());
    const weekModels = week.byDate.get(date);
    if (!weekModels.has(record.model)) weekModels.set(record.model, { id: record.model, ...zero() });
    add(weekModels.get(record.model), priced);
  }
  const days = [...dates].sort(([a], [b]) => a.localeCompare(b))
    .map(([date, models]) => ({ date, models: [...models.values()].sort((a, b) => total(b) - total(a)) }));
  const weeks = [...quotaWeeks.values()].sort((a,b) => a.startMs-b.startMs).map(({ byDate, ...period }) => ({
    ...period, days: [...byDate].sort(([a],[b]) => a.localeCompare(b)).map(([date, models]) => ({
      date, models: [...models.values()].sort((a,b) => total(b)-total(a)) })) }));
  return { days, weeks, pricing:pricingMetadata(), asOf: now, quota: { ...clock.settings, signature: quotaSignature(clock.settings) },
    today: dayKeyWithFormatter(now, formatter), timeZone: options.timeZone,
    diagnostics: { duplicateCopies, malformed, oversized, weakIdentity, futureRecords, subagentRequests } };
}
function csvCell(value) {
  let s = String(value ?? '');
  // Prevent spreadsheet formulas when a model ID originated in a local file.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
export function exportCsv(snapshot, selection = {}) {
  if (selection.grouping === 'week') return exportWeeklyCsv(snapshot, selection);
  const header = ['date', 'time_zone', 'model', 'cache_read_tokens', 'cache_write_tokens', 'new_input_tokens', 'output_tokens', 'total_tokens', 'requests', ...COST_CSV_HEADERS];
  const lines = [header.join(',')];
  const source = selection.range === 'quota'
    ? makeView(snapshot, { range: 'quota', model: selection.model, grouping: 'day' }).buckets
    : snapshot.days;
  for (const day of source) {
    if (selection.start && day.date < selection.start) continue;
    if (selection.end && day.date > selection.end) continue;
    for (const m of day.models) {
      if (selection.model && selection.model !== 'all' && m.id !== selection.model) continue;
      lines.push([day.date, snapshot.timeZone, m.id, m.read, m.write, m.input, m.output, total(m), m.requests, ...costCsvCells(m)].map(csvCell).join(','));
    }
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}


function exportWeeklyCsv(snapshot, selection) {
  if (!snapshot.quota || !Array.isArray(snapshot.weeks)) throw new Error('O índice ainda não tem dados por cota semanal. Atualiza antes de exportar.');
  const view = makeView(snapshot, { range: selection.range || 'all', model: selection.model, grouping: 'week' });
  const header = ['quota_start_utc', 'quota_end_utc_exclusive', 'quota_start_local', 'quota_end_local',
    'time_zone', 'reset_day_sunday_0', 'reset_time', 'quota_status', 'range_clipped',
    'observed_from_utc', 'observed_until_utc', 'model', 'cache_read_tokens', 'cache_write_tokens',
    'new_input_tokens', 'output_tokens', 'total_tokens', 'requests', ...COST_CSV_HEADERS];
  const lines = [header.join(',')];
  for (const week of view.buckets) {
    for (const m of week.models.length ? week.models : [{ id: '', ...zero() }]) {
      lines.push([week.start, week.end, quotaExportLabel(week.startMs, view.timeZone, true),
        quotaExportLabel(week.endMs, view.timeZone, true), view.timeZone,
        view.quotaSettings.resetDay, view.quotaSettings.resetTime, week.current ? 'in_progress' : 'closed',
        week.clipped ? 'yes' : 'no', new Date(week.observedStartMs).toISOString(),
        new Date(week.observedEndMs).toISOString(), m.id, m.read, m.write, m.input, m.output,
        total(m), m.requests, ...costCsvCells(m)].map(csvCell).join(','));
    }
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

export async function scan(options = {}) {
  const started = Date.now();
  const configRoot = options.configRoot || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const cacheDir = path.resolve(options.cacheDir || path.join(configRoot, 'account-stats', 'v1'));
  const timeZone = options.timeZone || 'Europe/Lisbon';
  const reset = quotaSettings({ timeZone, resetDay: options.resetDay, resetTime: options.resetTime });
  const signature = quotaSignature(reset);
  const candidates = options.roots || [...defaultRoots(), ...(Array.isArray(options.extraRoots) ? options.extraRoots : [])];
  const scopeSignature = hash(JSON.stringify(candidates.filter(p => typeof p === 'string').map(p => path.resolve(p)).sort()));
  // Invalid zones are errors, NEVER a silent switch to UTC.
  new Intl.DateTimeFormat('en', { timeZone }).format();
  const release = await acquireLock(cacheDir);
  const snapshotFile = path.join(cacheDir, 'snapshot.json');
  if (!release) {
    const saved = await readJson(snapshotFile, null);
    if (saved && saved.pricing?.version === PRICING_VERSION && saved.timeZone === timeZone && saved.quota?.signature === signature && saved.scopeSignature === scopeSignature && saved.includeSubagents === (options.includeSubagents !== false)) return { ...saved, busy: true };
    return { version: VERSION, days: [], today: dayKeyWithFormatter(started, new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })), timeZone, busy: true, initialScan: true, cacheDir };
  }
  try {
    const warnings = [];
    const roots = await canonicalRoots(candidates, cacheDir, warnings);
    const files = await discover(roots, cacheDir, warnings);
    const recordsDir = path.join(cacheDir, 'records');
    await fsp.mkdir(recordsDir, { recursive: true, mode: 0o700 });
    const metadataFile = path.join(cacheDir, 'index.json');
    const metadata = await readJson(metadataFile, { version: VERSION, files: {} });
    const registry = metadata.version === VERSION && metadata.files ? metadata.files : {};
    const scope = new Set(roots);
    // Extra root changes must not drag another configured root's history into
    // this view. Defaults are passed consistently; removed logs within roots stay.
    const caches = new Map();
    for (const [key, info] of Object.entries(registry)) {
      if (![...scope].some(root => inside(info.path, root)) && !candidates.some(root => typeof root === 'string' && inside(info.path, path.resolve(root)))) continue;
      const cached = await readJson(path.join(recordsDir, key + '.json'), null);
      if (cached?.version === VERSION && Array.isArray(cached.records)) caches.set(key, cached);
    }
    const deadline = started + Math.max(250, Math.min(45000, Number(options.budgetMs) || 18000));
    let updatedFiles = 0, pendingFiles = 0;
    for (const file of files) {
      const key = hash(process.platform === 'win32' ? file.path.toLowerCase() : file.path);
      const old = caches.get(key);
      const force = options.reindex === true && (!old || (old.reindexedAt || 0) < (options.reindexAt || started));
      const changed = !old || old.detailVersion !== DETAIL_VERSION || !old.complete || old.size !== file.size || old.mtime !== file.mtime || force;
      if (!changed) continue;
      if (Date.now() > deadline) { pendingFiles++; continue; }
      try {
        const cache = await indexFile(file, old, deadline, force);
        if (force && cache.complete) cache.reindexedAt = options.reindexAt || started;
        else if (old?.reindexedAt) cache.reindexedAt = old.reindexedAt;
        await atomicJson(path.join(recordsDir, key + '.json'), cache);
        caches.set(key, cache); registry[key] = { path: file.path };
        updatedFiles++;
        if (!cache.complete) pendingFiles++;
      } catch (e) { warnings.push({ path: file.path, code: safeError(e) }); pendingFiles++; }
    }
    await atomicJson(metadataFile, { version: VERSION, files: registry });
    const aggregated = aggregateRecords([...caches.values()], { ...reset, includeSubagents: options.includeSubagents !== false }, started);
    const current = new Set(files.map(f => f.path));
    const snapshot = { version: VERSION, ...aggregated, generatedAt: new Date().toISOString(),
      includeSubagents: options.includeSubagents !== false, cacheDir, roots, scopeSignature,
      diagnostics: { ...aggregated.diagnostics, discoveredFiles: files.length, indexedFiles: caches.size,
        archivedFiles: [...caches.values()].filter(c => !current.has(c.source)).length,
        updatedFiles, pendingFiles, warnings: warnings.slice(0, 20), elapsedMs: Date.now() - started },
      partial: pendingFiles > 0 || warnings.length > 0, busy: false };
    await atomicJson(snapshotFile, snapshot);
    if (options.action === 'export') {
      const exportDir = path.join(cacheDir, 'exports');
      await fsp.mkdir(exportDir, { recursive: true, mode: 0o700 });
      const exportPath = path.join(exportDir, 'account-stats-' + new Date().toISOString().replace(/[:.]/g, '-') + '.csv');
      await fsp.writeFile(exportPath, exportCsv(snapshot, options.selection), { flag: 'wx', mode: 0o600 });
      snapshot.exportPath = exportPath;
    }
    return snapshot;
  } finally { await release(); }
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('Node.js 20 or newer is required.');
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 65536) throw new Error('Scanner configuration exceeds 64 KiB.');
  }
  const options = input.trim() ? JSON.parse(input) : {};
  const result = await scan(options);
  process.stdout.write(JSON.stringify(result));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stdout.write(JSON.stringify({ error: error instanceof RangeError ? 'Invalid IANA time zone.' : String(error.message).slice(0, 500), code: safeError(error) }));
    process.exitCode = 1;
  });
}
