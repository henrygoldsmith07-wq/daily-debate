import "server-only";

import { queryRows } from "./backend/sql";
import {
  buildPoliticalIdentifier,
  isStancePosition,
  type PoliticalIdentifierModel,
  type StanceRecord,
} from "./politicalIdentifier";

interface StanceRow {
  position: unknown;
  category: unknown;
  created_at: unknown;
}

function toIsoString(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return undefined;
}

/**
 * The learner's positions, read from records already stored by the debate
 * loop — no new scoring call. Unreadable data is reported as null (shown as a
 * quiet absence, never as a fabricated read), matching the other server
 * loaders. The pure builder handles the small-sample and copy rules.
 */
export async function loadPoliticalIdentifier(userId: string): Promise<PoliticalIdentifierModel | null> {
  try {
    const rows = await queryRows<StanceRow>(
      `SELECT mp.position, dt.category, mp.created_at
         FROM motion_positions mp
         LEFT JOIN daily_topics dt ON dt.id = mp.topic_id
        WHERE mp.user_id = $1
        ORDER BY mp.created_at ASC`,
      [userId],
    );

    const records: StanceRecord[] = [];
    for (const row of rows) {
      // Ignore anything that is not a recorded for/against stance.
      if (!isStancePosition(row.position)) continue;
      const category = typeof row.category === "string" ? row.category : null;
      const at = toIsoString(row.created_at);
      records.push(at === undefined ? { position: row.position, category } : { position: row.position, category, at });
    }

    return buildPoliticalIdentifier(records);
  } catch {
    return null;
  }
}
