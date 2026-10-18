/** Pure, dependency-free token normalization. Never copies prompt or answer text. */
import { normalizeSpeed, mergeSpeed } from './speed.js';
export const METRICS = ['read', 'write', 'input', 'output'];
export const zero = () => ({ read: 0, write: 0, input: 0, output: 0, requests: 0 });
export function count(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
export function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;
  const fields = ['cache_read_input_tokens', 'cache_creation_input_tokens', 'input_tokens', 'output_tokens'];
  const detail = usage.cache_creation;
  if (!fields.some(k => typeof usage[k] === 'number') && !detail) return null;
  const write = typeof usage.cache_creation_input_tokens === 'number'
    ? count(usage.cache_creation_input_tokens)
    : count(detail?.ephemeral_5m_input_tokens) + count(detail?.ephemeral_1h_input_tokens);
  const five = count(detail?.ephemeral_5m_input_tokens), hour = count(detail?.ephemeral_1h_input_tokens);
  return {
    speed: normalizeSpeed(usage.speed),
    read: count(usage.cache_read_input_tokens),
    // The top-level creation count ALREADY includes the 5m and 1h buckets.
    write,
    // Retained separately for pricing; NEVER included again in total tokens.
    write5m: five+hour <= write ? five : 0,
    write1h: five+hour <= write ? hour : 0,
    input: count(usage.input_tokens),
    output: count(usage.output_tokens),
    requests: 1,
  };
}
export function total(value) { return METRICS.reduce((n, k) => n + count(value?.[k]), 0); }
export function add(target, value) {
  for (const k of [...METRICS, 'requests']) target[k] = count(target[k]) + count(value?.[k]);
  return target;
}
/** Repeated blocks of the SAME response carry cumulative usage, not new requests. */
export function mergeRecord(a, b) {
  if (!a) return { ...b, ...mergeSpeed(null, b) };
  const out = { ...a, ...mergeSpeed(a, b), timestamp: Math.min(a.timestamp, b.timestamp) };
  for (const k of METRICS) out[k] = Math.max(count(a[k]), count(b[k]));
  out.write5m = Math.max(count(a.write5m), count(b.write5m));
  out.write1h = Math.max(count(a.write1h), count(b.write1h));
  if (out.write5m+out.write1h > out.write) { out.write5m=0; out.write1h=0; }
  if (a.model === 'unknown' && b.model !== 'unknown') out.model = b.model;
  // A response copied from a main session into an agent transcript is still main.
  out.agent = Boolean(a.agent && b.agent);
  out.weakIdentity = Boolean(a.weakIdentity && b.weakIdentity);
  return out;
}
export function parseTranscriptRow(row, source = '') {
  if (!row || row.type !== 'assistant' || row.isApiErrorMessage === true) return null;
  const message = row.message;
  if (!message || (message.role && message.role !== 'assistant')) return null;
  const usage = normalizeUsage(message.usage);
  if (!usage) return null;
  const model = typeof message.model === 'string' && message.model ? message.model : 'unknown';
  if (model === '<synthetic>' || model === 'synthetic') return null;
  const timestamp = typeof row.timestamp === 'number' ? row.timestamp : Date.parse(row.timestamp);
  if (!Number.isFinite(timestamp) || timestamp < 0) return null;
  // Prefer API message ID globally, NOT session ID: forks and resumed sessions
  // can contain the same original response. Request IDs and UUIDs are fallbacks.
  const identity = typeof message.id === 'string' && message.id ? 'message:' + message.id
    : typeof row.requestId === 'string' && row.requestId ? 'request:' + row.requestId
    : typeof row.uuid === 'string' && row.uuid ? 'uuid:' + row.uuid : null;
  if (!identity) return null; // Never invent an identity and silently overcount.
  const agent = Boolean(row.isSidechain || row.agentId || /(?:^|[\\/])subagents[\\/]|(?:^|[\\/])agent-[^\\/]+\.jsonl$/i.test(source));
  return { identity, timestamp, model: model.slice(0, 256), agent,
    weakIdentity: identity.startsWith('uuid:'), ...usage };
}
export function dayKey(timestamp, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return dayKeyWithFormatter(timestamp, fmt);
}
export function dayKeyWithFormatter(timestamp, formatter) {
  const parts = formatter.formatToParts(new Date(timestamp));
  const get = type => parts.find(p => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function moveDay(day, delta) {
  const date = new Date(day + 'T12:00:00.000Z');
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}
export function daysBetween(from, to) {
  return Math.round((Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 86400000) + 1;
}
export function shortNumber(value) {
  const n = count(value);
  if (n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 1 : 2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 1 : 2) + 'k';
  return String(n);
}
export function exactNumber(n) { return String(count(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
export function modelName(id) {
  // Display only. Aggregation always retains the exact provider model ID.
  return String(id).replace(/^claude-/, '').replace(/-20\d{6}$/, '')
    .replace(/-/g, ' ').replace(/\b(opus|sonnet|haiku|fable)\b/gi, x => x[0].toUpperCase() + x.slice(1))
    .replace(/(\d) (\d)(?= |$)/g, '$1.$2');
}
export function escapeXml(text) {
  return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}
