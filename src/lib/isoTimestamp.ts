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

/**
 * Ascending comparator for timestamp strings. `Date.parse(a) - Date.parse(b)`
 * returns NaN for an unparseable value, which sorts as "equal" to everything
 * and breaks transitivity, so valid rows around it can come out of order.
 * Unparseable values sort last, deterministically.
 */
export function compareIsoAsc(a: string | null | undefined, b: string | null | undefined): number {
  const x = a ? Date.parse(a) : NaN;
  const y = b ? Date.parse(b) : NaN;
  const xOk = Number.isFinite(x);
  const yOk = Number.isFinite(y);
  if (xOk && yOk) return x - y;
  if (xOk) return -1;
  if (yOk) return 1;
  return 0;
}

/**
 * Descending (newest first) comparator. Unparseable values sort last, so a
 * malformed row can never be picked as "latest" or break the order of valid rows.
 */
export function compareIsoDesc(a: string | null | undefined, b: string | null | undefined): number {
  const x = a ? Date.parse(a) : NaN;
  const y = b ? Date.parse(b) : NaN;
  const xOk = Number.isFinite(x);
  const yOk = Number.isFinite(y);
  if (xOk && yOk) return y - x;
  if (xOk) return -1;
  if (yOk) return 1;
  return 0;
}
