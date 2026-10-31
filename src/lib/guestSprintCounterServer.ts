import "server-only";

import { isDatabaseConfigured } from "./backend/env";
import { queryRows } from "./backend/sql";

// Anonymous day-level counters for live guest sprints (migration 043).
// Two integers per UTC day and nothing else — see the migration header.

export type GuestSprintMilestone = "started" | "completed";

/** Best effort: a counter that cannot be written never fails a guest's sprint. */
export async function recordGuestSprint(milestone: GuestSprintMilestone): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const started = milestone === "started" ? 1 : 0;
  const completed = milestone === "completed" ? 1 : 0;
  try {
    await queryRows(
      `INSERT INTO guest_sprint_daily (day, started, completed)
       VALUES ((now() AT TIME ZONE 'utc')::date, $1, $2)
       ON CONFLICT (day) DO UPDATE
         SET started = guest_sprint_daily.started + EXCLUDED.started,
             completed = guest_sprint_daily.completed + EXCLUDED.completed,
             updated_at = now()`,
      [started, completed],
    );
  } catch (error) {
    console.warn("guest sprint counter unavailable:", error instanceof Error ? error.message : "unknown");
  }
}

export interface GuestSprintWeek {
  /** Monday (UTC) of the week, YYYY-MM-DD. */
  weekStart: string;
  started: number;
  completed: number;
}

/**
 * Weekly sums, newest first. Null when the table cannot be read — an
 * availability failure, never reported as zero activity.
 */
export async function loadGuestSprintWeeks(weeks = 8): Promise<GuestSprintWeek[] | null> {
  if (!isDatabaseConfigured()) return null;
  try {
    const rows = await queryRows<{ week_start: string | Date; started: number; completed: number }>(
      `SELECT date_trunc('week', day)::date AS week_start,
              SUM(started)::int AS started,
              SUM(completed)::int AS completed
         FROM guest_sprint_daily
        WHERE day >= (now() AT TIME ZONE 'utc')::date - ($1::int * 7)
        GROUP BY 1
        ORDER BY 1 DESC`,
      [weeks],
    );
    return rows.map((row) => ({
      weekStart: typeof row.week_start === "string" ? row.week_start.slice(0, 10) : row.week_start.toISOString().slice(0, 10),
      started: Number(row.started),
      completed: Number(row.completed),
    }));
  } catch {
    return null;
  }
}
