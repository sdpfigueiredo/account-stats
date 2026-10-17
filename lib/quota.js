import { createI18n } from './i18n.js';
/** Calendar-week quota boundaries. Pure JS/Intl; no host timezone assumptions. */
import { moveDay } from './usage.js';
const DAY_MS = 86400000;
export function quotaSettings(options = {}) {
  const timeZone = options.timeZone ?? 'Europe/Lisbon';
  const resetDay = options.resetDay ?? 4;
  const resetTime = options.resetTime ?? '20:00';
  if (!Number.isInteger(resetDay) || resetDay < 0 || resetDay > 6) throw new Error('O dia de reset deve ser um dia da semana (0–6).');
  if (typeof resetTime !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(resetTime)) throw new Error('Hora de reset inválida. Usa HH:mm, por exemplo 20:00.');
  if (typeof timeZone !== 'string' || !timeZone.trim()) throw new Error('Fuso horário inválido. Exemplo: Europe/Lisbon.');
  new Intl.DateTimeFormat('en', { timeZone }).format(0);
  return { timeZone, resetDay, resetTime };
}
export function quotaSignature(settings) {
  const s = quotaSettings(settings);
  return JSON.stringify([s.timeZone, s.resetDay, s.resetTime]);
}
/**
 * Resolve local calendar time, including DST. If a clock time occurs twice,
 * use the first occurrence; if it does not exist, move it forward by the gap.
 * This is Temporal's "compatible" policy, implemented without a dependency.
 * Never advance a local week by a fixed 168 hours.
 */
export function createQuotaClock(options = {}) {
  const settings = quotaSettings(options);
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: settings.timeZone,
    calendar: 'gregory', numberingSystem: 'latn', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const resolutions = new Map(), periods = new Map();
  const partsAt = timestamp => {
    const p = {};
    for (const part of formatter.formatToParts(new Date(timestamp))) if (part.type !== 'literal') p[part.type] = part.value;
    return p;
  };
  const dateAt = timestamp => { const p = partsAt(timestamp); return `${p.year}-${p.month}-${p.day}`; };
  const wallStamp = timestamp => {
    const p = partsAt(timestamp);
    return Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.000Z`);
  };
  function at(date, time = settings.resetTime) {
    const key = date + 'T' + time;
    if (resolutions.has(key)) return resolutions.get(key);
    const target = Date.parse(key + ':00.000Z');
    if (!Number.isFinite(target)) throw new Error('Data de reset inválida.');
    // Probe both sides of transitions (including non-hour offsets/day skips).
    const offsets = new Set();
    for (const delta of [-2, -1, -.5, 0, .5, 1, 2]) {
      const probe = target + delta * DAY_MS;
      offsets.add(wallStamp(probe) - probe);
    }
    const candidates = [...offsets].map(offset => target - offset).sort((a,b) => a-b);
    const exact = candidates.filter(candidate => wallStamp(candidate) === target);
    let resolved = exact[0];
    if (resolved === undefined) {
      const later = candidates.map(timestamp => ({ timestamp, shift: wallStamp(timestamp) - target }))
        .filter(x => x.shift > 0).sort((a,b) => a.shift - b.shift || a.timestamp - b.timestamp);
      resolved = later[0]?.timestamp;
    }
    if (!Number.isFinite(resolved)) throw new Error('Não foi possível resolver a hora no fuso configurado.');
    resolutions.set(key, resolved);
    return resolved;
  }
  function periodFromDate(date) {
    if (periods.has(date)) return periods.get(date);
    const startMs = at(date), endMs = at(moveDay(date, 7));
    const period = { date, id: new Date(startMs).toISOString(), startMs, endMs,
      start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() };
    periods.set(date, period);
    return period;
  }
  function periodAt(timestamp, knownDate) {
    if (!Number.isFinite(timestamp)) throw new Error('Timestamp de utilização inválido.');
    const date = knownDate || dateAt(timestamp);
    const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
    let startDate = moveDay(date, -((weekday - settings.resetDay + 7) % 7));
    let period = periodFromDate(startDate);
    if (timestamp < period.startMs) period = periodFromDate(moveDay(startDate, -7));
    else if (timestamp >= period.endMs) period = periodFromDate(moveDay(startDate, 7));
    return period;
  }
  return { settings, at, dateAt, periodAt, periodFromDate };
}
/** Display-only formatting. Never used to calculate a reset boundary or CSV key. */
export function quotaLocalLabel(timestamp, timeZone, includeYear = false, language = 'en-US') {
  return createI18n(language).datetime(timestamp,timeZone,includeYear);
}
export function quotaIntervalLabel(period, timeZone, includeYear = false, language = 'en-US') {
  return `${quotaLocalLabel(period.startMs,timeZone,includeYear,language)} → ${quotaLocalLabel(period.endMs,timeZone,includeYear,language)}`;
}

/** Stable machine export label retained from v1.2.0; independent of UI language. */
export function quotaExportLabel(timestamp, timeZone, includeYear = true) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle:'h23',
    calendar:'gregory', numberingSystem:'latn', day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }).formatToParts(new Date(timestamp));
  const get = type => parts.find(p=>p.type===type)?.value;
  return `${get('day')}/${get('month')}${includeYear ? '/' + get('year') : ''} ${get('hour')}:${get('minute')}`;
}
