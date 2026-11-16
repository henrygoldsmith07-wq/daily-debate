import "server-only";

import type { BackendClient } from "@/lib/backend/client";
import { createServiceClient } from "@/lib/backend/server";
import { retestOutcomeFromAssignment } from "@/lib/retest";
import {
  durableGainFromDebates,
  type DurableGainSummary,
  type RecheckCandidate,
  type StampedDebate,
} from "@/lib/spacedRecheck";

const DEBATE_WINDOW = 300;
const RETEST_WINDOW = 200;

function iso(value: unknown): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/**
 * Bounded reads for the M9 re-check: the user's repairs whose first retest
 * completed, decoded through the canonical retest decoder, plus the user's
 * recent debates (topic + coaching) so re-check stamps and topic freshness can
 * be derived without a recheck_debate_id column.
 */
export async function loadRecheckInputs(
  db: BackendClient,
  userId: string,
): Promise<{ repairs: RecheckCandidate[]; debates: StampedDebate[] }> {
  const [retests, debates] = await Promise.all([
    db
      .from("repair_retests")
      .select("repair_result_id, repair_debate_id, target_kind, assigned_debate_id, completed_at, observable, demonstrated")
      .eq("user_id", userId)
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(RETEST_WINDOW),
    db
      .from("solo_debates")
      .select("id, topic_id, format, coaching")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(DEBATE_WINDOW),
  ]);
  if (retests.error) throw new Error(retests.error.message ?? "re-check retests unavailable");
  if (debates.error) throw new Error(debates.error.message ?? "re-check debates unavailable");

  const debateRows = (debates.data ?? []) as Array<{ id: string; topic_id: string | null; format: string | null; coaching: unknown }>;
  const formatOf = new Map(debateRows.map((d) => [d.id, d.format]));

  // Newest completed assignment per repair is the one that decides its state.
  const seen = new Set<string>();
  const repairs: RecheckCandidate[] = [];
  for (const row of (retests.data ?? []) as Array<Record<string, unknown>>) {
    const id = String(row.repair_result_id ?? "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const assigned = String(row.assigned_debate_id ?? "");
    repairs.push({
      id,
      target_kind: String(row.target_kind ?? ""),
      debate_id: String(row.repair_debate_id ?? ""),
      retest_debate_id: assigned || null,
      retest_outcome: retestOutcomeFromAssignment(
        {
          completed_at: iso(row.completed_at),
          observable: (row.observable as boolean | null) ?? null,
          demonstrated: (row.demonstrated as boolean | null) ?? null,
        },
        formatOf.get(assigned) ?? null,
      ),
      retest_completed_at: iso(row.completed_at),
    });
  }

  return {
    repairs,
    debates: debateRows.map((d) => ({
      id: d.id,
      topic_id: d.topic_id,
      coaching: (d.coaching ?? null) as StampedDebate["coaching"],
    })),
  };
}

/** Admin: durable-gain summary across learners' stamped re-check debates; null when unreadable. */
export async function loadDurableGainSummary(): Promise<DurableGainSummary | null> {
  try {
    const service = createServiceClient();
    const { data, error } = await service
      .from("solo_debates")
      .select("id, coaching")
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(2000);
    if (error) return null;
    return durableGainFromDebates(
      ((data ?? []) as Array<{ id: string; coaching: unknown }>).map((d) => ({
        id: d.id,
        coaching: (d.coaching ?? null) as StampedDebate["coaching"],
      })),
    );
  } catch {
    return null;
  }
}
