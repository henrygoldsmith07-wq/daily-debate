import "server-only";

import { createServiceClient } from "@/lib/backend/server";
import type { RepairRetestAnchor } from "./repairRetest";
import { isRepairKind } from "./argumentRepair";

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
      attemptedAt: row.created_at,
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

export async function assignRepairRetest(input: {
  userId: string;
  anchor: RepairRetestAnchor;
  assignedDebateId: string;
  assignedAt?: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const service = createServiceClient();
  const assignedAt = input.assignedAt ?? new Date().toISOString();

  // Roll older unfinished assignments forward so an abandoned debate from a
  // previous topic cannot block this repair forever. The partial unique index
  // remains the final concurrency guard for genuinely simultaneous starts.
  const { error: rolloverError } = await service
    .from("repair_retests")
    .update({
      completed_at: assignedAt,
      observable: false,
      demonstrated: null,
      updated_at: assignedAt,
    })
    .eq("user_id", input.userId)
    .eq("repair_result_id", input.anchor.repairResultId)
    .is("completed_at", null);
  if (rolloverError) return { ok: false, message: rolloverError.message };

  const { data, error } = await service
    .from("repair_retests")
    .insert({
      repair_result_id: input.anchor.repairResultId,
      user_id: input.userId,
      repair_debate_id: input.anchor.debateId,
      target_kind: input.anchor.targetKind,
      assigned_debate_id: input.assignedDebateId,
      assigned_at: assignedAt,
    })
    .select("id")
    .single();
  return error || !data
    ? { ok: false, message: error?.message ?? "repair retest assignment was not persisted" }
    : { ok: true };
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
