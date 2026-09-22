import "server-only";

import { createServiceClient } from "@/lib/backend/server";
import type { RepairRetestAnchor } from "./repairRetest";

/**
 * Latest submitted repair attempt for a user. Retries are intentionally useful
 * here: coaching should test the most recently practised version. Longitudinal
 * effectiveness analytics still collapses those raw attempts into one repair
 * episode; this helper only decides what the user should practise next.
 */
export async function latestRepairRetestAnchor(
  userId: string,
): Promise<RepairRetestAnchor | null> {
  const service = createServiceClient();
  const { data } = await service
    .from("repair_results")
    .select("debate_id, target_kind, created_at")
    .eq("user_id", userId)
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
