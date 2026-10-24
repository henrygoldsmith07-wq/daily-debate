import "server-only";

import { createServiceClient } from "@/lib/backend/server";
import type { CompletedRetestVerdict, RepairRetestAnchor } from "./repairRetest";
import { isRepairKind } from "./argumentRepair";

/**
 * timestamptz columns come back from the Postgres layer as Date objects, but
 * every consumer in this module's public shape (and repairRetest's
 * Date.parse calls) expects ISO strings. Normalise once at the boundary.
 */
function isoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : new Date().toISOString();
}

/**
 * Successful repair episodes that may still need transfer testing. Multiple
 * successes for the same debate+kind collapse to the earliest successful
 * attempt so a later retry cannot reset the retest clock.
 */
export async function successfulRepairRetestAnchors(
  userId: string,
): Promise<RepairRetestAnchor[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from("repair_results")
    .select("id, debate_id, target_kind, created_at")
    .eq("user_id", userId)
    .eq("succeeded", true)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message ?? "repair retest anchors unavailable");
  const valid = (data ?? []).flatMap((row) =>
    isRepairKind(row.target_kind)
      ? [{ ...row, target_kind: row.target_kind }]
      : [],
  );
  if (!valid.length) return [];

  const debateIds = [...new Set(valid.map((row) => row.debate_id))];
  const { data: debates, error: debateError } = await service
    .from("solo_debates")
    .select("id, topic_id")
    .eq("user_id", userId)
    .in("id", debateIds);
  if (debateError) throw new Error(debateError.message ?? "repair debate topics unavailable");

  const topics = new Map((debates ?? []).map((row) => [row.id, row.topic_id]));
  const byEpisode = new Map<string, RepairRetestAnchor>();
  for (const row of valid) {
    const key = `${row.debate_id}\u0000${row.target_kind}`;
    const candidate: RepairRetestAnchor = {
      repairResultId: row.id,
      debateId: row.debate_id,
      targetKind: row.target_kind,
      attemptedAt: isoString(row.created_at),
      topicId: topics.get(row.debate_id) ?? null,
    };
    const existing = byEpisode.get(key);
    if (!existing || Date.parse(candidate.attemptedAt) < Date.parse(existing.attemptedAt)) {
      byEpisode.set(key, candidate);
    }
  }

  return [...byEpisode.values()].sort(
    (a, b) => Date.parse(a.attemptedAt) - Date.parse(b.attemptedAt),
  );
}

/** Successful repairs that do not yet have a durable observable retest. */
export async function unresolvedRepairRetestAnchors(
  userId: string,
): Promise<RepairRetestAnchor[]> {
  const anchors = await successfulRepairRetestAnchors(userId);
  if (!anchors.length) return [];

  const service = createServiceClient();
  const { data, error } = await service
    .from("repair_retests")
    .select("repair_result_id")
    .eq("user_id", userId)
    .eq("observable", true)
    .in("repair_result_id", anchors.map((anchor) => anchor.repairResultId));
  if (error) throw new Error(error.message ?? "repair retest state unavailable");
  const completed = new Set((data ?? []).map((row) => row.repair_result_id));
  return anchors.filter((anchor) => !completed.has(anchor.repairResultId));
}

export async function completeRepairRetestAssignment(input: {
  userId: string;
  /** Optional only for pre-upgrade debate coaching; assignedDebateId remains unique. */
  repairResultId?: string | null;
  assignedDebateId: string;
  completedAt: string;
  observable: boolean;
  demonstrated: boolean | null;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const service = createServiceClient();
  let query = service
    .from("repair_retests")
    .update({
      completed_at: input.completedAt,
      observable: input.observable,
      demonstrated: input.demonstrated,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", input.userId)
    .eq("assigned_debate_id", input.assignedDebateId);
  if (input.repairResultId) query = query.eq("repair_result_id", input.repairResultId);
  const { data, error } = await query.select("id").maybeSingle();
  return error || !data
    ? { ok: false, message: error?.message ?? "repair retest assignment was not found" }
    : { ok: true };
}

/**
 * Whether the given debate still owns an OPEN retest assignment.
 *
 * The roll-forward in `complete_solo_debate_start` closes a repair's previous
 * assignment (completed, unobservable) when a newer debate takes over the
 * repair. The guarded finalizer therefore refuses to write the abandoned
 * debate's verdict to that closed row — the newer debate owns the test now.
 * This read tells the caller which world it is in, so the result card can
 * show the verdict only when THIS debate actually carries the measurement.
 *
 * Service client on purpose: this runs inside finalization, not in a request
 * the learner can forge.
 */
export async function retestAssignmentStillOpen(input: {
  userId: string;
  assignedDebateId: string;
  repairResultId?: string | null;
}): Promise<boolean> {
  const service = createServiceClient();
  let query = service
    .from("repair_retests")
    .select("id")
    .eq("user_id", input.userId)
    .eq("assigned_debate_id", input.assignedDebateId)
    .is("completed_at", null)
    .limit(1);
  if (input.repairResultId) query = query.eq("repair_result_id", input.repairResultId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message ?? "repair retest assignment state unavailable");
  return Boolean(data);
}

/** Completed retest verdicts (bounded) joined to the repaired kind. */
export async function failedRetestVerdictsForUser(userId: string): Promise<CompletedRetestVerdict[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from("repair_retests")
    .select("repair_result_id, completed_at, observable, demonstrated")
    .eq("user_id", userId)
    .eq("observable", true)
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message ?? "retest verdicts unavailable");
  const rows = data ?? [];
  if (!rows.length) return [];
  const { data: repairs, error: repairError } = await service
    .from("repair_results")
    .select("id, target_kind")
    .eq("user_id", userId)
    .in("id", rows.map((r) => r.repair_result_id));
  if (repairError) throw new Error(repairError.message ?? "retest repairs unavailable");
  const kinds = new Map((repairs ?? []).map((r) => [r.id, r.target_kind]));
  return rows.flatMap((row) => {
    const kind = kinds.get(row.repair_result_id);
    return isRepairKind(kind)
      ? [{ targetKind: kind, completedAt: isoString(row.completed_at), observable: row.observable, demonstrated: row.demonstrated }]
      : [];
  });
}
