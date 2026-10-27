import "server-only";

import { queryRows } from "@/lib/backend/sql";
import type { MotionPosition, PositionCounts } from "@/lib/positionTally";

/** The learner's stated position on a motion, if they have given one. */
export async function readPosition(userId: string, topicId: string): Promise<MotionPosition | null> {
  const rows = await queryRows<{ position: MotionPosition }>(
    "SELECT position FROM motion_positions WHERE user_id = $1 AND topic_id = $2",
    [userId, topicId],
  );
  return rows[0]?.position ?? null;
}

/** State or change a position. Changing it is always allowed; the row keeps when it was first given. */
export async function writePosition(userId: string, topicId: string, position: MotionPosition): Promise<void> {
  await queryRows(
    `INSERT INTO motion_positions (user_id, topic_id, position)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, topic_id) DO UPDATE
       SET position = excluded.position, updated_at = now()`,
    [userId, topicId, position],
  );
}

/** Raw counts for a motion. Callers show them only through positionTallyView. */
export async function countPositions(topicId: string): Promise<PositionCounts> {
  const rows = await queryRows<{ position: MotionPosition; n: number | string }>(
    "SELECT position, count(*) AS n FROM motion_positions WHERE topic_id = $1 GROUP BY position",
    [topicId],
  );
  const counts: PositionCounts = { for: 0, against: 0 };
  for (const row of rows) counts[row.position] = Number(row.n);
  return counts;
}
