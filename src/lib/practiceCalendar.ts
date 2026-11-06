/**
 * Practice calendar: the last 12 weeks of finished debates as a grid of days,
 * copied from the activity heat map in DebateMaster AI (and GitHub's
 * contribution graph). It shows when the learner practised, nothing about how
 * well: each cell is a count of finished debates on that local day.
 */

import { dateKeyInTimeZone } from "./timeZone";

export const CALENDAR_WEEKS = 12;
const DAY_MS = 86_400_000;

export interface CalendarDay {
  key: string;
  count: number;
  /** 0 none, 1 one debate, 2 two, 3 three or more. */
  level: 0 | 1 | 2 | 3;
  isFuture: boolean;
}

function keyToTime(key: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const t = Date.parse(`${key}T00:00:00Z`);
  return Number.isNaN(t) ? null : t;
}

/**
 * Weeks run Monday to Sunday, oldest first, ending with the week that holds
 * `todayKey`. Timestamps that do not parse are skipped, never guessed.
 */
export function practiceCalendar(
  completedAt: readonly (string | Date | null | undefined)[],
  timeZone: string,
  todayKey: string,
  weeks = CALENDAR_WEEKS,
): CalendarDay[][] {
  const today = keyToTime(todayKey);
  if (today === null || weeks < 1) return [];
  const counts = new Map<string, number>();
  for (const value of completedAt) {
    if (!value) continue;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) continue;
    const key = dateKeyInTimeZone(timeZone, date);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const offset = (new Date(today).getUTCDay() + 6) % 7;
  const firstMonday = today - offset * DAY_MS - (weeks - 1) * 7 * DAY_MS;
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const time = firstMonday + (w * 7 + d) * DAY_MS;
      const key = new Date(time).toISOString().slice(0, 10);
      const count = counts.get(key) ?? 0;
      const level = (count >= 3 ? 3 : count) as CalendarDay["level"];
      return { key, count, level, isFuture: time > today };
    }),
  );
}

/** Days with at least one finished debate across the grid. */
export function practisedDayCount(grid: CalendarDay[][]): number {
  return grid.reduce((sum, week) => sum + week.filter((day) => day.count > 0).length, 0);
}
