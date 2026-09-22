import "server-only";

import { createServiceClient } from "@/lib/backend/server";
import {
  COACH_DIMENSIONS,
  movementAround,
  type CoachDimension,
} from "./adaptiveCoach";
import type { SkillMetricPoint } from "./skillLedger";

/**
 * Latest measured drill movement per dimension.
 *
 * Every surface that selects a generic coaching focus must consume this same
 * context. Otherwise Today can recommend one skill while the drill API skips
 * it because its previous intervention produced negative movement.
 */
export async function latestDrillOutcomes(
  userId: string,
  points: SkillMetricPoint[],
): Promise<Partial<Record<CoachDimension, number>>> {
  const service = createServiceClient();
  const { data } = await service
    .from("drill_assignments")
    .select("id, dimension, created_at")
    .eq("user_id", userId)
    .eq("status", "attempted")
    .order("created_at", { ascending: false })
    .limit(30);

  const valid = new Set<string>(COACH_DIMENSIONS);
  const outcomes: Partial<Record<CoachDimension, number>> = {};
  const persistence: Array<Promise<unknown>> = [];

  for (const row of data ?? []) {
    if (!valid.has(row.dimension)) continue;
    const dimension = row.dimension as CoachDimension;
    const measured = movementAround(points, dimension, row.created_at);
    if (measured?.delta === null || measured?.delta === undefined) continue;

    // First row per dimension wins because rows are newest-first.
    if (outcomes[dimension] === undefined) {
      outcomes[dimension] = measured.delta;
    }

    // Persist as a cache/audit field, but selection above already uses the
    // freshly computed value. Navigation order can no longer change coaching.
    persistence.push(
      Promise.resolve(
        service
          .from("drill_assignments")
          .update({ movement: measured.delta })
          .eq("id", row.id),
      ),
    );
  }

  await Promise.allSettled(persistence);
  return outcomes;
}
