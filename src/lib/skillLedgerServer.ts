// Server-side ledger assembly: loads a user's completed solo debates and
// their stored per-turn observable assessments, merges each debate into one
// deterministic assessment, and feeds the pure skill-ledger math.

import { createClient } from "@/lib/supabase/server";
import {
  buildSkillLedger,
  extractSkillPoint,
  type SkillLedger,
  type SkillMetricPoint,
} from "./skillLedger";
import { mergeAssessmentGraphs, assessArgumentGraph } from "./observableAssessment";
import type { ObservableAssessment } from "./observableAssessment";

export interface LedgerWithSeries extends SkillLedger {
  points: SkillMetricPoint[];
}

export async function buildLedgerForUser(
  userId: string,
  opts: { includeBaseline?: boolean } = {},
): Promise<LedgerWithSeries> {
  const supabase = await createClient();
  const { data: debates } = await supabase
    .from("solo_debates")
    .select("id, completed_at")
    .eq("user_id", userId)
    .eq("status", "completed")
    .order("completed_at", { ascending: true })
    .limit(100);

  const completed = debates ?? [];
  const points: SkillMetricPoint[] = [];

  for (const d of completed) {
    const [{ data: turns }, { data: scoreRows }] = await Promise.all([
      supabase
        .from("solo_debate_turns")
        .select("assessment")
        .eq("debate_id", d.id)
        .not("assessment", "is", null)
        .order("round_number"),
      supabase.from("solo_debate_turns").select("scores").eq("debate_id", d.id).not("scores", "is", null),
    ]);
    const assessments = ((turns ?? []) as Array<{ assessment: unknown }>)
      .map((t) => t.assessment as ObservableAssessment)
      .filter((a) => !!a?.graph);
    if (!assessments.length) continue;

    const merged = assessArgumentGraph(mergeAssessmentGraphs(assessments.map((a) => a.graph)), {
      sideA: "a",
      sideB: "ai",
      extractionSource: "deterministic",
      labelA: "You",
      labelB: "AI opponent",
    });

    const clarityValues = ((scoreRows ?? []) as Array<{ scores: { clarity?: number } | null }>)
      .map((r) => r.scores?.clarity)
      .filter((c): c is number => typeof c === "number");
    const avgClarity = clarityValues.length
      ? clarityValues.reduce((s, c) => s + c, 0) / clarityValues.length
      : null;

    points.push(extractSkillPoint(d.id, d.completed_at ?? new Date().toISOString(), merged, "a", avgClarity));
  }

  const ledger = buildSkillLedger(points, opts);
  return { ...ledger, points };
}
