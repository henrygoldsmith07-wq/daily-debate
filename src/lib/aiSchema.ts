// Output-schema validation for AI provider responses. A provider returning a
// well-formed HTTP response with garbage/missing fields must count as a
// failure so the caller can fall back to the alternate provider instead of
// persisting junk. Pure functions — unit-tested.

function isNonEmptyString(value: unknown, min: number, max: number): boolean {
  return typeof value === "string" && value.trim().length >= min && value.length <= max;
}

export function isValidGeneratedTopic(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (!isNonEmptyString(o.title, 4, 200)) return false;
  if (!isNonEmptyString(o.prompt, 10, 1000)) return false;
  if (!isNonEmptyString(o.category, 2, 60)) return false;
  if (!Array.isArray(o.sources) || o.sources.length === 0 || o.sources.length > 8) return false;
  return o.sources.every((s) => {
    if (typeof s !== "object" || s === null) return false;
    const src = s as Record<string, unknown>;
    return isNonEmptyString(src.name, 2, 120);
  });
}

export function isValidOpening(v: unknown): boolean {
  // debateOpening returns a bare string.
  return isNonEmptyString(v, 16, 4000);
}

export function isValidDebateTurn(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return isNonEmptyString(o.aiMessage, 16, 6000) && isNonEmptyString(o.feedback, 4, 2000);
}

export function isValidSummary(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (!isNonEmptyString(o.overallFeedback, 12, 4000)) return false;
  for (const key of ["strengths", "improvements"] as const) {
    const arr = o[key];
    if (!Array.isArray(arr) || arr.length > 6) return false;
    if (!arr.every((s) => isNonEmptyString(s, 1, 500))) return false;
  }
  return true;
}
