import { extractSkillPoint, type SkillMetricPoint } from "./skillLedger";
import { assessArgumentGraph, mergeAssessmentGraphs } from "./observableAssessment";
import type { ObservableAssessment } from "./observableAssessment";
import { isRepairKind } from "./argumentRepair";

export interface CompletedLedgerDebateRow {
  id: string;
  completed_at: string | null;
  topic_id: string | null;
  coaching?: unknown;
}

export interface LedgerTurnRow {
  debate_id: string;
  round_number: number;
  assessment: unknown;
  scores: { clarity?: number } | null;
}

/** Pure row-to-ledger assembly used after one batched turn-history query. */
export function buildLedgerPointsFromRows(
  completed: CompletedLedgerDebateRow[],
  rows: LedgerTurnRow[],
): SkillMetricPoint[] {
  const turnsByDebate = new Map<string, LedgerTurnRow[]>();
  for (const row of rows) {
    const list = turnsByDebate.get(row.debate_id) ?? [];
    list.push(row);
    turnsByDebate.set(row.debate_id, list);
  }

  const points: SkillMetricPoint[] = [];
  for (const debate of completed) {
    const debateTurns = [...(turnsByDebate.get(debate.id) ?? [])].sort(
      (a, b) => a.round_number - b.round_number,
    );
    const assessments = debateTurns
      .map((turn) => turn.assessment as ObservableAssessment)
      .filter((assessment) => !!assessment?.graph);
    if (!assessments.length) continue;

    const merged = assessArgumentGraph(mergeAssessmentGraphs(assessments.map((assessment) => assessment.graph)), {
      sideA: "a",
      sideB: "ai",
      extractionSource: "deterministic",
      labelA: "You",
      labelB: "AI opponent",
    });
    const clarityValues = debateTurns
      .map((turn) => turn.scores?.clarity)
      .filter((clarity): clarity is number => typeof clarity === "number");
    const avgClarity = clarityValues.length
      ? clarityValues.reduce((sum, clarity) => sum + clarity, 0) / clarityValues.length
      : null;

    const coaching = debate.coaching && typeof debate.coaching === "object"
      ? (debate.coaching as { repairRetest?: unknown })
      : null;
    const rawRetest = coaching?.repairRetest && typeof coaching.repairRetest === "object"
      ? (coaching.repairRetest as Record<string, unknown>)
      : null;
    const repairRetest =
      rawRetest &&
      typeof rawRetest.repairDebateId === "string" &&
      isRepairKind(rawRetest.targetKind) &&
      typeof rawRetest.attemptedAt === "string"
        ? {
            repairResultId: typeof rawRetest.repairResultId === "string" ? rawRetest.repairResultId : null,
            repairDebateId: rawRetest.repairDebateId,
            targetKind: rawRetest.targetKind,
            attemptedAt: rawRetest.attemptedAt,
          }
        : null;

    points.push({
      ...extractSkillPoint(
        debate.id,
        debate.completed_at ?? new Date().toISOString(),
        merged,
        "a",
        avgClarity,
      ),
      topicId: debate.topic_id,
      repairRetest,
    });
  }
  return points;
}
