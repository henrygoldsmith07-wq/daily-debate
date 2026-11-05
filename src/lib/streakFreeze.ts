/**
 * Streak freeze (migration 048; copied from Duolingo). One missed day does not
 * end a streak, at most once every seven days. The database trigger applies
 * it when the learner next practises; this module mirrors the rule so Today,
 * the header and the push reminder can say what will happen before they do.
 *
 * Keep STREAK_FREEZE_COOLDOWN_DAYS equal to the 7 in 048_streak_freeze.sql.
 */

export const STREAK_FREEZE_COOLDOWN_DAYS = 7;

const DAY_MS = 86_400_000;

function dayNumber(key: string | null | undefined): number | null {
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const time = Date.parse(`${key}T00:00:00Z`);
  return Number.isNaN(time) ? null : Math.round(time / DAY_MS);
}

function dayKey(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** True when a freeze may cover `missedDay`, given the last day one covered. */
export function freezeAvailableFor(missedDay: string, usedOn: string | null | undefined): boolean {
  const missed = dayNumber(missedDay);
  if (missed === null) return false;
  const used = dayNumber(usedOn);
  return used === null || used <= missed - STREAK_FREEZE_COOLDOWN_DAYS;
}

export interface StreakInput {
  currentStreak: number;
  lastActivityDate: string | null | undefined;
  freezeUsedOn: string | null | undefined;
  /** Today in the learner's timezone, YYYY-MM-DD. */
  today: string;
}

export type StreakStatus =
  /** No streak, or it has lapsed. */
  | { state: "none"; streak: 0 }
  /** Practised today. `frozenDay` is set when a freeze sits inside the visible streak. */
  | { state: "practised_today"; streak: number; frozenDay: string | null }
  /** Practised yesterday; today keeps it going. */
  | { state: "due_today"; streak: number; frozenDay: string | null }
  /** Missed yesterday, and a freeze will cover it if the learner practises today. */
  | { state: "freeze_holding"; streak: number; frozenDay: string };

export function streakStatus(input: StreakInput): StreakStatus {
  const today = dayNumber(input.today);
  const last = dayNumber(input.lastActivityDate);
  const streak = Math.floor(input.currentStreak);
  if (today === null || last === null || !(streak > 0) || last > today) return { state: "none", streak: 0 };

  const used = dayNumber(input.freezeUsedOn);
  // A freeze already used inside this streak, recent enough to show on the week row.
  const recentFrozen = used !== null && used < last && used > last - 7 ? dayKey(used) : null;

  if (last === today) return { state: "practised_today", streak, frozenDay: recentFrozen };
  if (last === today - 1) return { state: "due_today", streak, frozenDay: recentFrozen };
  if (last === today - 2 && freezeAvailableFor(dayKey(today - 1), input.freezeUsedOn)) {
    return { state: "freeze_holding", streak, frozenDay: dayKey(today - 1) };
  }
  return { state: "none", streak: 0 };
}

/**
 * The practised days a live streak covers, newest first, up to `limit`,
 * skipping the frozen day (a frozen day is kept, not practised).
 */
export function streakPractisedDays(status: StreakStatus, lastActivityDate: string | null | undefined, limit = 7): string[] {
  if (status.state === "none") return [];
  const last = dayNumber(lastActivityDate);
  if (last === null) return [];
  const frozen = dayNumber(status.frozenDay);
  const days: string[] = [];
  for (let day = last; days.length < Math.min(status.streak, limit); day -= 1) {
    if (day === frozen) continue;
    days.push(dayKey(day));
  }
  return days;
}

/** One line for the week row, or null when the freeze has nothing to say. */
export function streakFreezeNote(status: StreakStatus, today: string): string | null {
  if (status.state === "freeze_holding") {
    return `A streak freeze is covering yesterday. Debate today to keep your ${status.streak}-day streak.`;
  }
  const yesterday = dayNumber(today);
  if (status.state === "practised_today" && yesterday !== null && status.frozenDay === dayKey(yesterday - 1)) {
    return "A streak freeze covered yesterday, so your streak carried on.";
  }
  return null;
}
