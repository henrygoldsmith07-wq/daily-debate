// Server-side Skill Journey inputs: the repair rows and side-scoped weakness
// rows one user's history produced. The pure journey math lives in
// skillJourney.ts; this module only loads and merges stored graphs, using the
// same canonical counters (repairEffectiveness) as every other layer.

import { createClient } from "./backend/server";
import { assessArgumentGraph, mergeAssessmentGraphs } from "./observableAssessment";
import type { ObservableAssessment } from "./observableAssessment";
import { countWeaknessesForSide, debateOpportunities, type DebateWeaknessRow } from "./repairEffectiveness";
import type { RepairRecord } from "./retest";

export interface JourneyInputs {
  repairs: RepairRecord[];
  weaknessRows: DebateWeaknessRow[];
}

/** Load repairs + per-debate weakness counts for one user (bounded history). */
export async function buildJourneyInputsForUser(userId: string): Promise<JourneyInputs> {
  const db = await createClient();
  const [{ data: repairRows }, { data: debates }] = await Promise.all([
    db
      .from("repair_results")
      .select("id, user_id, debate_id, target_kind, source_text, rewrite_text, score, succeeded, created_at, retest_debate_id, retest_outcome, retest_completed_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(50),
    db
      .from("solo_debates")
      .select("id, completed_at")
      .eq("user_id", userId)
      .eq("status", "completed")
      .order("completed_at", { ascending: true })
      .limit(30),
  ]);

  const rows: DebateWeaknessRow[] = [];
  for (const debate of debates ?? []) {
    const { data: turns } = await db
      .from("solo_debate_turns")
      .select("assessment")
      .eq("debate_id", debate.id)
      .not("assessment", "is", null)
      .order("round_number", { ascending: true });
    const graphs = ((turns ?? []) as Array<{ assessment: unknown }>)
      .map((t) => (t.assessment as ObservableAssessment)?.graph)
      .filter((g): g is ObservableAssessment["graph"] => !!g);
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
      completedAt: (debate.completed_at ?? new Date().toISOString()) as string,
      kinds: countWeaknessesForSide(merged.graph, "a"),
      opps: debateOpportunities(merged.graph, "a"),
    });
  }

  return {
    repairs: (repairRows ?? []) as unknown as RepairRecord[],
    weaknessRows: rows,
  };
}
