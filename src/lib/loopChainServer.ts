import "server-only";

import { createServiceClient } from "@/lib/backend/server";
import { buildLoopChain, type ChainEntry, type ChainKind } from "./loopChain";

/** Recent repair -> retest chains for one user; bounded reads. */
export async function loadLoopChain(userId: string): Promise<ChainEntry[]> {
  const service = createServiceClient();
  const [repairs, retests] = await Promise.all([
    service.from("repair_results").select("id, target_kind, created_at, succeeded").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
    service.from("repair_retests").select("repair_result_id, assigned_at, completed_at, observable, demonstrated").eq("user_id", userId).order("assigned_at", { ascending: false }).limit(200),
  ]);
  for (const r of [repairs, retests]) if (r.error) throw new Error(r.error.message ?? "loop chain unavailable");
  return buildLoopChain(
    (repairs.data ?? []).map((r) => ({ id: r.id, targetKind: r.target_kind as ChainKind, createdAt: r.created_at, succeeded: r.succeeded })),
    (retests.data ?? []).map((r) => ({ repairResultId: r.repair_result_id, assignedAt: r.assigned_at, completedAt: r.completed_at, observable: r.observable, demonstrated: r.demonstrated })),
  );
}
