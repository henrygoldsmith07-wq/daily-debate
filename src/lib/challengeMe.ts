// "Challenge me" side assignment.
//
// Picks the user's side for a debate when they don't care, choosing the side
// that creates better practice when enough history exists — otherwise random.
// The heuristics are deliberately lightweight and every outcome carries a
// plain-language reason, so the choice is explainable but never presented as
// scientifically optimised. Pure — routes supply history rows.

import type { DebateSide } from "./types";

export interface SideHistoryItem {
  side: DebateSide;
  totalScore: number | null;
}

export type ChallengeRule = "random-cold-start" | "side-balance" | "performance-gap" | "alternation-fallback";

export interface ChallengeAssignment {
  side: DebateSide;
  reason: string;
  /** Which heuristic produced the pick — for honest labelling in the UI. */
  rule: ChallengeRule;
}

const LOOKBACK = 8;
const DOMINANT_SHARE = 0.75;
const DOMINANT_MIN_COUNT = 3;
const PERFORMANCE_LOOKBACK_EACH = 2;
const PERFORMANCE_GAP = 8; // points on the 0–100 debate scale

function other(side: DebateSide): DebateSide {
  return side === "for" ? "against" : "for";
}

function label(side: DebateSide): string {
  return side === "for" ? "FOR" : "AGAINST";
}

function pickRandom(options?: { random?: () => number }): DebateSide {
  const roll = options?.random ? options.random() : Math.random();
  return roll < 0.5 ? "for" : "against";
}

/**
 * Choose a side for the next debate.
 *
 * Rule order:
 *  1. No/minimal history → random (nothing to learn from yet).
 *  2. Side balance: the user has heavily favoured one side recently → hand
 *     them the other side (variety + steelmanning practice).
 *  3. Performance gap: enough debates on BOTH sides and a clear score
 *     difference → give the weaker side (better practice, not comfort).
 *  4. Fallback: alternate from the last debate (keeps both directions warm).
 */
export function assignChallengeSide(
  history: SideHistoryItem[],
  options?: { random?: () => number },
): ChallengeAssignment {
  const recent = history.slice(-LOOKBACK);

  if (recent.length < 2) {
    const side = pickRandom(options);
    return {
      side,
      rule: "random-cold-start",
      reason: `No history yet — picked ${label(side)} at random for a balanced first workout.`,
    };
  }

  // 2. Side balance — repeatedly arguing one side is the strongest signal.
  for (const side of ["for", "against"] as const) {
    const count = recent.filter((h) => h.side === side).length;
    if (count >= DOMINANT_MIN_COUNT && count / recent.length >= DOMINANT_SHARE) {
      const assigned = other(side);
      return {
        side: assigned,
        rule: "side-balance",
        reason: `You've argued ${label(side)} in ${count} of your last ${recent.length} debates — switching to ${label(assigned)} for variety and steelmanning practice.`,
      };
    }
  }

  // 3. Performance gap — only speaks up with several debates on each side.
  const forScores = recent.filter((h) => h.side === "for").map((h) => h.totalScore).filter((s): s is number => s !== null);
  const againstScores = recent.filter((h) => h.side === "against").map((h) => h.totalScore).filter((s): s is number => s !== null);
  if (forScores.length >= PERFORMANCE_LOOKBACK_EACH && againstScores.length >= PERFORMANCE_LOOKBACK_EACH) {
    const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
    const forMean = mean(forScores);
    const againstMean = mean(againstScores);
    if (forMean - againstMean >= PERFORMANCE_GAP) {
      return {
        side: "against",
        rule: "performance-gap",
        reason: `Your average is ${Math.round(forMean - againstMean)} points lower when arguing ${label("against")} — that side gives you better practice right now.`,
      };
    }
    if (againstMean - forMean >= PERFORMANCE_GAP) {
      return {
        side: "for",
        rule: "performance-gap",
        reason: `Your average is ${Math.round(againstMean - forMean)} points lower when arguing ${label("for")} — that side gives you better practice right now.`,
      };
    }
  }

  // 4. Fallback: alternate from the last debate.
  const lastSide = recent[recent.length - 1].side;
  const side = other(lastSide);
  return {
    side,
    rule: "alternation-fallback",
    reason: `Last time you argued ${label(lastSide)} — alternating sides keeps both directions sharp.`,
  };
}
