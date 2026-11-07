import "server-only";

import { isDatabaseConfigured } from "./backend/env";
import { queryRows } from "./backend/sql";
import { PAST_MOTION_DAYS, shapePastMotions, type PastMotion, type PastMotionRow } from "./pastMotions";

/**
 * The last 30 daily motions with this learner's state on each, or null when
 * unreadable (shown as an error, never as an empty library). Days are UTC,
 * the same calendar the daily motion rolls over on.
 */
export async function loadPastMotions(userId: string, now: Date = new Date()): Promise<PastMotion[] | null> {
  if (!isDatabaseConfigured()) return null;
  const todayKey = now.toISOString().slice(0, 10);
  try {
    const rows = await queryRows<PastMotionRow>(
      `SELECT t.id, t.topic_date::text AS topic_date, t.title, t.category,
              EXISTS (SELECT 1 FROM solo_debates d WHERE d.topic_id = t.id AND d.user_id = $1 AND d.status = 'completed') AS debated,
              (SELECT d.id FROM solo_debates d WHERE d.topic_id = t.id AND d.user_id = $1 AND d.status = 'active'
                ORDER BY d.created_at DESC LIMIT 1) AS active_id
         FROM daily_topics t
        WHERE t.topic_date < $2::date AND t.topic_date >= $2::date - $3::int
        ORDER BY t.topic_date DESC
        LIMIT $3`,
      [userId, todayKey, PAST_MOTION_DAYS],
    );
    return shapePastMotions(rows, todayKey);
  } catch (error) {
    console.error("past motions read failed:", error instanceof Error ? error.message : "unknown");
    return null;
  }
}
