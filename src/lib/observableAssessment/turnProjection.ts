// Learner-facing projections over an assessment.
//
// The canonical score stays one number with one meaning. These projections
// exist only for legacy display buckets and per-turn summaries, and they read
// the SAME features the score uses so a display bucket can never contradict
// the score.

import { emptyGraph, type ArgGraph, type ArgNode } from "../argGraph";
import type { TurnScores } from "../types";
import type { ObservableAssessment } from "./types";
import { assessArgumentGraph, swapGraphSides } from "./assess";
import { recomputeEvidenceStats } from "./graphEnrichment";
import { graphFromTurn } from "./turnExtraction";

export interface TurnObservableAssessment {
  graph: ArgGraph;
  assessment: ObservableAssessment;
  scores: TurnScores;
  turnScore: number;
}

function toTen(value: number): number {
  return Math.max(0, Math.min(10, Math.round(Math.max(0, Math.min(1, value)) * 10)));
}

/**
 * Project observable features into the legacy UI's five display buckets.
 *
 * These buckets are presentation only. They are derived from the scored
 * features, never supplied independently by a model, so a bucket cannot
 * disagree with the assessment that produced it.
 */
export function turnScoresFromAssessment(assessment: ObservableAssessment, owner: "a" | "b" = "a"): TurnScores {
  const side = assessment.features[owner];
  const supportedRate = side.claimsMade.value ? side.claimsDirectlySupported.value / side.claimsMade.value : 0;
  const contradictionDiscipline = 1 - Math.min(1, side.contradictions.value / Math.max(1, side.claimsMade.value));
  return {
    depth: toTen((supportedRate + side.impactHandling.value) / 2),
    evidence: toTen(assessment.sideScores[owner].components.find((item) => item.id === "evidenceQuality")?.rawValue ?? 0),
    logic: toTen((supportedRate + contradictionDiscipline) / 2),
    rebuttal: toTen(side.rebuttalCoverage.value),
    clarity: toTen(side.argumentResponses.value.rate),
  };
}

/**
 * Assess one solo turn end to end: extract deterministically, then score with
 * the same policy a full debate uses.
 */
export function assessTurn(params: {
  userMessage: string;
  opponentMessage: string;
  round: number;
}): TurnObservableAssessment {
  const graph = graphFromTurn(params);
  const assessment = assessArgumentGraph(graph, {
    sideA: "a",
    sideB: "ai",
    extractionSource: "deterministic",
    labelA: "You",
    labelB: "AI opponent",
  });
  const scores = turnScoresFromAssessment(assessment, "a");
  // Half the full scale: the 0-100 score is designed for a whole debate, so a
  // single turn is reported on a 0-50 range rather than pretending to be the
  // same measurement.
  const turnScore = assessment.sideScores.a.score === null ? 0 : Math.round(assessment.sideScores.a.score / 2);
  return { graph, assessment, scores, turnScore };
}

/** Merge turn-level graphs for the final solo-debate explanation. */
export function mergeAssessmentGraphs(graphs: ArgGraph[]): ArgGraph {
  if (!graphs.length) return emptyGraph();
  const out = emptyGraph();
  for (const graph of graphs) {
    out.nodes.push(...graph.nodes);
    out.edges.push(...graph.edges);
    out.dropped.push(...graph.dropped);
    out.contradictions.push(...graph.contradictions);
    out.concessions.push(...graph.concessions);
    out.fallacies.push(...graph.fallacies);
  }
  out.evidenceStats = recomputeEvidenceStats(out);
  return out;
}

export { graphFromTurn, swapGraphSides };
