/** Current first-party API equivalent by recorded response speed, not a bill or historical price.
 * Official sources and scope: docs/PRICING.md. No network or guessed model rates.
 * Price each de-duplicated request BEFORE aggregating (Haiku 5.5 has a prompt tier).
 */
import { SPEEDS, speedOf } from './speed.js';
import { count, total, add, zero, METRICS } from './usage.js';
export const PRICING_DATE = '2026-10-18';
export const PRICING_VERSION = '2026-10-18-speed-v2';
export const PRICING_SOURCE = 'https://platform.claude.com/docs/en/about-claude/pricing';
// USD per one million tokens. Read multipliers are model-specific, not always 0.1x.
const rate = (input, output, read) => ({ input, output, read, write5m: input*1.25, write1h: input*2 });
export const API_RATES = Object.freeze({
  'claude-fable-5-1': rate(10,50,.25),
  'claude-mythos-5-1': rate(10,50,.25),
  'claude-fable-5': rate(10,50,1),
  'claude-mythos-5': rate(10,50,1),
  'claude-opus-5-5': rate(4,20,.2),
  'claude-opus-5': rate(5,25,.5),
  'claude-opus-4-8': rate(5,25,.5),
  'claude-opus-4-7': rate(5,25,.5),
  'claude-opus-4-6': rate(5,25,.5),
  'claude-opus-4-5': rate(5,25,.5),
  'claude-opus-4-1': rate(15,75,1.5),
  'claude-opus-4': rate(15,75,1.5),
  'claude-sonnet-5-5': rate(2,10,.1),
  'claude-sonnet-5': rate(2,10,.2),
  'claude-sonnet-4-6': rate(3,15,.3),
  // Current published standard window is 200k. Do not silently price legacy
  // long-context beta requests with an unverified tariff.
  'claude-sonnet-4-5': { ...rate(3,15,.3), maxVerifiedPrompt: 200000 },
  'claude-sonnet-4': { ...rate(3,15,.3), maxVerifiedPrompt: 200000 },
  'claude-haiku-5-5': { ...rate(.1,.5,.01), threshold: 100000, long: rate(.5,2.5,.05) },
  'claude-haiku-4-5': rate(1,5,.1),
  'claude-haiku-3-5': rate(.8,4,.08),
});
// Only current, explicitly documented Fast tariffs. No family-wide multiplier.
export const FAST_API_RATES = Object.freeze({
  'claude-opus-5-5': rate(8,40,.4),
  'claude-opus-5': rate(10,50,1),
  'claude-opus-4-8': rate(10,50,1),
});
export function canonicalModel(id) {
  let value = String(id || '').trim().toLowerCase();
  value = value.replace(/^(?:(?:global|us|eu|apac)\.)?anthropic\./,'')
    .replace(/-v\d+:\d+$/,'').replace(/@20\d{6}$/,'').replace(/-20\d{6}$/,'');
  if (value === 'claude-3-5-haiku') value = 'claude-haiku-3-5';
  return Object.hasOwn(API_RATES, value) ? value : null;
}
export const zeroCost = () => ({ read:0, write:0, input:0, output:0, writeMax:0, total:0, totalMax:0,
  pricedTokens:0, unpricedTokens:0, pricedRequests:0, unpricedRequests:0, unknownWriteTokens:0, assumedStandardTokens:0, assumedStandardRequests:0 });
export function unknownCost(value) {
  return { ...zeroCost(), unpricedTokens:total(value), unpricedRequests:count(value?.requests) || (total(value) ? 1 : 0) };
}
export function costOf(value) { return value?.cost || unknownCost(value); }
const MONEY_FIELDS = new Set(['read','write','input','output','writeMax','total','totalMax']);
function addMoney(a,b) {
  // Every published rate has whole-nanodollar token units. No per-call cent rounding.
  const units=Math.round(a*1e9)+Math.round(b*1e9);
  return Number.isSafeInteger(units)?units/1e9:a+b;
}
export function addCost(target, value) {
  for (const key of Object.keys(target)) {
    const n = value?.[key];
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0) target[key] = MONEY_FIELDS.has(key)?addMoney(target[key],n):target[key]+n;
  }
  return target;
}
/** One disjoint speed bucket. Old aggregates without evidence are unknown. */
export function speedTotals(value, speed) {
  const source = value?.speeds ? value.speeds[speed]
    : speedOf(value) === speed ? value : null;
  const bucket = { speed, ...zero(), cost:zeroCost() };
  if (!source) return bucket;
  for (const key of [...METRICS, 'requests']) bucket[key] = count(source[key]);
  bucket.cost = addCost(zeroCost(), costOf(source));
  return bucket;
}
/** Add tokens, pre-priced costs and disjoint speed subtotals without recursion. */
export function addPriced(target, value) {
  const prior = target.cost || unknownCost(target);
  const incoming = costOf(value);
  const speeds = {};
  for (const speed of SPEEDS) {
    const bucket = speedTotals(target, speed), next = speedTotals(value, speed);
    add(bucket, next);
    addCost(bucket.cost, next.cost);
    speeds[speed] = bucket;
  }
  add(target,value);
  target.cost = addCost(prior,incoming);
  target.speeds = speeds;
  return target;
}
export function priceRecord(record) {
  const id = canonicalModel(record.model);
  const tokens = total(record);
  if (!tokens) return zeroCost();
  if (!id) return unknownCost(record);
  const prompt = count(record.read)+count(record.write)+count(record.input);
  const speed = speedOf(record);
  const base = speed === 'fast' ? FAST_API_RATES[id] : API_RATES[id];
  if (!base) return unknownCost(record); // Never value an unverified Fast model as standard.
  if (base.maxVerifiedPrompt && prompt > base.maxVerifiedPrompt) return unknownCost(record);
  const r = base.threshold && prompt > base.threshold ? base.long : base;
  let five = count(record.write5m), hour = count(record.write1h);
  const writes = count(record.write);
  // Inconsistent details are unknown, never extra tokens or a negative remainder.
  if (five+hour > writes) { five=0; hour=0; }
  const unknown = writes-five-hour;
  const cost = { ...zeroCost(),
    read:count(record.read)*r.read/1e6, input:count(record.input)*r.input/1e6, output:count(record.output)*r.output/1e6,
    write:(five*r.write5m+hour*r.write1h+unknown*r.write5m)/1e6,
    writeMax:(five*r.write5m+hour*r.write1h+unknown*r.write1h)/1e6,
    pricedTokens:tokens, pricedRequests:count(record.requests)||1, unknownWriteTokens:unknown,
    // Retain the previous standard-equivalent estimate, but explicitly flag the
    // assumption. Unknown speed is never counted as an observed Standard request.
    assumedStandardTokens:speed === 'unknown' ? tokens : 0,
    assumedStandardRequests:speed === 'unknown' ? count(record.requests)||1 : 0 };
  cost.total = cost.read+cost.write+cost.input+cost.output;
  cost.totalMax = cost.read+cost.writeMax+cost.input+cost.output;
  for (const key of MONEY_FIELDS) cost[key]=addMoney(0,cost[key]);
  return cost;
}
export function costStatus(cost) {
  if (cost.unpricedTokens && !cost.pricedTokens) return 'unavailable';
  if (cost.unpricedTokens) return 'partial';
  if (cost.unknownWriteTokens) return 'range';
  return cost.pricedTokens ? 'estimated' : 'empty';
}
export function formatUsd(n, compact=false) {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (compact && n >= 1e6) return '$'+(n/1e6).toFixed(1)+'M';
  if (compact && n >= 1e3) return '$'+(n/1e3).toFixed(1)+'k';
  if (n > 0 && n < .0001) return '<$0.0001';
  const decimals=n>0 && n<.01 ? 4 : 2;
  return '$'+n.toLocaleString('en-US',{minimumFractionDigits:decimals,maximumFractionDigits:decimals});
}
export function formatCost(cost, key='total') {
  if (costStatus(cost)==='unavailable') return 'Sem preço';
  const low=cost[key], high=key==='total'?cost.totalMax:key==='write'?cost.writeMax:low;
  return Math.abs(high-low)>1e-10 ? formatUsd(low)+' – '+formatUsd(high) : formatUsd(low);
}
export function pricingMetadata() {
  return { version:PRICING_VERSION, asOf:PRICING_DATE, currency:'USD', basis:'current-api-equivalent-by-response-speed', unknownSpeedBasis:'standard-assumption', source:PRICING_SOURCE };
}
export const COST_CSV_HEADERS = ['api_cost_status','api_cost_currency','api_price_date','api_equivalent_usd_min','api_equivalent_usd_max',
  'api_cache_read_usd','api_cache_write_usd_min','api_cache_write_usd_max','api_input_usd','api_output_usd',
  'api_priced_tokens','api_unpriced_tokens','cache_write_unknown_ttl_tokens',
  'api_standard_assumed_tokens','api_standard_assumed_requests'];
export function costCsvCells(value) {
  const c=costOf(value), status=costStatus(c);
  const money=n=>status==='unavailable'?'':n.toFixed(9);
  return [status,'USD',PRICING_DATE,...[c.total,c.totalMax,c.read,c.write,c.writeMax,c.input,c.output].map(money),
    c.pricedTokens,c.unpricedTokens,c.unknownWriteTokens,c.assumedStandardTokens,c.assumedStandardRequests];
}

// Appended columns keep all pre-existing CSV column positions stable.
export const SPEED_CSV_HEADERS = SPEEDS.flatMap(speed =>
  ['requests','cache_read_tokens','cache_write_tokens','new_input_tokens','output_tokens',
    'total_tokens','api_equivalent_usd_min','api_equivalent_usd_max'].map(key => speed+'_'+key));
export function speedCsvCells(value) {
  return SPEEDS.flatMap(speed => {
    const b=speedTotals(value,speed), c=b.cost;
    const money=n=>costStatus(c)==='unavailable'?'':n.toFixed(9);
    return [b.requests,b.read,b.write,b.input,b.output,total(b),money(c.total),money(c.totalMax)];
  });
}
