// Server-side data assembly for the admin funnel report. Loads product_events
// and repair_results, and derives per-debate weakness counts from the stored
// observable assessments so repair effectiveness can be measured without new
// instrumentation. Read failures are explicit availability states; they are
// never represented as a legitimate zero-activity dataset.
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
import type { DebateWeaknessRow, RepairRetestAnalyticsRow, RepairRow } from "@/lib/repairEffectiveness";
import { isRepairKind } from "@/lib/argumentRepair";

const MAX_EVENTS = 20_000;
const MAX_REPAIRS = 2_000;
const MAX_RETESTS = 4_000;
const MAX_DEBATES = 120;

export interface FunnelData {
  status: "ok" | "partial" | "unavailable";
  errorCategory: "backend-unavailable" | "event-read-failed" | "repair-read-failed" | "retest-read-failed" | "debate-read-failed" | "turn-read-failed" | "invalid-repair-kind" | null;
  events: FunnelEventRow[];
  repairs: RepairRow[];
  retests: RepairRetestAnalyticsRow[];
  debateWeaknesses: DebateWeaknessRow[];
  completeness: DataCompleteness;
}

const EMPTY_COMPLETENESS: DataCompleteness = {
  events: { loaded: 0, limit: MAX_EVENTS, truncated: false },
  repairs: { loaded: 0, limit: MAX_REPAIRS, truncated: false },
  retests: { loaded: 0, limit: MAX_RETESTS, truncated: false },
  debates: { loaded: 0, limit: MAX_DEBATES, truncated: false },
  note: null,
};

export async function loadFunnelData(): Promise<FunnelData> {
  let service;
  try {
    service = createServiceClient();
  } catch {
    return {
      status: "unavailable",
      errorCategory: "backend-unavailable",
      events: [],
      repairs: [],
      retests: [],
      debateWeaknesses: [],
      completeness: { ...EMPTY_COMPLETENESS, note: "analytics backend unavailable" },
    };
  }

  const [eventResult, repairResult, retestResult] = await Promise.all([
    service
      .from("product_events")
      .select("user_id, name, format, reason, round, repair_score, debate_id, created_at")
      .order("created_at", { ascending: false })
      .limit(MAX_EVENTS + 1),
    service
      .from("repair_results")
      .select("id, user_id, debate_id, target_kind, score, succeeded, created_at")
      .order("created_at", { ascending: false })
      .limit(MAX_REPAIRS + 1),
    service
      .from("repair_retests")
      .select("repair_result_id, user_id, assigned_debate_id, assigned_at, completed_at, observable, demonstrated")
      .order("assigned_at", { ascending: false })
      .limit(MAX_RETESTS + 1),
  ]);

  if (eventResult.error) {
    return {
      status: "unavailable",
      errorCategory: "event-read-failed",
      events: [],
      repairs: [],
      retests: [],
      debateWeaknesses: [],
      completeness: { ...EMPTY_COMPLETENESS, note: "product-event data unavailable" },
    };
  }
  if (repairResult.error) {
    return {
      status: "unavailable",
      errorCategory: "repair-read-failed",
      events: [],
      repairs: [],
      retests: [],
      debateWeaknesses: [],
      completeness: { ...EMPTY_COMPLETENESS, note: "repair data unavailable" },
    };
  }
  if (retestResult.error) {
    return {
      status: "unavailable",
      errorCategory: "retest-read-failed",
      events: [],
      repairs: [],
      retests: [],
      debateWeaknesses: [],
      completeness: { ...EMPTY_COMPLETENESS, note: "repair retest state unavailable" },
    };
  }

  const eventRows = eventResult.data;
  const repairRows = repairResult.data;
  const retestRows = retestResult.data;

  const boundedEvents = takeBounded(eventRows ?? [], MAX_EVENTS);
  const boundedRepairRows = takeBounded(repairRows ?? [], MAX_REPAIRS);
  const boundedRetestRows = takeBounded(retestRows ?? [], MAX_RETESTS);
  const validRepairRows = boundedRepairRows.rows.flatMap((row) =>
    isRepairKind(row.target_kind) ? [{ ...row, target_kind: row.target_kind }] : [],
  );
  const invalidRepairKinds = validRepairRows.length !== boundedRepairRows.rows.length;

  const events: FunnelEventRow[] = boundedEvents.rows.map((row) => ({
    user_id: row.user_id,
    name: row.name,
    format: row.format,
    reason: row.reason,
    debate_id: row.debate_id,
    created_at: row.created_at,
  }));
  const repairs: RepairRow[] = validRepairRows.map((row) => ({
    id: row.id,
    user_id: row.user_id,
    debate_id: row.debate_id,
    target_kind: row.target_kind,
    score: row.score,
    succeeded: row.succeeded,
    created_at: row.created_at,
  }));
  const retests: RepairRetestAnalyticsRow[] = boundedRetestRows.rows.map((row) => ({
    repair_result_id: row.repair_result_id,
    user_id: row.user_id,
    assigned_debate_id: row.assigned_debate_id,
    assigned_at: row.assigned_at,
    completed_at: row.completed_at,
    observable: row.observable,
    demonstrated: row.demonstrated,
  }));

  // Weakness snapshots only for users who actually repaired — keeps the query
  // cost bounded for the admin report.
  const weaknessResult = await loadDebateWeaknesses(service, repairs, retests);
  const { weaknesses: debateWeaknesses, debates } = weaknessResult;

  const completeness: DataCompleteness = {
    events: { loaded: events.length, limit: MAX_EVENTS, truncated: boundedEvents.truncated },
    repairs: { loaded: repairs.length, limit: MAX_REPAIRS, truncated: boundedRepairRows.truncated },
    retests: { loaded: retests.length, limit: MAX_RETESTS, truncated: boundedRetestRows.truncated },
    debates,
    note: null,
  };
  completeness.note = completenessNote(completeness);
  const truncated = boundedEvents.truncated || boundedRepairRows.truncated || boundedRetestRows.truncated || debates.truncated;
  const errorCategory = weaknessResult.errorCategory ?? (invalidRepairKinds ? "invalid-repair-kind" : null);
  return {
    status: errorCategory || truncated ? "partial" : "ok",
    errorCategory,
    events,
    repairs,
    retests,
    debateWeaknesses,
    completeness,
  };
}

type ServiceClient = ReturnType<typeof createServiceClient>;

async function loadDebateWeaknesses(
  service: ServiceClient,
  repairs: RepairRow[],
  retests: RepairRetestAnalyticsRow[],
): Promise<{
  weaknesses: DebateWeaknessRow[];
  debates: DataCompleteness["debates"];
  errorCategory: "debate-read-failed" | "turn-read-failed" | null;
}> {
  const empty = {
    weaknesses: [] as DebateWeaknessRow[],
    debates: { loaded: 0, limit: MAX_DEBATES, truncated: false },
    errorCategory: null as "debate-read-failed" | "turn-read-failed" | null,
  };
  if (!repairs.length) return empty;
  const userIds = [...new Set(repairs.map((r) => r.user_id))];

  // Bounded-window loading: include the repair comparison window plus explicit
  // durable retests and a bounded follow-up window after the latest retest.
  // A deliberate retest can happen more than 30 days after the repair, so a
  // repair-only upper bound would silently drop the debate that defines the
  // product's transfer measurement.
  const repairTimes = repairs.map((r) => Date.parse(r.created_at)).filter(Number.isFinite);
  const retestTimes = retests
    .flatMap((r) => [r.assigned_at, r.completed_at].filter((v): v is string => typeof v === "string"))
    .map(Date.parse)
    .filter(Number.isFinite);
  const windowMs = REPAIR_WINDOW_DAYS * 86_400_000;
  const windowStart = new Date(Math.min(...repairTimes) - windowMs).toISOString();
  const latestRelevant = Math.max(...repairTimes, ...(retestTimes.length ? retestTimes : repairTimes));
  const windowEnd = new Date(latestRelevant + windowMs).toISOString();

  const { data: debates, error: debatesError } = await service
    .from("solo_debates")
    .select("id, user_id, completed_at")
    .in("user_id", userIds)
    .eq("status", "completed")
    .gte("completed_at", windowStart)
    .lte("completed_at", windowEnd)
    .order("completed_at", { ascending: false })
    .limit(MAX_DEBATES + 1);
  if (debatesError) return { ...empty, errorCategory: "debate-read-failed" };
  const bounded = takeBounded(debates ?? [], MAX_DEBATES);
  const completed = bounded.rows;
  if (!completed.length) {
    return { ...empty, debates: { loaded: 0, limit: MAX_DEBATES, truncated: bounded.truncated } };
  }

  const { data: turnRows, error: turnsError } = await service
    .from("solo_debate_turns")
    .select("debate_id, assessment")
    .in(
      "debate_id",
      completed.map((d) => d.id),
    )
    .not("assessment", "is", null);
  if (turnsError) {
    return {
      weaknesses: [],
      debates: { loaded: completed.length, limit: MAX_DEBATES, truncated: bounded.truncated },
      errorCategory: "turn-read-failed",
    };
  }

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
    errorCategory: null,
  };
}
