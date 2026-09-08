// Daily Sprint — the low-friction practice format.
//
// A Sprint is roughly three rounds and a few minutes long. It runs through the
// same argument/evaluation pipeline as a full debate, but its measurements are
// explicitly lower-confidence: a three-round sample cannot support the same
// claims a 5–12 round debate can. Pure config + helpers; routes consume these.

export type DebateFormat = "sprint" | "full";

export const SPRINT_ROUNDS = 3;
/** Full debates keep the existing 5-round minimum (types.ts MIN_ROUNDS). */
export const SPRINT_ESTIMATE_MINUTES = 4;

export type MeasurementConfidence = "standard" | "reduced";

export interface MeasurementHonesty {
  format: DebateFormat;
  confidence: MeasurementConfidence;
  note: string | null;
}

const SPRINT_NOTE =
  "Sprint read: a 3-round session is a small sample. Treat this as practice signal, not a measurement of your ability.";

/** Minimum answered rounds before a debate may be finished and scored. */
export function minRoundsFor(format: DebateFormat): number {
  return format === "sprint" ? SPRINT_ROUNDS : 5;
}

/** Hard round cap: past this the debate must be finished rather than extended. */
export function roundCapFor(format: DebateFormat): number {
  return format === "sprint" ? SPRINT_ROUNDS : 12;
}

/**
 * Measurement honesty for a finished session. Short sessions get reduced
 * confidence with an explicit note; full debates carry the standard caveat
 * set (extraction confidence, uncertainty list) and no extra penalty.
 */
export function measurementHonestyFor(format: DebateFormat | null | undefined): MeasurementHonesty {
  if (format === "sprint") {
    return { format: "sprint", confidence: "reduced", note: SPRINT_NOTE };
  }
  return { format: "full", confidence: "standard", note: null };
}

export function formatEstimateLabel(format: DebateFormat): string {
  return format === "sprint" ? `~${SPRINT_ESTIMATE_MINUTES} min · ${SPRINT_ROUNDS} rounds` : "5–12 rounds · deeper read";
}

/** Validate a client-supplied format; anything unknown falls back to full. */
export function resolveDebateFormat(value: unknown): DebateFormat {
  return value === "sprint" ? "sprint" : "full";
}
