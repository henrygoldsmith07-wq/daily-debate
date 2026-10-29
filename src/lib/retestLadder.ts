// Retest difficulty ladder (M12, slice 1: pure policy).
//
// After consecutive passed retests on the same skill, the learner is offered
// a harder level. This is a practice-difficulty choice, NOT a skill score:
// levels are unvalidated and never compared across learners. A step up needs
// a minimum number of observed retests; below that we say so instead of
// guessing (insufficient_evidence).

export const LADDER_LEVELS = ["standard", "tougher", "hardest"] as const;
export type LadderLevel = (typeof LADDER_LEVELS)[number];

/** Consecutive passed retests needed to be offered the next level. */
export const LADDER_PASSES_TO_STEP = 2;
/** Observed (non-inconclusive) retests needed before any ladder claim. */
export const LADDER_MIN_OBSERVED = 2;

export type LadderOutcome = "passed" | "failed" | "inconclusive";

export interface LadderState {
  level: LadderLevel;
  offerLevel: LadderLevel | null;
  consecutivePasses: number;
  observed: number;
  status: "insufficient_evidence" | "steady" | "offer" | "stepped-back";
}

export function isLadderLevel(v: unknown): v is LadderLevel {
  return typeof v === "string" && (LADDER_LEVELS as readonly string[]).includes(v);
}

/**
 * Fold chronological retest outcomes (oldest first) for ONE skill into a
 * ladder state. Inconclusive outcomes are ignored: they neither advance nor
 * reset. A failed retest steps back one level and resets the streak.
 */
export function ladderState(outcomes: readonly LadderOutcome[]): LadderState {
  let level = 0;
  let streak = 0;
  let observed = 0;
  let steppedBack = false;
  for (const o of outcomes) {
    if (o === "inconclusive") continue;
    observed += 1;
    if (o === "passed") {
      streak += 1;
      steppedBack = false;
      if (streak >= LADDER_PASSES_TO_STEP && level < LADDER_LEVELS.length - 1) {
        level += 1;
        streak = 0;
      }
    } else {
      streak = 0;
      if (level > 0) {
        level -= 1;
        steppedBack = true;
      }
    }
  }
  if (observed < LADDER_MIN_OBSERVED) {
    return { level: "standard", offerLevel: null, consecutivePasses: streak, observed, status: "insufficient_evidence" };
  }
  const atTop = level >= LADDER_LEVELS.length - 1;
  const justStepped = observed > 0 && streak === 0 && !steppedBack && level > 0 && outcomes.at(-1) === "passed";
  return {
    level: LADDER_LEVELS[level],
    offerLevel: justStepped && !atTop ? LADDER_LEVELS[level + 1] : null,
    consecutivePasses: streak,
    observed,
    status: steppedBack ? "stepped-back" : justStepped ? "offer" : "steady",
  };
}

export function ladderCopy(s: LadderState): string | null {
  switch (s.status) {
    case "insufficient_evidence":
      return "Not enough retests on this skill yet to adjust difficulty (unvalidated practice setting).";
    case "offer":
      return `Two passed retests in a row. Try the ${s.level} level next (practice setting, not a score).`;
    case "stepped-back":
      return `Last retest needed another pass, so difficulty is back at ${s.level}.`;
    default:
      return null;
  }
}
