import { SPEEDS, speedFilter } from '../lib/speed.js';
import { createI18n, resolveLanguage } from '../lib/i18n.js';
/**
 * Claude Code Desktop mod. Only official function hooks / $ APIs.
 * Imported modules are pure ES modules; Node runs solely in the child scanner.
 * No model, tool, prompt, authorization, telemetry or HTTP calls are made.
 */
import { makeView } from '../lib/view-model.js';
import { total, dayKey } from '../lib/usage.js';
import { PRICING_DATE, costOf, costStatus } from '../lib/pricing.js';
import { quotaSettings, quotaIntervalLabel } from '../lib/quota.js';
import { palette, headerSvg, overviewSvg, chartSvg, modelsSvg, quotaSvg, cycleSvg, costSvg, statusSvg, speedSvg } from '../lib/visuals.js';
const PANE = 'account-stats';
const KEYS = ['range','model','speed','mode','theme','nodePath','timeZone','extraRoots','includeSubagents','grouping','resetDay','resetTime'];

let configuration = {};
let prefs = { range: '30d', model: 'all', speed: 'all', mode: 'total', theme: 'dark', page: 0, day: '', week: '', grouping: 'day',
      resetDay: configuration.reset_day ?? 4, resetTime: configuration.reset_time ?? '20:00',
  nodePath: configuration.node_path || 'node', timeZone: configuration.time_zone || 'Europe/Lisbon',
  extraRoots: configuration.extra_roots || '', includeSubagents: configuration.include_subagents !== false };
let snapshot = null, limits = [], limitsError = '', error = '', notice = '', loading = false;
let visible = false, settings = false, diagnostics = false, periodModels = false, modelPage = 0;
let resolvedNode = '', interval = null, pending = null, lastSuccess = 0, revision = 0, saveQueue = Promise.resolve();
let extraTranscriptRoots = [];
// A language is session-local presentation state, NEVER a saved preference.
let uiLanguage = createI18n('en-US'), languageResolution = resolveLanguage(undefined), languageReadFailed = false;
let languagePending = null;
const message = (key, args = {}) => ({ key, args });
const localized = value => value && typeof value === 'object' && value.key ? uiLanguage.t(value.key,value.args) : String(value || '');
class ModError extends Error {
  constructor(key, detail = '') { super(key); this.key=key; this.detail=String(detail).slice(0,500); }
}
let errorDetail = '';
async function readLanguage($) {
  if(languagePending) return languagePending;
  languagePending = (async () => {
    try {
      // Official merged settings respect project, user and managed precedence.
      // Keep only the language field. Never log/store/export the settings object.
      const settings = await $.settings.read();
      const resolved = resolveLanguage(settings?.language);
      const changed = resolved.locale !== uiLanguage.locale || resolved.reason !== languageResolution.reason ||
        resolved.language !== languageResolution.language || languageReadFailed;
      languageResolution = resolved; uiLanguage = createI18n(resolved.locale); languageReadFailed = false;
      if(changed) { $.ui.invalidate('command.describe'); redraw($); }
    } catch {
      // A missing/temporarily denied API must not reset a successfully read locale.
      const changed = !languageReadFailed; languageReadFailed = true;
      if(changed) redraw($);
    }
  })();
  try { await languagePending; } finally { languagePending=null; }
}

function redraw($) { $.ui.invalidate('ui.render'); }
async function save($) {
  const value = {};
  for (const key of KEYS) value[key] = prefs[key];
  // Serialize writes from rapid presses. A failed preference save never blocks UI.
  saveQueue = saveQueue.catch(() => {}).then(() => $.store.set('preferences-v1', value));
  try { await saveQueue; } catch { notice = message('errorSave'); redraw($); }
}
function change($, patch) {
  prefs = { ...prefs, ...patch }; modelPage = 0;
  redraw($); return save($);
}
const zoneToday = () => {
  try { return dayKey(Date.now(), prefs.timeZone); } catch { return new Date().toISOString().slice(0,10); }
};
const viewNow = () => makeView(snapshot || { days: [], today: zoneToday(), timeZone: prefs.timeZone }, prefs);
async function readLimits($) {
  try {
    const usage = await $.session.usage();
    limits = Array.isArray(usage?.rateLimits) ? usage.rateLimits.filter(r => r && typeof r.kind === 'string' && Number.isFinite(r.percentUsed)).slice(0,12) : [];
    limitsError = '';
  } catch { limits = []; limitsError = message('errorLimits'); }
}
async function nodeExecutable($) {
  if (resolvedNode) return resolvedNode;
  const requested = String(prefs.nodePath || 'node').trim();
  const candidates = [requested];
  if (requested === 'node') {
    const programFiles = await $.env.get('ProgramFiles');
    if (programFiles) candidates.push(programFiles.replace(/[\\/]$/, '') + '\\nodejs\\node.exe');
    candidates.push('/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node');
  }
  for (const candidate of [...new Set(candidates)]) {
    try {
      const result = await $.process.run([candidate, '--version'], { timeoutMs: 5000 });
      const match = /^v(\d+)\./.exec(String(result.stdout || '').trim());
      if (result.exitCode === 0 && match && Number(match[1]) >= 20) { resolvedNode = candidate; return candidate; }
    } catch { /* No shell and no downloaded executables; try next known location. */ }
  }
  throw new ModError('errorNode');
}
function schedule($, ms = 600) {
  if (pending || !visible) return;
  pending = $.clock.after(ms, async () => { pending = null; if (visible) await refresh($); });
}
async function refresh($, action = 'scan') {
  await readLanguage($);
  if (loading) { if (action === 'export') { notice = message('exportBusy'); redraw($); } return; }
  const currentRevision = revision;
  loading = true; error = ''; errorDetail = ''; if (action === 'export') notice = '';
  redraw($);
  try {
    const executable = await nodeExecutable($);
    const view = viewNow();
    const config = { timeZone: prefs.timeZone, resetDay: prefs.resetDay, resetTime: prefs.resetTime, includeSubagents: prefs.includeSubagents,
      extraRoots: [...String(prefs.extraRoots || '').split(/[\n;]/).map(s => s.trim()).filter(Boolean), ...extraTranscriptRoots],
      action, budgetMs: 18000,
      selection: { start: view.start, end: view.end, model: view.model, speed: view.speed, range: view.range, grouping: view.grouping } };
    const script = $.plugin.root.replace(/[\\/]$/, '') + '/scanner/index.mjs';
    const result = await $.process.run([executable, script], { stdin: JSON.stringify(config), timeoutMs: 120000 });
    let parsed;
    try { parsed = JSON.parse(String(result.stdout || '')); }
    catch { throw new ModError('errorJson'); }
    if (result.exitCode !== 0 || parsed.error) throw new ModError('errorIndexer', parsed.error || parsed.code || '');
    if (!Array.isArray(parsed.days) || typeof parsed.today !== 'string') throw new ModError('errorResponse');
    if (currentRevision !== revision) return; // A setting changed while scanning.
    snapshot = parsed;
    if (parsed.exportPath) notice = message('exportSaved',{path:parsed.exportPath});
    else if (action === 'export') notice = message('exportRetry');
    lastSuccess = await $.clock.now();
    await readLimits($);
  } catch (err) {
    if (currentRevision === revision) { error = message(err instanceof ModError ? err.key : 'errorIndexer'); errorDetail = err instanceof ModError ? err.detail : String(err instanceof Error ? err.message : err).slice(0,500); };
  } finally {
    loading = false; redraw($);
    if (visible && (currentRevision !== revision || snapshot?.diagnostics?.pendingFiles > 0 || snapshot?.busy)) schedule($, 3000);
  }
}
async function applyConfig($, patch) {
  revision++; resolvedNode = ''; snapshot = null; error = ''; notice = '';
  await change($, { ...patch, page: 0, day: '', week: '' }); schedule($, 20);
}
async function open($, focus = true) {
  await readLanguage($);
  visible = true;
  const base = { id: PANE, title: 'Account Stats', columns: 66, rows: 42, closeOnEscape: true };
  await $.ui.open(focus ? { ...base, focus: true } : base);
  schedule($, 20);
}

export function register(on, options = {}) {
    configuration = options;
    prefs = { range: '30d', model: 'all', speed: 'all', mode: 'total', theme: 'dark', page: 0, day: '', week: '', grouping: 'day',
      resetDay: configuration.reset_day ?? 4, resetTime: configuration.reset_time ?? '20:00',
      nodePath: configuration.node_path || 'node', timeZone: configuration.time_zone || 'Europe/Lisbon',
      extraRoots: configuration.extra_roots || '', includeSubagents: configuration.include_subagents !== false };
    snapshot = null; limits = []; limitsError = ''; error = ''; notice = ''; loading = false;
    visible = false; settings = false; diagnostics = false; periodModels = false; modelPage = 0;
    resolvedNode = ''; interval = null; pending = null; lastSuccess = 0; revision = 0;
    extraTranscriptRoots = []; saveQueue = Promise.resolve();
    uiLanguage=createI18n('en-US'); languageResolution=resolveLanguage(undefined); languageReadFailed=false; languagePending=null; errorDetail='';
  on('session.start', async ($, e, next) => {
    await readLanguage($);
    await $.command.register({ name: 'account-stats', description: uiLanguage.t('command'), immediate: true });
    try {
      const saved = await $.store.get('preferences-v1');
      if (saved && typeof saved === 'object') {
        for (const key of KEYS) if (typeof saved[key] === typeof prefs[key]) prefs[key] = saved[key];
      }
    } catch { /* Default preferences remain usable. */ }
    if (!['dark','light'].includes(prefs.theme)) prefs.theme = 'dark';
    prefs.speed = speedFilter(prefs.speed);
    if (!['day','week'].includes(prefs.grouping)) prefs.grouping = 'day';
    try { quotaSettings(prefs); }
    catch { prefs.resetDay = 4; prefs.resetTime = '20:00'; prefs.timeZone = 'Europe/Lisbon'; notice = message('errorResetConfig'); }
    interval?.cancel();
    interval = $.clock.every(30000, async () => { if (visible) await refresh($); });
    if (configuration.auto_open === true) { visible = true; $.clock.after(50, () => open($, false)); }
    return next(e);
  });
  on('command.run', { command: 'account-stats' }, async ($, e) => {
    const arg = String(e.args || '').trim();
    if (arg === 'close') { visible = false; pending?.cancel(); pending = null; await $.ui.close({ id: PANE }); return {}; }
    if (['all','7d','30d'].includes(arg)) await change($, { range: arg, page: 0, day: '', week: '' });
    else if (arg === 'quota') await change($, { range: 'quota', grouping: 'week', page: 0, week: '', day: '' });
    else if (arg === 'weeks') await change($, { range: 'all', grouping: 'week', page: 0, week: '', day: '' });
    else if (arg === 'settings') settings = true;
    else if (arg && arg !== 'refresh') notice = message('commandOptions');
    await open($); return {};
  });
  on('command.describe', { command: 'account-stats' }, async ($, e, next) => {
    const result = await next(e);
    return { ...result, description: uiLanguage.t('command') };
  });
  on('config.set', { key: 'language' }, async ($, e, next) => {
    const result = await next(e); // Never rewrite, block or presume a proposed value was accepted.
    await readLanguage($);
    $.clock.after(50, () => readLanguage($));
    return result;
  });
  on('classic.ConfigChange', async ($, e, next) => {
    const result = await next(e);
    await readLanguage($);
    $.clock.after(50, () => readLanguage($));
    return result;
  });
  // Let turns finish unchanged. File scanning runs on its own timer afterwards.
  on('turn.complete', async ($, e, next) => { schedule($, 1000); return next(e); });
  on('session.measure', async ($, e, next) => { schedule($, 1000); return next(e); });
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) { visible = false; pending?.cancel(); pending = null; }
    return next(e);
  });
  // Observe only the transcript path, never the prompt or message content.
  on('classic.SessionStart', async ($, e, next) => {
    if (typeof e.transcript_path === 'string' && e.transcript_path.endsWith('.jsonl')) {
      const parent = e.transcript_path.replace(/[\\/][^\\/]+$/, '');
      if (parent && !extraTranscriptRoots.includes(parent)) extraTranscriptRoots.push(parent);
      extraTranscriptRoots = extraTranscriptRoots.slice(-20);
    }
    return next(e);
  });
  on('session.end', async ($, e, next) => {
    if (e.reason === 'logout') { limits = []; snapshot = null; notice = message('loggedOut'); redraw($); }
    // /clear and /resume do not fire session.start again; keep timer registered.
    return next(e);
  });

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e);
    const { Box, Text, Button, Select, Input, Svg } = $.ui.resolve(e);
    const l = uiLanguage, {t}=l;
    const p = palette(prefs.theme), view = viewNow();
    const intervalLabel=(period,year=false)=>quotaIntervalLabel(period,view.timeZone,year,l);
    const graphic = e.surface === 'desktop' || e.surface === 'vscode';
    // bodyColumns is measured in cells; Svg dimensions are pixels.
    const columns = Number(e.props?.bodyColumns) || 64;
    const svgWidth = Math.max(120, Math.min(640, Math.floor((columns-2)*7.5)));
    const svg = drawing => graphic
      ? Svg({ source: drawing.source, alt: drawing.alt, width: svgWidth, height: Math.round(drawing.height*svgWidth/drawing.width) })
      : Text({ color: p.text, wrap: 'wrap', children: [drawing.alt] });
    const line = (value, dim = true) => Text({ color: dim?p.mute:p.text, wrap: 'wrap', children: [String(value)] });
    const button = (key,label,fn,dim=false) => Button({ key,label,plain:true,dimColor:dim,onPress:fn });
    const row = children => Box({ flexDirection:'row',flexWrap:'wrap',columnGap:1,children });
    const cards = [svg(headerSvg(prefs.theme,loading,l)), row([
      ...[['all',t('all')],['30d',t('days30')],['7d',t('days7')],['quota',t('thisQuota')]].map(([value,label]) => Box({
        key:'range-box-'+value, backgroundColor:prefs.range===value?p.elevated:p.bg, paddingX:1,
        children:[button('range-'+value,(prefs.range===value?'● ':'')+label,()=>change($,{range:value,page:0,day:'',week:'',...(value==='quota'?{grouping:'week'}:{})}),prefs.range!==value)]
      })),
      button('refresh',loading?t('refreshing'):'↻ '+t('refresh'),()=>refresh($),loading),
    ])];
    cards.push(row([
      button('group-day',(view.grouping==='day'?'● ':'')+t('byDay'),()=>change($,{grouping:'day',page:0,day:'',week:''}),view.grouping!=='day'),
      button('group-week',(view.grouping==='week'?'● ':'')+t('byWeek'),()=>change($,{grouping:'week',page:0,day:'',week:''}),view.grouping!=='week'),
    ]));
    const needsQuota = view.grouping==='week' || view.range==='quota';
    const weekly = view.grouping==='week';
    if (error) cards.push(svg(statusSvg(t('updateFailed'),localized(error),prefs.theme,true)), line(localized(error)));
    if (snapshot?.partial || snapshot?.busy) cards.push(line(snapshot?.busy?t('indexBusy'):t('importPartial',{n:l.integer(snapshot.diagnostics?.pendingFiles||0)})));
    if (!snapshot && !error) cards.push(svg(statusSvg(t('loadingTitle'),t('loadingHelp'),prefs.theme)));
    if (snapshot && (snapshot.initialScan || (needsQuota && !view.quotaReady))) cards.push(svg(statusSvg(t('preparingTitle'),t('preparingHelp'),prefs.theme)));
    if (snapshot && !snapshot.initialScan && (!needsQuota || view.quotaReady)) {
      if (!view.hasData) cards.push(svg(statusSvg(t('emptyTitle'),t('emptyHelp'),prefs.theme)));
      cards.push(Select({key:'model',label:t('model'),value:view.model,
        options:[{value:'all',label:t('allModels')},...view.allModels.map(id=>({value:id,label:id}))],
        onSelect:value=>change($,{model:value,day:'',page:0})}));
      cards.push(Select({key:'speed',label:t('speedFilter'),value:view.speed,
        options:[{value:'all',label:t('speedAll')},...SPEEDS.map(speed=>({value:speed,label:t(`speed_${speed}`)}))],
        onSelect:value=>change($,{speed:speedFilter(value),day:'',week:'',page:0})}));
      cards.push(svg(overviewSvg(view,prefs.theme,l)));
      cards.push(svg(costSvg(view.totals,t('costPeriod'),t('periodSubtitle',{start:l.date(view.start),end:l.date(view.end)}),prefs.theme,l)));
      cards.push(svg(speedSvg(view.totals,t('speedPeriod'),prefs.theme,l)));
      if (needsQuota) cards.push(line(t('reset',{day:l.weekday(prefs.resetDay),time:prefs.resetTime,zone:view.timeZone})));
      if (view.range==='quota') cards.push(line(t('currentInterval',{interval:intervalLabel(view.currentQuota,true)})));
      if (weekly && view.clippedWeeks) cards.push(line(t('clippedHelp')));
      cards.push(Select({key:'metric',label:t('chart'),value:prefs.mode,
        options:[{value:'total',label:t('metricTotal')},{value:'cost',label:t('metricCost')},{value:'cache',label:t('metricCache')},
          {value:'read',label:t('metricRead')},{value:'write',label:t('metricWrite')},{value:'input',label:t('metricInput')},{value:'output',label:t('metricOutput')}],
        onSelect:value=>change($,{mode:value})}));
      cards.push(svg(chartSvg(view,prefs.mode,prefs.theme,l)));
      if (view.pageCount>1) cards.push(row([
        ...(view.page<view.pageCount-1?[button('older',t(weekly?'olderWeeks':'olderDays'),()=>change($,{page:view.page+1,day:'',week:''}))]:[]),
        line(t('page',{page:l.integer(view.page+1),pages:l.integer(view.pageCount),start:l.date(view.pageStart),end:l.date(view.pageEnd)})),
        ...(view.page>0?[button('newer',t(weekly?'newerWeeks':'newerDays'),()=>change($,{page:view.page-1,day:'',week:''}))]:[]),
      ]));
      if (weekly) {
        cards.push(Select({key:'week',label:t('week'),value:view.day.id,
          options:[...view.chartDays].reverse().map(w=>({value:w.id,label:`${intervalLabel(w,true)} · ${t('tokens',{n:l.integer(total(w))})}${w.current?' · '+t('ongoing'):''}${w.clipped?' · '+t('partialFilter'):''}`})),
          onSelect:value=>change($,{week:value})}));
        cards.push(svg(cycleSvg(view.day,view,prefs.theme,l)));
      } else {
        cards.push(Select({key:'day',label:t('day'),value:view.day.date,
          options:[...view.chartDays].reverse().map(d=>({value:d.date,label:`${l.date(d.date)} · ${t('tokens',{n:l.integer(total(d))})}`})),
          onSelect:value=>change($,{day:value})}));
      }
      cards.push(svg(costSvg(view.day,t(weekly?'costWeek':'costDay'),
        weekly?intervalLabel(view.day)+(view.day.clipped?' · '+t('partialFilter'):''):l.date(view.day.date),prefs.theme,l)));
      cards.push(svg(speedSvg(view.day,t('speedSelection'),prefs.theme,l)));
      cards.push(row([
        button('daily-models',(periodModels?'':'● ')+t(weekly?'modelsWeek':'modelsDay'),()=>{periodModels=false;modelPage=0;redraw($);},periodModels),
        button('period-models',(periodModels?'● ':'')+t('inPeriod'),()=>{periodModels=true;modelPage=0;redraw($);},!periodModels),
      ]));
      const models = periodModels ? view.modelTotals : view.day.models;
      const modelPages = Math.max(1,Math.ceil(models.length/5)); modelPage=Math.min(modelPage,modelPages-1);
      cards.push(svg(modelsSvg(models,periodModels?t('modelsPeriod'):weekly?t('modelsWeek'):t('modelsOnDate',{date:l.date(view.day.date)}),
        periodModels?t('fullFilter',{start:l.date(view.start),end:l.date(view.end)}):t('details',{requests:l.integer(view.day.requests),tokens:l.integer(total(view.day))}),prefs.theme,modelPage*5,5,l)));
      if (modelPages>1) cards.push(row([
        ...(modelPage>0?[button('models-prev',t('previousModels'),()=>{modelPage--;redraw($);})]:[]),line(`${modelPage+1}/${modelPages}`),
        ...(modelPage<modelPages-1?[button('models-next',t('moreModels'),()=>{modelPage++;redraw($);})]:[]),
      ]));
      cards.push(svg(quotaSvg(limits,prefs.theme,l,view.timeZone)));
      if (limitsError) cards.push(line(localized(limitsError)));
    }
    cards.push(row([
      button('export',t('export'),()=>refresh($,'export')),
      button('theme',t(prefs.theme==='dark'?'light':'dark'),()=>change($,{theme:prefs.theme==='dark'?'light':'dark'})),
      button('settings',t(settings?'closeSettings':'settings'),()=>{settings=!settings;redraw($);}),
      button('diagnostics',t('diagnostics'),()=>{diagnostics=!diagnostics;redraw($);}),
    ]));
    if (notice) cards.push(line(localized(notice)));
    if (settings) {
      cards.push(line(t('settingsSaved'),false));
      cards.push(line(t('languageHeading'),false));
      cards.push(line(t('languageStatus',{locale:l.locale}),false));
      cards.push(line(t('languageHelp')));
      if(languageReadFailed) cards.push(line(t('languageUnavailable')));
      else if(languageResolution.reason==='default') cards.push(line(t('languageDefault')));
      else if(languageResolution.reason==='unsupported') cards.push(line(t('languageFallback',{language:languageResolution.language})));
      cards.push(line(t('quotaHeading'),false));
      cards.push(Select({key:'reset-day',label:t('resetDay'),value:String(prefs.resetDay),
        options:Array.from({length:7},(_,value)=>({label:l.weekday(value),value:String(value)})),
        onSelect:async value=>{
          const resetDay=Number(value);
          try { quotaSettings({...prefs,resetDay}); await applyConfig($,{resetDay}); }
          catch { notice=message('errorResetDay');redraw($); }
        }}));
      cards.push(Input({key:'reset-time',label:t('resetTime'),value:prefs.resetTime,placeholder:'20:00',submitLabel:t('save'),
        onSubmit:async value=>{
          const resetTime=String(value).trim();
          try { quotaSettings({...prefs,resetTime}); await applyConfig($,{resetTime}); }
          catch { notice=message('errorResetTime');redraw($); }
        }}));
      cards.push(line(t('resetHelp')));
      cards.push(Input({key:'node-path',label:'Node.js 20+',value:prefs.nodePath,placeholder:'C:\\Program Files\\nodejs\\node.exe',submitLabel:t('save'),
        onSubmit:value=>applyConfig($,{nodePath:String(value).trim()||'node'})}));
      cards.push(Input({key:'time-zone',label:t('timeZone'),value:prefs.timeZone,submitLabel:t('save'),
        onSubmit:async value=>{
          try { const timeZone=String(value).trim(); quotaSettings({...prefs,timeZone}); await applyConfig($,{timeZone}); }
          catch { notice=message('errorTimeZone');redraw($); }
        }}));
      cards.push(Input({key:'extra-roots',label:t('extraRoots'),value:String(prefs.extraRoots).replace(/\n/g,';'),submitLabel:t('save'),
        onSubmit:value=>applyConfig($,{extraRoots:value})}));
      cards.push(button('subagents',(prefs.includeSubagents?'☑ ':'☐ ')+t('includeSubagents'),()=>applyConfig($,{includeSubagents:!prefs.includeSubagents})));
      cards.push(line(t('rootsHelp')));
    }
    if (settings) {
      cards.push(line(t('pricingHeading'),false));
      cards.push(line(t('pricingHelp',{date:l.date(PRICING_DATE)})));
      cards.push(line(t('ttlHelp')));
      cards.push(line(t('speedHelp')));
      cards.push(line(t('speedUnknownHelp')));
      cards.push(line(t('exclusions')));
    }
    if (diagnostics) {
      const d=snapshot?.diagnostics||{};
      cards.push(line(t('diagnosticsHeading'),false));
      cards.push(line(t('languageStatus',{locale:l.locale})));
      if(errorDetail) cards.push(line(t('technicalError',{detail:errorDetail})));
      cards.push(line(t('diagnosticsPricing',{date:l.date(PRICING_DATE),status:l.status(costStatus(costOf(view.totals))),tokens:l.integer(costOf(view.totals).unpricedTokens)})));
      for (const m of view.modelTotals || []) if (costOf(m).unpricedTokens) cards.push(line(t('diagnosticsModel',{model:m.id,tokens:l.integer(costOf(m).unpricedTokens)}))); 
      cards.push(line(t('diagnosticsNode',{node:resolvedNode||t('nodePending'),zone:prefs.timeZone})));
      cards.push(line(t('diagnosticsReset',{day:l.weekday(prefs.resetDay),time:prefs.resetTime,count:l.integer(snapshot?.weeks?.length||0)})));
      cards.push(line(t('diagnosticsFiles',{found:l.integer(d.discoveredFiles||0),indexed:l.integer(d.indexedFiles||0),archived:l.integer(d.archivedFiles||0)})));
      cards.push(line(t('diagnosticsDuplicates',{duplicates:l.integer(d.duplicateCopies||0),malformed:l.integer(d.malformed||0),oversized:l.integer(d.oversized||0)})));
      cards.push(line(t('diagnosticsRecords',{weak:l.integer(d.weakIdentity||0),future:l.integer(d.futureRecords||0),agents:l.integer(d.subagentRequests||0)})));
      for (const root of snapshot?.roots||[]) cards.push(line(t('source',{path:root})));
      if (snapshot?.cacheDir) cards.push(line(t('index',{path:snapshot.cacheDir})));
      for (const warning of d.warnings||[]) cards.push(line(warning.code+': '+warning.path));
    }
    if (lastSuccess) cards.push(line(t('updated',{date:l.datetime(lastSuccess,prefs.timeZone,true)+' '+prefs.timeZone})));
    cards.push(line(t('historyHelp')));
    cards.push(line(t('categoriesHelp')));
    // Spacing belongs to the host layout, not to SVG viewBox padding or demo CSS.
    // Every section keeps a non-shrinking native row gap, including everything
    // below the selected-quota panel (API card, models, limits and footer).
    const sections=cards.map((child,index)=>Box({key:'section-'+index,flexDirection:'column',
      width:'100%',flexShrink:0,marginTop:index===0?0:1,children:[child]}));
    return Box({flexDirection:'column',width:'100%',paddingX:1,paddingBottom:1,backgroundColor:p.bg,children:sections});
  });
}
