// Server-side data assembly for the admin funnel report. Loads product_events
// and repair_results, and derives per-debate weakness counts from the stored
// observable assessments so repair effectiveness can be measured without new
// instrumentation. Failures degrade to empty data — the report is internal.
//
// Truncation is load-bearing here: hard limits (events/repairs/debates) are
// detected with a limit+1 fetch and reported as data, never hidden. Debates
// additionally use bounded-window loading: only debates inside the
// repair-relevant window (repair created_at ± REPAIR_WINDOW_DAYS) are loaded,
// so the graph work stays proportional to the repairs being measured.

import "server-only";

import { createServiceClient } from "@/lib/backend/server";
import { assessArgumentGraph, mergeAssessmentGraphs } from "@/lib/observableAssessment";
import type { ObservableAssessment } from "@/lib/observableAssessment";
import { countWeaknessesForSide, debateOpportunities, REPAIR_WINDOW_DAYS } from "@/lib/repairEffectiveness";
import {
  takeBounded,
  completenessNote,
  type DataCompleteness,
  type FunnelEventRow,
} from "@/lib/productFunnel";
import type { DebateWeaknessRow, RepairRow } from "@/lib/repairEffectiveness";

const MAX_EVENTS = 20_000;
const MAX_REPAIRS = 2_000;
const MAX_DEBATES = 120;

export interface FunnelData {
  events: FunnelEventRow[];
  repairs: RepairRow[];
  debateWeaknesses: DebateWeaknessRow[];
  completeness: DataCompleteness;
}

const EMPTY_COMPLETENESS: DataCompleteness = {
  events: { loaded: 0, limit: MAX_EVENTS, truncated: false },
  repairs: { loaded: 0, limit: MAX_REPAIRS, truncated: false },
  debates: { loaded: 0, limit: MAX_DEBATES, truncated: false },
  note: null,
};

export async function loadFunnelData(): Promise<FunnelData> {
  let service;
  try {
    service = createServiceClient();
  } catch {
    return { events: [], repairs: [], debateWeaknesses: [], completeness: EMPTY_COMPLETENESS };
  }

  const [{ data: eventRows }, { data: repairRows }] = await Promise.all([
    service
      .from("product_events")
      .select("user_id, name, format, reason, round, repair_score, debate_id, created_at")
      .order("created_at", { ascending: false })
      .limit(MAX_EVENTS + 1),
    service
      .from("repair_results")
      .select("user_id, debate_id, target_kind, score, succeeded, created_at")
      .order("created_at", { ascending: false })
      .limit(MAX_REPAIRS + 1),
  ]);

  const boundedEvents = takeBounded(eventRows ?? [], MAX_EVENTS);
  const boundedRepairs = takeBounded(repairRows ?? [], MAX_REPAIRS);

  const events: FunnelEventRow[] = boundedEvents.rows.map((row) => ({
    user_id: row.user_id,
    name: row.name,
    format: row.format,
    reason: row.reason,
    debate_id: row.debate_id,
    created_at: row.created_at,
  }));
  const repairs: RepairRow[] = boundedRepairs.rows.map((row) => ({
    user_id: row.user_id,
    debate_id: row.debate_id,
    target_kind: row.target_kind,
    score: row.score,
    succeeded: row.succeeded,
    created_at: row.created_at,
  }));

  // Weakness snapshots only for users who actually repaired — keeps the query
  // cost bounded for the admin report.
  const { weaknesses: debateWeaknesses, debates } = await loadDebateWeaknesses(service, repairs);

  const completeness: DataCompleteness = {
    events: { loaded: events.length, limit: MAX_EVENTS, truncated: boundedEvents.truncated },
    repairs: { loaded: repairs.length, limit: MAX_REPAIRS, truncated: boundedRepairs.truncated },
    debates,
    note: null,
  };
  completeness.note = completenessNote(completeness);
  return { events, repairs, debateWeaknesses, completeness };
}

type ServiceClient = ReturnType<typeof createServiceClient>;

async function loadDebateWeaknesses(
  service: ServiceClient,
  repairs: RepairRow[],
): Promise<{ weaknesses: DebateWeaknessRow[]; debates: DataCompleteness["debates"] }> {
  const empty = { weaknesses: [] as DebateWeaknessRow[], debates: { loaded: 0, limit: MAX_DEBATES, truncated: false } };
  if (!repairs.length) return empty;
  const userIds = [...new Set(repairs.map((r) => r.user_id))];

  // Bounded-window loading: a debate can only matter to the measurement if it
  // falls within some repair's before/after window.
  const repairTimes = repairs.map((r) => Date.parse(r.created_at)).filter(Number.isFinite);
  const windowMs = REPAIR_WINDOW_DAYS * 86_400_000;
  const windowStart = new Date(Math.min(...repairTimes) - windowMs).toISOString();
  const windowEnd = new Date(Math.max(...repairTimes) + windowMs).toISOString();

  const { data: debates } = await service
    .from("solo_debates")
    .select("id, user_id, completed_at")
    .in("user_id", userIds)
    .eq("status", "completed")
    .gte("completed_at", windowStart)
    .lte("completed_at", windowEnd)
    .order("completed_at", { ascending: false })
    .limit(MAX_DEBATES + 1);
  const bounded = takeBounded(debates ?? [], MAX_DEBATES);
  const completed = bounded.rows;
  if (!completed.length) {
    return { ...empty, debates: { loaded: 0, limit: MAX_DEBATES, truncated: bounded.truncated } };
  }

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
    // Side-scoped: only the user's own nodes can register as weaknesses,
    // with explicit opportunity volume for the effectiveness measurement.
    const counts = countWeaknessesForSide(merged.graph, "a");
    out.push({
      debateId: debate.id,
      userId: debate.user_id,
      completedAt: debate.completed_at ?? new Date().toISOString(),
      kinds: counts,
      opps: debateOpportunities(merged.graph, "a"),
    });
  }
  return {
    weaknesses: out,
    debates: { loaded: completed.length, limit: MAX_DEBATES, truncated: bounded.truncated },
  };
}
