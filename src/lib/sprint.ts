// Debate format configuration — the low-friction Sprint, the deep Full debate,
// and three targeted practice formats (Flash, Cross-examination, Socratic).
//
// Every format runs through the same argument/evaluation pipeline, but short or
// structurally narrow formats carry explicitly reduced measurement confidence:
// a three-round or question-only sample cannot support the same claims a
// 5–12 round debate can. Pure config + helpers; routes consume these.

export type DebateFormat = "sprint" | "full" | "flash" | "cross-examination" | "socratic";

export const DEBATE_FORMATS: readonly DebateFormat[] = ["sprint", "full", "flash", "cross-examination", "socratic"];

export const SPRINT_ROUNDS = 3;
/** A Flash debate is a single ~60-second exchange. */
export const FLASH_ROUNDS = 1;
/** Cross-examination and Socratic are fixed four-round probing formats. */
export const CROSS_EXAMINATION_ROUNDS = 4;
export const SOCRATIC_ROUNDS = 4;
/** Full debates keep the existing 5-round minimum (types.ts MIN_ROUNDS). */
export const SPRINT_ESTIMATE_MINUTES = 4;

/** Formats with a fixed length: minimum answered rounds === hard round cap. */
const FIXED_ROUNDS: Record<string, number> = {
  sprint: SPRINT_ROUNDS,
  flash: FLASH_ROUNDS,
  "cross-examination": CROSS_EXAMINATION_ROUNDS,
  socratic: SOCRATIC_ROUNDS,
};

export type MeasurementConfidence = "standard" | "reduced";

export interface MeasurementHonesty {
  format: DebateFormat;
  confidence: MeasurementConfidence;
  note: string | null;
}

const SPRINT_NOTE =
  "Sprint read: a 3-round session is a small sample. Treat this as practice signal, not a measurement of your ability.";
const FLASH_NOTE =
  "Flash read: a single 60-second exchange is a tiny sample. Treat this as practice signal, not a measurement of your ability.";
const CROSS_EXAMINATION_NOTE =
  "Cross-examination read: probing-question rounds exercise a narrow slice of your skills. Treat this as targeted practice signal, not a full measurement.";
const SOCRATIC_NOTE =
  "Socratic read: question-driven rounds measure answer-building, not case construction. Treat this as targeted practice signal, not a full measurement.";

/** Minimum answered rounds before a debate may be finished and scored. */
export function minRoundsFor(format: DebateFormat): number {
  return FIXED_ROUNDS[format] ?? 5;
}

/** Hard round cap: past this the debate must be finished rather than extended. */
export function roundCapFor(format: DebateFormat): number {
  return FIXED_ROUNDS[format] ?? 12;
}

/**
 * Measurement honesty for a finished session. Short or structurally narrow
 * sessions get reduced confidence with an explicit note; full debates carry
 * the standard caveat set (extraction confidence, uncertainty list) and no
 * extra penalty.
 */
export function measurementHonestyFor(format: DebateFormat | null | undefined): MeasurementHonesty {
  if (format === "sprint") {
    return { format: "sprint", confidence: "reduced", note: SPRINT_NOTE };
  }
  if (format === "flash") {
    return { format: "flash", confidence: "reduced", note: FLASH_NOTE };
  }
  if (format === "cross-examination") {
    return { format: "cross-examination", confidence: "reduced", note: CROSS_EXAMINATION_NOTE };
  }
  if (format === "socratic") {
    return { format: "socratic", confidence: "reduced", note: SOCRATIC_NOTE };
  }
  return { format: "full", confidence: "standard", note: null };
}

export function formatEstimateLabel(format: DebateFormat): string {
  switch (format) {
    case "sprint":
      return `~${SPRINT_ESTIMATE_MINUTES} min · ${SPRINT_ROUNDS} rounds`;
    case "flash":
      return `1 round · ~1 min`;
    case "cross-examination":
      return `${CROSS_EXAMINATION_ROUNDS} rounds · ~5 min`;
    case "socratic":
      return `${SOCRATIC_ROUNDS} rounds · ~5 min`;
    default:
      return "5–12 rounds · deeper read";
  }
}

/** Short display label for the result screen and room header. */
export function formatLabelFor(format: DebateFormat): string {
  switch (format) {
    case "sprint":
      return "Sprint";
    case "flash":
      return "Flash";
    case "cross-examination":
      return "Cross-examination";
    case "socratic":
      return "Socratic";
    default:
      return "Full Debate";
  }
}

/** Validate a client-supplied format; anything unknown falls back to full. */
export function resolveDebateFormat(value: unknown): DebateFormat {
  if (typeof value === "string" && (DEBATE_FORMATS as readonly string[]).includes(value)) {
    return value as DebateFormat;
  }
  return "full";
}
