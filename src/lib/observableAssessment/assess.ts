// Observable debate assessment - public entry point.
//
// A model may extract an ArgGraph, but it does not get to choose the score.
// This module composes the pipeline:
//
//   enrich graph (deterministic)  ->  extract observable features
//   ->  compose score             ->  decide winner + honest uncertainty
//
// Each stage lives in its own file so the concern can be read and tested on
// its own; this file only wires them together and phrases the result.

import { emptyGraph, type ArgGraph, type Owner } from "../argGraph";
import {
  OBSERVABLE_ASSESSMENT_VERSION,
  SCORE_WEIGHTS,
  WINNER_TIE_THRESHOLD,
  type AssessmentOptions,
  type AssessmentStatus,
  type ObservableAssessment,
} from "./types";
import { clamp, cloneGraph, emptyGraph as emptyArgGraph, enrichObservableGraph, round, validationIssues } from "./graphEnrichment";
import { buildSideFeatures, engineReport } from "./features";
import { breakdownFromAssessment, decideWinner, hasEnoughStructure, impactComparisonFeature, scoreSide, topComponentDifference } from "./scoring";

export function labelFor(owner: "a" | "b", options: AssessmentOptions): string {
  return owner === "a" ? options.labelA ?? "Player A" : options.labelB ?? "Player B";
}

/**
 * Score an extracted graph.
 *
 * The returned score is null when there is not enough observable structure to
 * compare the sides. Graph validation issues and low extraction confidence
 * are surfaced as explicit uncertainty rather than absorbed silently.
 */
export function assessArgumentGraph(
  input: ArgGraph | null | undefined,
  options: AssessmentOptions = {},
): ObservableAssessment {
  const sideA = options.sideA ?? "a";
  const sideB = options.sideB ?? "b";
  const source = options.extractionSource ?? "llm";
  const extractionConfidence = clamp(options.extractionConfidence ?? (source === "llm" ? 0.65 : source === "human" ? 0.9 : 1));
  const baseGraph = input ?? emptyGraph();
  const graph = enrichObservableGraph(baseGraph);
  const issues = validationIssues(graph);
  const uncertainty: string[] = [];
  if (source === "llm") uncertainty.push("Argument graph was extracted by an LLM; graph facts were not independently verified.");
  if (issues.length) uncertainty.push(...issues.map((issue) => `Graph validation: ${issue}`));
  if (!input) uncertainty.push("No argument graph was returned by the extractor.");
  // Structural problems in the graph erode confidence in what was extracted.
  const adjustedExtractionConfidence = clamp(extractionConfidence - Math.min(0.35, issues.length * 0.04));
  const features = {
    a: buildSideFeatures(graph, sideA, sideB, adjustedExtractionConfidence),
    b: buildSideFeatures(graph, sideB, sideA, adjustedExtractionConfidence),
  };
  const claimCount = features.a.claimsMade.value + features.b.claimsMade.value;
  const evidenceCount = graph.nodes.filter((node) => node.kind === "evidence").length;
  const directClashCount =
    graph.edges.filter((edge) => edge.relation === "rebuts" || edge.relation === "counters").length +
    graph.nodes.filter((node) => node.kind === "rebuttal" && (node.targets?.length ?? 0) > 0).length;
  const impactCount = graph.nodes.filter((node) => node.kind === "impact").length;
  const enoughStructure = hasEnoughStructure({
    hasGraph: !!input,
    claimCount,
    evidenceCount,
    directClashCount,
    impactCount,
  });
  const globallyInsufficient = !enoughStructure || adjustedExtractionConfidence < 0.4;
  if (globallyInsufficient) {
    uncertainty.push(
      claimCount < 2
        ? "Fewer than two observable claims were extracted."
        : "The graph has no independently checkable evidence or argument clash to compare.",
    );
  }
  const status: AssessmentStatus = globallyInsufficient ? "insufficient_evidence" : "scored";
  const sideScores = {
    a: scoreSide(features.a, graph, status, adjustedExtractionConfidence, sideB),
    b: scoreSide(features.b, graph, status, adjustedExtractionConfidence, sideA),
  };
  const { winner, scoreGap } = decideWinner(status, sideScores.a.score, sideScores.b.score);
  const impactComparison = impactComparisonFeature(features, adjustedExtractionConfidence);
  const enrichedForDisplay = cloneGraph(graph);
  enrichedForDisplay.impactComparison = {
    a: Math.round(impactComparison.value.a * 100),
    b: Math.round(impactComparison.value.b * 100),
    rationale: impactComparison.evidence.length
      ? "Derived from linked impacts, grounded support, and explicit comparison language; no model-supplied 0-100 impact number is used."
      : "Insufficient observable impact nodes to compare.",
  };
  const factor = !globallyInsufficient ? topComponentDifference(sideScores.a, sideScores.b) : null;
  const leadLabel = winner === "a" ? labelFor("a", options) : winner === "b" ? labelFor("b", options) : "Neither side";
  const decidingFactor =
    status === "insufficient_evidence"
      ? "Insufficient evidence: the extracted graph cannot support a defensible winner."
      : winner === "tie"
        ? `The observable score gap is ${scoreGap ?? 0}, below the ${WINNER_TIE_THRESHOLD}-point tie threshold.`
        : `${leadLabel} led on ${factor?.id ?? "the observable argument features"}; the component cites graph nodes and edges rather than prose style.`;
  const rationale =
    status === "insufficient_evidence"
      ? uncertainty.join(" ")
      : `${labelFor("a", options)} scored ${sideScores.a.score}/100 and ${labelFor("b", options)} scored ${sideScores.b.score}/100 from observable graph features. ${decidingFactor}`;
  return {
    version: OBSERVABLE_ASSESSMENT_VERSION,
    status,
    winner,
    scoreGap,
    scores: { a: sideScores.a.score, b: sideScores.b.score },
    features,
    sideScores,
    impactComparison,
    scoreComposition: {
      formula:
        "100 x weighted mean(supported claims, evidence quality, rebuttal coverage, responses, impact handling, grounded dropped arguments, concession handling, fallacy discipline, contradiction discipline); no text-length term",
      weights: SCORE_WEIGHTS,
      tieThreshold: WINNER_TIE_THRESHOLD,
    },
    extraction: {
      source,
      confidence: round(adjustedExtractionConfidence),
      validationIssues: issues,
      uncertainty: [...uncertainty],
    },
    uncertainty: [...uncertainty],
    decidingFactor,
    rationale,
    engine: engineReport(enrichedForDisplay, { a: sideA, b: sideB }),
    graph: enrichedForDisplay,
  };
}

/** Convert an extracted graph into the fields persisted by the PvP route. */
export function finalizePvpAssessment(raw: { rationale?: string; argGraph?: ArgGraph }, options: AssessmentOptions = {}) {
  const assessment = assessArgumentGraph(raw.argGraph, { ...options, extractionSource: options.extractionSource ?? "llm" });
  return {
    winner: assessment.winner,
    playerAScore: assessment.scores.a ?? 0,
    playerBScore: assessment.scores.b ?? 0,
    scoreStatus: assessment.status,
    rationale: raw.rationale?.trim() || assessment.rationale,
    decidingFactor: assessment.decidingFactor,
    breakdown: breakdownFromAssessment(assessment),
    argGraph: assessment.graph,
    observableAssessment: assessment,
  };
}

/**
 * Swap side ownership while preserving every argument, edge, citation and
 * text. Used to present a PvP graph from a specific player's point of view.
 */
export function swapGraphSides(input: ArgGraph): ArgGraph {
  const graph = cloneGraph(input);
  const swap = (owner: Owner): Owner => (owner === "a" ? "b" : owner === "b" ? "a" : owner);
  graph.nodes = graph.nodes.map((node) => ({ ...node, owner: swap(node.owner) }));
  graph.dropped = graph.dropped.map((item) => ({ ...item, owner: swap(item.owner) }));
  graph.contradictions = graph.contradictions.map((item) => ({ ...item, owner: swap(item.owner) }));
  graph.concessions = graph.concessions.map((item) => ({ ...item, by: swap(item.by) }));
  return graph;
}

export { emptyGraph, emptyArgGraph };
