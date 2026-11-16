import "server-only";

import { isDatabaseConfigured } from "./backend/env";
import { queryRows } from "./backend/sql";

export interface StreakFreezeWeek {
  /** Monday of the week the frozen day fell in, YYYY-MM-DD. */
  weekStart: string;
  /** Streaks a freeze kept alive that week. */
  used: number;
  /** Distinct learners whose streak was kept. */
  learners: number;
}

/** Weekly streak freezes used (048), newest first; null when unreadable (never shown as zero). */
export async function loadStreakFreezeWeeks(weeks = 8): Promise<StreakFreezeWeek[] | null> {
  if (!isDatabaseConfigured()) return null;
  try {
    const rows = await queryRows<{ week_start: string | Date; used: number; learners: number }>(
      `SELECT date_trunc('week', frozen_day)::date AS week_start,
              count(*)::int AS used,
              count(DISTINCT user_id)::int AS learners
         FROM streak_freeze_uses
        WHERE frozen_day >= (now() AT TIME ZONE 'utc')::date - ($1::int * 7)
        GROUP BY 1
        ORDER BY 1 DESC`,
      [weeks],
    );
    return rows.map((row) => ({
      weekStart: typeof row.week_start === "string" ? row.week_start.slice(0, 10) : row.week_start.toISOString().slice(0, 10),
      used: Number(row.used),
      learners: Number(row.learners),
    }));
  } catch {
    return null;
  }
}
