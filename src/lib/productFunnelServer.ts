// Server-side data assembly for the admin funnel report. Loads product_events
// and repair_results, and derives per-debate weakness counts from the stored
// observable assessments so repair effectiveness can be measured without new
// instrumentation. Failures degrade to empty data — the report is internal.

import "server-only";

import { createServiceClient } from "@/lib/backend/server";
import { assessArgumentGraph, mergeAssessmentGraphs } from "@/lib/observableAssessment";
import type { ObservableAssessment } from "@/lib/observableAssessment";
import { snapshotFromGraph } from "@/lib/weaknessTracker";
import type { FunnelEventRow } from "@/lib/productFunnel";
import type { DebateWeaknessRow, RepairRow } from "@/lib/repairEffectiveness";

const MAX_EVENTS = 20_000;
const MAX_REPAIRS = 2_000;
const MAX_DEBATES = 120;

export interface FunnelData {
  events: FunnelEventRow[];
  repairs: RepairRow[];
  debateWeaknesses: DebateWeaknessRow[];
  truncated: { events: boolean; debates: boolean };
}

export async function loadFunnelData(): Promise<FunnelData> {
  let service;
  try {
    service = createServiceClient();
  } catch {
    return { events: [], repairs: [], debateWeaknesses: [], truncated: { events: false, debates: false } };
  }

  const [{ data: eventRows }, { data: repairRows }] = await Promise.all([
    service
      .from("product_events")
      .select("user_id, name, format, reason, round, repair_score, created_at")
      .order("created_at", { ascending: false })
      .limit(MAX_EVENTS),
    service
      .from("repair_results")
      .select("user_id, debate_id, target_kind, score, succeeded, created_at")
      .order("created_at", { ascending: false })
      .limit(MAX_REPAIRS),
  ]);

  const events: FunnelEventRow[] = (eventRows ?? []).map((row) => ({
    user_id: row.user_id,
    name: row.name,
    format: row.format,
    reason: row.reason,
    created_at: row.created_at,
  }));
  const repairs: RepairRow[] = (repairRows ?? []).map((row) => ({
    user_id: row.user_id,
    debate_id: row.debate_id,
    target_kind: row.target_kind,
    score: row.score,
    succeeded: row.succeeded,
    created_at: row.created_at,
  }));

  // Weakness snapshots only for users who actually repaired — keeps the query
  // cost bounded for the admin report.
  const debateWeaknesses = await loadDebateWeaknesses(service, repairs);

  return { events, repairs, debateWeaknesses, truncated: { events: false, debates: false } };
}

type ServiceClient = ReturnType<typeof createServiceClient>;

async function loadDebateWeaknesses(
  service: ServiceClient,
  repairs: RepairRow[],
): Promise<DebateWeaknessRow[]> {
  if (!repairs.length) return [];
  const userIds = [...new Set(repairs.map((r) => r.user_id))];

  const { data: debates } = await service
    .from("solo_debates")
    .select("id, user_id, completed_at")
    .in("user_id", userIds)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(MAX_DEBATES);
  const completed = debates ?? [];
  if (!completed.length) return [];

  const { data: turnRows } = await service
    .from("solo_debate_turns")
    .select("debate_id, assessment")
    .in(
      "debate_id",
      completed.map((d) => d.id),
    )
    .not("assessment", "is", null);

  const assessmentsByDebate = new Map<string, ObservableAssessment["graph"][]>();
  for (const row of (turnRows ?? []) as Array<{ debate_id: string; assessment: unknown }>) {
    const graph = (row.assessment as ObservableAssessment | null)?.graph;
    if (!graph) continue;
    const list = assessmentsByDebate.get(row.debate_id) ?? [];
    list.push(graph);
    assessmentsByDebate.set(row.debate_id, list);
  }

  const out: DebateWeaknessRow[] = [];
  for (const debate of completed) {
    const graphs = assessmentsByDebate.get(debate.id);
    if (!graphs?.length) continue;
    const merged = assessArgumentGraph(mergeAssessmentGraphs(graphs), {
      sideA: "a",
      sideB: "ai",
      extractionSource: "deterministic",
      labelA: "You",
      labelB: "AI opponent",
    });
    const snapshot = snapshotFromGraph(merged.graph, { graphId: debate.id, at: debate.completed_at ?? undefined });
    out.push({
      debateId: debate.id,
      userId: debate.user_id,
      completedAt: debate.completed_at ?? new Date().toISOString(),
      kinds: snapshot.counts as unknown as Record<string, number>,
    });
  }
  return out;
}
