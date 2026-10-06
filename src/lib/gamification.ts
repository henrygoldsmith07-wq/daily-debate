import type { TurnScores } from "./types";

export const POINTS_PER_LEVEL = 500;

// Legacy display projection: observableAssessment.ts derives these five
// buckets from graph features before this helper is called. Keeping the sum
// here preserves the existing points scale (0-50 per turn) without allowing a
// model to author the point value directly.
export function pointsForTurn(scores: TurnScores): number {
  return scores.depth + scores.evidence + scores.logic + scores.rebuttal + scores.clarity;
}

export function levelForPoints(points: number): number {
  return Math.floor(points / POINTS_PER_LEVEL) + 1;
}

export function pointsIntoLevel(points: number): number {
  return points % POINTS_PER_LEVEL;
}

export interface StreakUpdate {
  current_streak: number;
  longest_streak: number;
  last_activity_date: string;
}

// Called once per day the user completes at least one debate. `today` and
// `lastActivityDate` are ISO date strings (YYYY-MM-DD).
export function updateStreak(
  today: string,
  lastActivityDate: string | null,
  currentStreak: number,
  longestStreak: number,
): StreakUpdate {
  if (lastActivityDate === today) {
    return { current_streak: currentStreak, longest_streak: longestStreak, last_activity_date: today };
  }

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayIso = yesterday.toISOString().slice(0, 10);

  const nextStreak = lastActivityDate === yesterdayIso ? currentStreak + 1 : 1;
  return {
    current_streak: nextStreak,
    longest_streak: Math.max(longestStreak, nextStreak),
    last_activity_date: today,
  };
}



/**
 * Length-normalized deterministic performance index.
 * Turn points are on the existing 0–50 observable scale; performance maps the
 * mean turn score to 0–100 so a 12-round debate is comparable with a 5-round one.
 */
export function performanceScoreForTurns(turnScores: Array<number | null | undefined>): number {
  const valid = turnScores.filter((score): score is number => typeof score === "number" && Number.isFinite(score));
  if (!valid.length) return 0;
  const average = valid.reduce((sum, score) => sum + score, 0) / valid.length;
  return Math.max(0, Math.min(100, Math.round((average / 50) * 100)));
}
