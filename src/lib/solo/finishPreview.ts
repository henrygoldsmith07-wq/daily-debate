// Progressive result: the evidenced weakness is deterministic (it comes from
// per-turn assessments already stored), so it can be shown while the slow
// model summary is still generating. Same builder as the final result, so the
// preview can never disagree with it.
import { assessArgumentGraph, mergeAssessmentGraphs } from "@/lib/observableAssessment";
import type { ObservableAssessment } from "@/lib/observableAssessment";
import { buildResultSnapshot } from "@/lib/resultSnapshot";
import { resolveDebateFormat } from "@/lib/sprint";

export interface FinishPreview {
  weakness: { headline: string; whyItMatters: string; kind: string | null; repairLabel: string | null } | null;
  highlight: { headline: string; evidence: string } | null;
  evidenceNodeCount: number;
}

export function buildFinishPreview(
  turns: Array<{ user_message?: string | null; assessment?: unknown }>,
  format: unknown,
): FinishPreview | null {
  const assessments = turns
    .filter((t) => t.user_message)
    .map((t) => t.assessment as ObservableAssessment | null | undefined)
    .filter((a): a is ObservableAssessment => !!a?.graph);
  if (!assessments.length) return null;
  const merged = assessArgumentGraph(mergeAssessmentGraphs(assessments.map((a) => a.graph)), {
    sideA: "a",
    sideB: "ai",
    extractionSource: "deterministic",
    labelA: "You",
    labelB: "AI opponent",
  });
  const snap = buildResultSnapshot(merged, { format: resolveDebateFormat(format) });
  if (!snap.weakness && !snap.highlight) return null;
  return {
    weakness: snap.weakness
      ? {
          headline: snap.weakness.headline,
          whyItMatters: snap.weakness.whyItMatters,
          kind: snap.weakness.kind,
          repairLabel: snap.weakness.repair?.label ?? null,
        }
      : null,
    highlight: snap.highlight,
    evidenceNodeCount: snap.evidenceNodeCount,
  };
}
