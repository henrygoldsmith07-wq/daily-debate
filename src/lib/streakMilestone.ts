/**
 * Streak milestones on the result screen, copied from Duolingo's streak
 * celebrations. A milestone is only the stored streak reaching one of these
 * lengths on the debate that just finished; it says nothing about skill.
 */
export const STREAK_MILESTONES = [7, 14, 30, 50, 100, 200, 365, 500, 1000] as const;

export interface StreakMilestoneView {
  days: number;
  title: string;
  detail: string;
}

export function streakMilestone(streak: number | null | undefined): StreakMilestoneView | null {
  if (typeof streak !== "number" || !(STREAK_MILESTONES as readonly number[]).includes(streak)) return null;
  const detail =
    streak === 7
      ? "A full week of debates in a row."
      : streak === 365
        ? "A year of debates in a row."
        : `${streak} days of debates in a row.`;
  return { days: streak, title: `${streak}-day streak`, detail };
}
