import "server-only";

import { createServiceClient } from "@/lib/backend/server";
import type { RepairRetestAnchor } from "./repairRetest";
import { isRepairKind } from "./argumentRepair";

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
  const anchors = await successfulRepairRetestAnchors(userId);
  return anchors.length ? anchors[anchors.length - 1] : null;
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
    .select("debate_id, target_kind, created_at")
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
