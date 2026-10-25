import { extractSkillPoint, type SkillMetricPoint } from "./skillLedger";
import { assessArgumentGraph, mergeAssessmentGraphs } from "./observableAssessment";
import type { ObservableAssessment } from "./observableAssessment";
import { isRepairKind } from "./argumentRepair";
import { buildTrainingSummary } from "./trainingSummary";
import { toIsoOrNull } from "./isoTimestamp";

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
  training_meta?: unknown;
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
    // A debate with no completion time cannot be placed on the learner's timeline;
    // stamping "now" would fabricate trend order and retest windows, so leave it out.
    const completedAt = toIsoOrNull(debate.completed_at);
    if (!completedAt) continue;
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
    const training = buildTrainingSummary(debateTurns);

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
      toIsoOrNull(rawRetest.attemptedAt) !== null
        ? {
            repairResultId: typeof rawRetest.repairResultId === "string" ? rawRetest.repairResultId : null,
            repairDebateId: rawRetest.repairDebateId,
            targetKind: rawRetest.targetKind,
            attemptedAt: rawRetest.attemptedAt as string,
          }
        : null;

    points.push({
      ...extractSkillPoint(
        debate.id,
        completedAt,
        merged,
        "a",
        avgClarity,
      ),
      topicId: debate.topic_id,
      repairRetest,
      training: training.totalTurns > 0 ? training : null,
    });
  }
  return points;
}
