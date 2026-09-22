import "server-only";

import { createServiceClient } from "@/lib/backend/server";
import {
  COACH_DIMENSIONS,
  type CoachDimension,
} from "./adaptiveCoach";

/**
 * Latest measured drill movement per dimension.
 *
 * Every surface that selects a generic coaching focus must consume this same
 * context. Otherwise Today can recommend one skill while the drill API skips
 * it because its previous intervention produced negative movement.
 */
export async function latestDrillOutcomes(
  userId: string,
): Promise<Partial<Record<CoachDimension, number>>> {
  const service = createServiceClient();
  const { data } = await service
    .from("drill_assignments")
    .select("dimension, movement")
    .eq("user_id", userId)
    .not("movement", "is", null)
    .order("created_at", { ascending: false })
    .limit(12);

  const valid = new Set<string>(COACH_DIMENSIONS);
  const outcomes: Partial<Record<CoachDimension, number>> = {};
  for (const row of data ?? []) {
    if (
      !valid.has(row.dimension) ||
      typeof row.movement !== "number" ||
      outcomes[row.dimension as CoachDimension] !== undefined
    ) {
      continue;
    }
    outcomes[row.dimension as CoachDimension] = row.movement;
  }
  return outcomes;
}
