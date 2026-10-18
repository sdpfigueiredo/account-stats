/** Response evidence only. Requested mode, service tier and latency are NOT proof. */
export const SPEEDS = Object.freeze(['fast', 'standard', 'unknown']);
export function normalizeSpeed(value) {
  return value === 'fast' || value === 'standard' ? value : 'unknown';
}
export function speedOf(record) {
  return record?.speedConflict === true ? 'unknown' : normalizeSpeed(record?.speed);
}
export function speedFilter(value) {
  return SPEEDS.includes(value) ? value : 'all';
}
/** Missing metadata can be enriched; contradictory response evidence stays unknown.
 * A sticky conflict flag makes merging commutative and independent of file order.
 */
export function mergeSpeed(a, b) {
  const left = speedOf(a), right = speedOf(b);
  if (a?.speedConflict === true || b?.speedConflict === true ||
      (left !== 'unknown' && right !== 'unknown' && left !== right)) {
    return { speed: 'unknown', speedConflict: true };
  }
  return { speed: left === 'unknown' ? right : left };
}
