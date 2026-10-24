// Server-side Skill Journey inputs: the repair rows and side-scoped weakness
// rows one user's history produced. The pure journey math lives in
// skillJourney.ts; this module only loads and merges stored graphs, using the
// same canonical counters (repairEffectiveness) as every other layer.
//
// Retest state comes from main's durable `repair_retests` assignment rows
// (migration 025), not from columns on repair_results: an assignment may be
// re-assigned when a debate offers no opportunity, so completion is a
// property of the assignment row.

import { createClient } from "./backend/server";
import { assessArgumentGraph, mergeAssessmentGraphs } from "./observableAssessment";
import type { ObservableAssessment } from "./observableAssessment";
import { countWeaknessesForSide, debateOpportunities, type DebateWeaknessRow } from "./repairEffectiveness";
import type { RepairRecord } from "./retest";
import { retestOutcomeFromAssignment } from "./retest";

export interface JourneyInputs {
  repairs: RepairRecord[];
  weaknessRows: DebateWeaknessRow[];
}

interface RetestRow {
  repair_result_id: string;
  assigned_debate_id: string;
  assigned_at: string | Date;
  completed_at: string | Date | null;
  observable: boolean | null;
  demonstrated: boolean | null;
}

/**
 * timestamptz columns come back as Date objects; the public record shape and
 * every Date.parse consumer expect ISO strings. Normalise once at the read.
 */
function isoString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : typeof value === "string" ? value : new Date().toISOString();
}

/** Load repairs + per-debate weakness counts for one user (bounded history). */
export async function buildJourneyInputsForUser(userId: string): Promise<JourneyInputs> {
  const db = await createClient();
  const [{ data: repairRows }, { data: debates }, { data: retests }] = await Promise.all([
    db
      .from("repair_results")
      .select("id, user_id, debate_id, target_kind, source_text, rewrite_text, score, succeeded, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(50),
    db
      .from("solo_debates")
      .select("id, completed_at, format")
      .eq("user_id", userId)
      .eq("status", "completed")
      .order("completed_at", { ascending: true })
      .limit(30),
    db
      .from("repair_retests")
      .select("repair_result_id, assigned_debate_id, assigned_at, completed_at, observable, demonstrated")
      .eq("user_id", userId)
      .order("assigned_at", { ascending: true })
      .limit(100),
  ]);

  // Latest completed assignment per repair episode = that repair's retest.
  const retestByRepair = new Map<string, RetestRow>();
  for (const row of (retests ?? []) as unknown as RetestRow[]) {
    const current = retestByRepair.get(row.repair_result_id);
    const assignedAt = isoString(row.assigned_at);
    const candidate: RetestRow = { ...row, assigned_at: assignedAt, completed_at: row.completed_at ? isoString(row.completed_at) : null };
    if (!current || Date.parse(assignedAt) > Date.parse(isoString(current.assigned_at))) {
      retestByRepair.set(row.repair_result_id, candidate);
    }
  }

  // Retest verdicts need the assigned debate's format: a sprint retest is
  // "not enough evidence", not a clean pass/fail.
  const debateFormat = new Map<string, string>();
  for (const debate of debates ?? []) {
    debateFormat.set(debate.id as string, debate.format as string);
  }

  const repairs: RepairRecord[] = (repairRows ?? []).map((row) => {
    // timestamptz comes back as Date; the public record shape is ISO strings.
    const r = row as unknown as RepairRecord & { id: string; created_at: string | Date };
    const retest = retestByRepair.get(r.id);
    return {
      ...r,
      created_at: isoString(r.created_at),
      retest_debate_id: retest?.assigned_debate_id ?? null,
      retest_outcome: retest
        ? retestOutcomeFromAssignment(retest, debateFormat.get(retest.assigned_debate_id) ?? null)
        : null,
      retest_completed_at: retest?.completed_at ? isoString(retest.completed_at) : null,
    };
  });

  // One batched read for every debate's turns (was one sequential query per
  // debate: up to 30 round-trips before Today/Progress could paint).
  const debateIds = (debates ?? []).map((d) => d.id as string);
  const turnsByDebate = new Map<string, ObservableAssessment["graph"][]>();
  if (debateIds.length) {
    const { data: turns } = await db
      .from("solo_debate_turns")
      .select("debate_id, assessment, round_number")
      .in("debate_id", debateIds)
      .not("assessment", "is", null)
      .order("round_number", { ascending: true });
    for (const t of (turns ?? []) as Array<{ debate_id: string; assessment: unknown }>) {
      const graph = (t.assessment as ObservableAssessment)?.graph;
      if (!graph) continue;
      const list = turnsByDebate.get(t.debate_id) ?? [];
      list.push(graph);
      turnsByDebate.set(t.debate_id, list);
    }
  }

  const rows: DebateWeaknessRow[] = [];
  for (const debate of debates ?? []) {
    const graphs = turnsByDebate.get(debate.id as string) ?? [];
    if (!graphs.length) continue;
    const merged = assessArgumentGraph(mergeAssessmentGraphs(graphs), {
      sideA: "a",
      sideB: "ai",
      extractionSource: "deterministic",
      labelA: "You",
      labelB: "AI opponent",
    });
    rows.push({
      debateId: debate.id as string,
      userId,
      completedAt: debate.completed_at ? isoString(debate.completed_at) : new Date().toISOString(),
      kinds: countWeaknessesForSide(merged.graph, "a"),
      opps: debateOpportunities(merged.graph, "a"),
    });
  }

  return { repairs, weaknessRows: rows };
}
