import "server-only";

import { createServiceClient } from "@/lib/backend/server";
import { toIsoOrNull } from "./isoTimestamp";
import { buildLoopChain, type ChainEntry, type ChainKind } from "./loopChain";

/**
 * Recent repair -> retest chains for one user; bounded reads. Timestamps are
 * normalised here: the Postgres layer returns timestamptz as a Date, and the
 * chain renders them as strings (a Date crashed the History and Progress
 * panels). A row whose stamp cannot be read is dropped by buildLoopChain.
 */
export async function loadLoopChain(userId: string): Promise<ChainEntry[]> {
  const service = createServiceClient();
  const [repairs, retests] = await Promise.all([
    service.from("repair_results").select("id, target_kind, created_at, succeeded").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
    service.from("repair_retests").select("repair_result_id, assigned_at, completed_at, observable, demonstrated").eq("user_id", userId).order("assigned_at", { ascending: false }).limit(200),
  ]);
  for (const r of [repairs, retests]) if (r.error) throw new Error(r.error.message ?? "loop chain unavailable");
  return buildLoopChain(
    (repairs.data ?? []).map((r) => ({ id: r.id, targetKind: r.target_kind as ChainKind, createdAt: toIsoOrNull(r.created_at) ?? "", succeeded: r.succeeded })),
    (retests.data ?? []).map((r) => ({ repairResultId: r.repair_result_id, assignedAt: toIsoOrNull(r.assigned_at) ?? "", completedAt: toIsoOrNull(r.completed_at), observable: r.observable, demonstrated: r.demonstrated })),
  );
}

/** Admin aggregate: newest repairs across all learners (capped); null when unreadable. */
export async function loadAggregateLoopChain(): Promise<{ entries: ChainEntry[]; capped: boolean } | null> {
  try {
    const service = createServiceClient();
    const CAP = 500;
    const [repairs, retests] = await Promise.all([
      service.from("repair_results").select("id, target_kind, created_at, succeeded").order("created_at", { ascending: false }).limit(CAP),
      service.from("repair_retests").select("repair_result_id, assigned_at, completed_at, observable, demonstrated").order("assigned_at", { ascending: false }).limit(CAP * 4),
    ]);
    if (repairs.error || retests.error) return null;
    const entries = buildLoopChain(
      (repairs.data ?? []).map((r) => ({ id: r.id, targetKind: r.target_kind as ChainKind, createdAt: toIsoOrNull(r.created_at) ?? "", succeeded: r.succeeded })),
      (retests.data ?? []).map((r) => ({ repairResultId: r.repair_result_id, assignedAt: toIsoOrNull(r.assigned_at) ?? "", completedAt: toIsoOrNull(r.completed_at), observable: r.observable, demonstrated: r.demonstrated })),
      CAP,
    );
    return { entries, capped: (repairs.data ?? []).length >= CAP };
  } catch {
    return null;
  }
}

/** Admin: stored skill-observed retests (newest 500) for the 7-day re-check funnel; null when unreadable. */
export async function loadRecheckFunnelInputs(): Promise<{ retest_outcome: "skill-observed"; retest_completed_at: string }[] | null> {
  try {
    const service = createServiceClient();
    const { data, error } = await service
      .from("repair_retests")
      .select("completed_at, observable, demonstrated")
      .not("completed_at", "is", null)
      .eq("observable", true)
      .eq("demonstrated", true)
      .order("completed_at", { ascending: false })
      .limit(500);
    if (error) return null;
    return (data ?? []).map((r) => ({ retest_outcome: "skill-observed" as const, retest_completed_at: r.completed_at as string }));
  } catch {
    return null;
  }
}

/** M17: retest assignments for the sent-vs-acted view. completed_at stands in for "acted". */
export async function loadReminderOutcomeInputs(): Promise<{ availableAt: string; startedAt: string | null }[] | null> {
  try {
    const service = createServiceClient();
    const { data, error } = await service
      .from("repair_retests")
      .select("assigned_at, completed_at")
      .order("assigned_at", { ascending: false })
      .limit(1000);
    if (error) return null;
    return (data ?? []).map((r) => ({ availableAt: r.assigned_at as string, startedAt: (r.completed_at as string | null) ?? null }));
  } catch {
    return null;
  }
}
