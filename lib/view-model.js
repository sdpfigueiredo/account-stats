import { zero, total, moveDay, daysBetween } from './usage.js';
import { speedFilter } from './speed.js';
import { addPriced as add, costOf, speedTotals } from './pricing.js';
import { createQuotaClock, quotaSignature } from './quota.js';
export const PAGE_DAYS = 45;
export const PAGE_WEEKS = 20;
const RANGE_VALUES = ['all', '30d', '7d', 'quota'];
function collectModels(day, model, speed = 'all') {
  const selected = (day?.models || []).filter(x => model === 'all' || x.id === model);
  const models = speed === 'all' ? selected : selected.map(m => ({id:m.id, ...speedTotals(m,speed)}))
    .filter(m => m.requests > 0 || total(m) > 0);
  const values = zero();
  for (const m of models) add(values, m);
  return { date: day?.date, ...values, models };
}
function summarize(buckets) {
  const totals = zero(), modelTotals = new Map();
  let peak = null, active = 0;
  for (const bucket of buckets) {
    add(totals, bucket);
    if (bucket.requests > 0) active++;
    if (!peak || total(bucket) > total(peak)) peak = bucket;
    for (const m of bucket.models) {
      if (!modelTotals.has(m.id)) modelTotals.set(m.id, { id: m.id, ...zero() });
      add(modelTotals.get(m.id), m);
    }
  }
  const inputSide = totals.read + totals.write + totals.input;
  return { totals, peak, active, modelTotals: [...modelTotals.values()].sort((a,b) => total(b)-total(a)),
    cacheHit: inputSide ? totals.read / inputSide : null };
}
export function makeView(snapshot, preferences = {}) {
  const today = snapshot?.today || new Date().toISOString().slice(0, 10);
  const range = RANGE_VALUES.includes(preferences.range) ? preferences.range : '30d';
  const grouping = preferences.grouping === 'week' ? 'week' : 'day';
  const timeZone = snapshot?.timeZone || preferences.timeZone || 'Europe/Lisbon';
  const clock = createQuotaClock({ timeZone, resetDay: preferences.resetDay ?? snapshot?.quota?.resetDay,
    resetTime: preferences.resetTime ?? snapshot?.quota?.resetTime });
  const now = Number.isFinite(snapshot?.asOf) ? snapshot.asOf
    : Number.isFinite(Date.parse(snapshot?.generatedAt)) ? Date.parse(snapshot.generatedAt) : clock.at(today, '23:59');
  const currentQuota = clock.periodAt(now);
  const quotaReady = snapshot?.quota?.signature === quotaSignature(clock.settings) && Array.isArray(snapshot?.weeks);
  const allSource = Array.isArray(snapshot?.days) ? snapshot.days : [];
  const first = allSource.find(d => d.date <= today)?.date || today;
  const start = range === 'quota' ? currentQuota.date : range === 'all' ? first : moveDay(today, range === '7d' ? -6 : -29);
  const model = typeof preferences.model === 'string' ? preferences.model : 'all';
  const speed = speedFilter(preferences.speed);
  const common = { speed, range, grouping, start, end: today, currentQuota, quotaSettings: clock.settings, quotaReady,
    dayCount: Math.max(1, daysBetween(start, today)),
    allModels: [...new Set(allSource.flatMap(d => (d.models || []).map(m => m.id)))].sort(),
    model, timeZone, generatedAt: snapshot?.generatedAt || null, asOf: now,
    hasData: allSource.length > 0, busy: Boolean(snapshot?.busy) };
  const currentDays = quotaReady ? (snapshot.weeks.find(w => w.id === currentQuota.id)?.days || []) : [];
  if (grouping === 'week') return weeklyView(snapshot, preferences, common, clock);
  const source = range === 'quota' ? currentDays : allSource;
  const available = new Map(source.map(day => [day.date, day]));
  const pageCount = Math.ceil(common.dayCount / PAGE_DAYS);
  const page = clampPage(preferences.page, pageCount);
  const pageEnd = moveDay(today, -page * PAGE_DAYS);
  const pageStart = moveDay(pageEnd, -Math.min(PAGE_DAYS, common.dayCount-page*PAGE_DAYS)+1);
  const buckets = source.filter(d => d.date >= start && d.date <= today).map(d => collectModels(d, model, speed));
  const summary = summarize(buckets);
  const chartDays = [];
  for (let date = pageStart; date <= pageEnd; date = moveDay(date, 1)) chartDays.push({ ...collectModels(available.get(date), model, speed), date });
  const day = chartDays.find(d => d.date === preferences.day) || chartDays.at(-1);
  return { ...common, ...summary, activeDays: summary.active, buckets, page, pageCount, pageStart, pageEnd, chartDays, day };
}
function clampPage(page, pageCount) {
  const value = Number.isFinite(page) ? Math.trunc(page) : 0;
  return Math.max(0, Math.min(pageCount-1, value));
}
function weeklyView(snapshot, preferences, common, clock) {
  const { range, currentQuota, start, end, model, speed, asOf: now } = common;
  const windowStart = range === 'quota' ? currentQuota.startMs : clock.at(start, '00:00');
  const firstPeriod = range === 'quota' ? currentQuota
    : range === 'all' ? (common.quotaReady && snapshot.weeks.length ? clock.periodFromDate(snapshot.weeks[0].date) : currentQuota)
    : clock.periodAt(windowStart);
  const weekMap = new Map((common.quotaReady ? snapshot.weeks : []).map(w => [w.id, w]));
  const buckets = [], activeDays = new Set();
  for (let date = firstPeriod.date; date <= currentQuota.date; date = moveDay(date, 7)) {
    const period = clock.periodFromDate(date);
    const source = weekMap.get(period.id);
    const days = (source?.days || []).filter(d => (range === 'all' || range === 'quota' || d.date >= start) && d.date <= end)
      .map(d => collectModels(d, model, speed));
    const summary = summarize(days);
    for (const day of days) if (day.requests > 0) activeDays.add(day.date);
    const isCurrent = period.id === currentQuota.id;
    const clipped = range !== 'all' && range !== 'quota' && windowStart > period.startMs;
    const bucket = { ...period, ...summary.totals, models: summary.modelTotals,
      days, current: isCurrent, clipped,
      observedStartMs: clipped ? windowStart : period.startMs,
      observedEndMs: Math.min(now, period.endMs) };
    buckets.push(bucket);
  }
  const summary = summarize(buckets);
  const pageCount = Math.max(1, Math.ceil(buckets.length/PAGE_WEEKS));
  const page = clampPage(preferences.page, pageCount);
  const endIndex = buckets.length-page*PAGE_WEEKS;
  const chartDays = buckets.slice(Math.max(0,endIndex-PAGE_WEEKS), endIndex);
  const day = chartDays.find(w => w.id === preferences.week) || chartDays.at(-1);
  return { ...common, ...summary, buckets, activeDays: activeDays.size,
    weekCount: buckets.length, page, pageCount, chartDays, day,
    pageStart: chartDays[0]?.date || start, pageEnd: chartDays.at(-1)?.date || end,
    clippedWeeks: buckets.filter(w => w.clipped).length };
}
export function chartValue(day, mode) {
  if (mode === 'cost') return costOf(day).totalMax;
  if (mode === 'cache') return day.read + day.write;
  if (['read', 'write', 'input', 'output'].includes(mode)) return day[mode];
  return total(day);
}
