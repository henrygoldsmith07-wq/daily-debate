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
  /** Length-normalised solo performance on a 0–100 scale. */
  performanceScore: number | null;
}

export type ChallengeRule = "random-cold-start" | "random-history-unavailable" | "side-balance" | "performance-gap" | "alternation-fallback";

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

/**
 * Solo turn_score is 0..50 and debate total_score is a SUM across turns.
 * Normalise before comparing debates of different lengths/formats.
 */
export function normaliseSoloPerformance(
  totalScore: number | null,
  answeredTurns: number,
): number | null {
  if (
    totalScore === null ||
    !Number.isFinite(totalScore) ||
    !Number.isInteger(answeredTurns) ||
    answeredTurns <= 0
  ) {
    return null;
  }
  return Math.max(0, Math.min(100, (totalScore * 2) / answeredTurns));
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
  options?: { random?: () => number; historyUnavailable?: boolean },
): ChallengeAssignment {
  const recent = history.slice(-LOOKBACK);

  if (options?.historyUnavailable) {
    const side = pickRandom(options);
    return {
      side,
      rule: "random-history-unavailable",
      reason: `Recent debate history is temporarily unavailable — picked ${label(side)} at random so you can keep practising.`,
    };
  }

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
  const forScores = recent.filter((h) => h.side === "for").map((h) => h.performanceScore).filter((s): s is number => s !== null);
  const againstScores = recent.filter((h) => h.side === "against").map((h) => h.performanceScore).filter((s): s is number => s !== null);
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

/**
 * Deterministic [0, 1) source for the cold-start / history-unavailable coin
 * flip, keyed on (user, motion).
 *
 * The home screen reveals the "Challenge me" side BEFORE the debate starts,
 * and the start route recomputes it. With `Math.random` the two could
 * disagree on a cold start — the screen would promise FOR and the debate
 * would open on AGAINST. Seeding the flip on the same key makes the preview
 * a promise the start keeps, while different motions (and different users)
 * still land on both sides roughly evenly. Not a security boundary: a user
 * who wants a specific side can simply pick it.
 */
export function seededChallengeRandom(seed: string): () => number {
  // FNV-1a (32-bit) — tiny, stable across runtimes, good enough spread for a
  // coin flip.
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Final avalanche so seeds differing only in their last character still
  // spread across both halves of [0, 1).
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  const value = (hash >>> 0) / 0x1_0000_0000;
  return () => value;
}

/** The (user, motion) key both the preview and the start use. */
export function challengeSeed(userId: string, topicId: string): string {
  return `challenge:${userId}:${topicId}`;
}

/** What the start screen shows for "Challenge me" before the debate begins. */
export interface ChallengePreview {
  side: DebateSide;
  reason: string;
  rule: ChallengeRule;
}

/**
 * Start-screen headline for a previewed side. The assignment's own `reason`
 * follows it, and already says "at random" for random picks, so the reveal
 * never reads as a personalised judgement it isn't.
 */
export function challengePreviewHeadline(preview: Pick<ChallengePreview, "side">): string {
  return `You'll argue ${label(preview.side)}`;
}
