import "server-only";

import { isDatabaseConfigured } from "./backend/env";
import { queryRows } from "./backend/sql";

/** Solo debates this learner has finished, or null when unreadable (never shown as zero). */
export async function countFinishedDebates(userId: string): Promise<number | null> {
  if (!isDatabaseConfigured()) return null;
  try {
    const [row] = await queryRows<{ n: number }>(
      "SELECT count(*)::int AS n FROM solo_debates WHERE user_id = $1 AND status = 'completed'",
      [userId],
    );
    return Number(row?.n ?? 0);
  } catch {
    return null;
  }
}

/** Distinct learners who finished a solo debate on this motion, or null when unreadable. */
export async function countMotionDebaters(topicId: string): Promise<number | null> {
  if (!isDatabaseConfigured()) return null;
  try {
    const [row] = await queryRows<{ n: number }>(
      "SELECT count(DISTINCT user_id)::int AS n FROM solo_debates WHERE topic_id = $1 AND status = 'completed'",
      [topicId],
    );
    return Number(row?.n ?? 0);
  } catch {
    return null;
  }
}
