import {
  assessArgumentGraph,
  mergeAssessmentGraphs,
  type ObservableAssessment,
} from "./observableAssessment";

export interface StoredSoloAssessmentRow {
  debate_id: string;
  assessment: unknown;
}

/**
 * Rebuild one full-debate assessment per prior solo debate.
 *
 * Turn rows store turn-level assessments. Longitudinal rewards and coaching
 * must compare whole debates with whole debates; taking the last turn from
 * each debate makes the baseline depend on whatever happened in that single
 * round and can manufacture or hide improvement.
 */
export function mergeSoloAssessmentsByDebate(
  rows: StoredSoloAssessmentRow[],
): Map<string, ObservableAssessment> {
  const graphsByDebate = new Map<string, ObservableAssessment["graph"][]>();

  for (const row of rows) {
    const assessment = row.assessment as ObservableAssessment | null | undefined;
    if (!assessment?.graph) continue;
    const graphs = graphsByDebate.get(row.debate_id) ?? [];
    graphs.push(assessment.graph);
    graphsByDebate.set(row.debate_id, graphs);
  }

  const merged = new Map<string, ObservableAssessment>();
  for (const [debateId, graphs] of graphsByDebate) {
    merged.set(
      debateId,
      assessArgumentGraph(mergeAssessmentGraphs(graphs), {
        sideA: "a",
        sideB: "ai",
        extractionSource: "deterministic",
        labelA: "You",
        labelB: "AI opponent",
      }),
    );
  }
  return merged;
}
