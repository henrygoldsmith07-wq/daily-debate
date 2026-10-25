/**
 * Normalise a timestamptz value from the Postgres layer to an ISO string.
 * Returns null for anything missing or unparseable. Callers must drop the row
 * rather than stamp "now": a fabricated timestamp makes an old retest verdict
 * look recent and silently moves the coaching/retest clock.
 */
export function toIsoOrNull(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? value : null;
}
