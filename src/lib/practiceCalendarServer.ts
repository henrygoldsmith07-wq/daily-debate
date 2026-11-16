import "server-only";

import { isDatabaseConfigured } from "./backend/env";
import { queryRows } from "./backend/sql";
import { CALENDAR_WEEKS, practiceCalendar, type CalendarDay } from "./practiceCalendar";
import { dateKeyInTimeZone } from "./timeZone";

/**
 * The learner's practice calendar, or an empty grid when it cannot be read:
 * the calendar is cosmetic, so a failed read hides it rather than showing a
 * blank record. Reads a week beyond the grid so no timezone loses its edge.
 */
export async function loadPracticeCalendar(userId: string, timeZone: string, now: Date = new Date()): Promise<CalendarDay[][]> {
  if (!isDatabaseConfigured()) return [];
  try {
    const since = new Date(now.getTime() - (CALENDAR_WEEKS + 1) * 7 * 86_400_000).toISOString();
    const rows = await queryRows<{ completed_at: string | Date | null }>(
      `SELECT completed_at FROM solo_debates
        WHERE user_id = $1 AND status = 'completed' AND completed_at >= $2`,
      [userId, since],
    );
    return practiceCalendar(
      rows.map((row) => row.completed_at),
      timeZone,
      dateKeyInTimeZone(timeZone, now),
    );
  } catch {
    return [];
  }
}
