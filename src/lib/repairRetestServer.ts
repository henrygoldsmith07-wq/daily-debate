import "server-only";

import { createServiceClient } from "@/lib/backend/server";
import type { RepairRetestAnchor } from "./repairRetest";

/**
 * Latest SUCCESSFUL repair for a user.
 *
 * Raw failed attempts remain valuable practice history, but they must not
 * schedule "Retest after repair" or make the product claim a weakness was
 * repaired. Retries are still preserved in repair_results; once any retry
 * succeeds, that successful attempt becomes the retest anchor.
 */
export async function latestRepairRetestAnchor(
  userId: string,
): Promise<RepairRetestAnchor | null> {
  const service = createServiceClient();
  const { data } = await service
    .from("repair_results")
    .select("debate_id, target_kind, created_at")
    .eq("user_id", userId)
    .eq("succeeded", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return {
    debateId: data.debate_id,
    targetKind: data.target_kind,
    attemptedAt: data.created_at,
  };
}
