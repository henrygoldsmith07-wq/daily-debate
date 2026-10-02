// Scoring policy: observable features -> the single 0-100 score.
//
// Every component is a weighted, evidence-backed reading of a feature the
// extractor produced. Nothing here re-derives a measurement: the weights are
// the only judgement, and they sum to 100 so a score cannot be inflated by
// double-counting.
//
// Two honesty rules are load-bearing here:
//   - a side with no claims is never scored (insufficient_evidence), not 0;
//   - confidence shrinks with the evidence volume backing the score, so a
//     thin transcript cannot present itself as a confident reading.

import type { ArgGraph, Owner } from "../argGraph";
import { unansweredOpportunitiesBy } from "../opportunity";
import {
  SCORE_WEIGHTS,
  WINNER_TIE_THRESHOLD,
  type AssessmentStatus,
  type EvidenceRef,
  type ImpactComparisonValue,
  type ObservableAssessment,
  type ObservableBreakdown,
  type ObservableFeature,
  type ObservableSideScore,
  type ScoreComponent,
  type SideObservableFeatures,
} from "./types";
import { clamp, derivedRef, feature, isClaimLike, round, uniqueRefs } from "./graphEnrichment";
import { supportLinks } from "./features";

export function component(
  id: keyof typeof SCORE_WEIGHTS,
  rawValue: number,
  evidence: EvidenceRef[],
  rationale: string,
): ScoreComponent {
  const raw = clamp(rawValue);
  return {
    id,
    weight: SCORE_WEIGHTS[id],
    rawValue: round(raw),
    contribution: round(raw * SCORE_WEIGHTS[id], 2),
    evidence: uniqueRefs(evidence),
    rationale,
  };
}

/**
 * Per-claim maximum of citation grounding x evidence strength x relevance.
 * Duplicate sources do not stack: several citations for one claim still only
 * count once, so padding a claim with repeated references cannot raise it.
 */
export function averageClaimEvidenceQuality(graph: ArgGraph, owner: Owner): number {
  const links = supportLinks(graph).filter((link) => link.claim.owner === owner && link.evidence.owner === owner);
  const claims = graph.nodes.filter((node) => node.owner === owner && isClaimLike(node));
  if (!claims.length) return 0;
  return claims.reduce((sum, claim) => {
    const best = links.filter((link) => link.claim.id === claim.id).reduce((value, link) => Math.max(value, link.quality), 0);
    return sum + best;
  }, 0) / claims.length;
}

/**
 * Compose one side's score from its features.
 *
 * A side with no observable claims returns `score: null` with status
 * `insufficient_evidence` rather than a zero: absence of evidence is not
 * evidence of absence, and a 0 would read as "this side argued badly".
 */
export function scoreSide(
  features: SideObservableFeatures,
  graph: ArgGraph,
  globalStatus: AssessmentStatus,
  extractionConfidence: number,
  opponent: Owner,
): ObservableSideScore {
  if (globalStatus === "insufficient_evidence" || features.claimsMade.value === 0) {
    return { score: null, status: "insufficient_evidence", confidence: 0, components: [], supportingEvidence: [] };
  }
  const claims = Math.max(1, features.claimsMade.value);
  const claimRefs = features.claimsMade.evidence;
  const supportedRefs = features.claimsDirectlySupported.evidence;
  const evidenceRefs = uniqueRefs([...features.evidenceActuallyCited.evidence, ...features.evidenceRelevance.evidence]);
  const rebuttalRefs = uniqueRefs([...features.rebuttalCoverage.evidence, ...features.directRebuttals.evidence]);
  const responseRefs = features.argumentResponses.evidence;
  const impactRefs = features.impactHandling.evidence;
  // Grounded dropped arguments: this side's OWN supported claims the opponent
  // never validly answered - the canonical mirror of that side's unanswered
  // opportunities, narrowed to claim-like nodes with real grounded support so
  // credit reflects "a good argument the other side ignored".
  const linksForGrounding = supportLinks(graph);
  const groundedDropped = unansweredOpportunitiesBy(graph, opponent).filter((node) => {
    if (node.owner !== features.owner) return false;
    if (!isClaimLike(node)) return false;
    return linksForGrounding.some((link) => link.claim.id === node.id && link.quality > 0.2);
  });
  const droppedRefs = groundedDropped.length
    ? groundedDropped.map((node) => derivedRef(`dropped:${node.id}`, node.text, "Supported argument left unanswered"))
    : features.droppedArguments.evidence;
  const components = [
    component("supportedClaimRate", features.claimsDirectlySupported.value / claims, supportedRefs.length ? supportedRefs : claimRefs, "Direct support edges divided by claims made; unsupported claims do not count."),
    component("evidenceQuality", features.claimsMade.value ? (evidenceRefs.length ? averageClaimEvidenceQuality(graph, features.owner) : 0) : 0, evidenceRefs.length ? evidenceRefs : claimRefs, "Per-claim maximum of citation grounding x evidence strength x relevance; duplicate sources do not stack."),
    component("rebuttalCoverage", features.rebuttalCoverage.value, rebuttalRefs, "Canonical rebuttal coverage: opponent claim/counterclaim opportunities answered by a valid, later response divided by eligible opportunities."),
    component("argumentResponseRate", features.argumentResponses.value.rate, responseRefs, "Opponent turns answered by a target response divided by turns where a response was possible."),
    component("impactHandling", features.impactHandling.value, impactRefs, "Impact nodes linked to arguments, grounded where possible, and explicitly compared."),
    component("groundedDroppedArguments", groundedDropped.length / claims, droppedRefs, "Supported claims the opponent left unanswered; dropped unsupported assertions earn no credit."),
    component("concessionHandling", features.concessionHandling.value, features.concessionHandling.evidence.length ? features.concessionHandling.evidence : claimRefs, "Concessions are neutral unless the graph shows whether the side handled the pivot."),
    component("fallacyDiscipline", 1 - Math.min(1, features.confidentlyDetectableFallacies.value / claims), features.confidentlyDetectableFallacies.evidence, "Only deterministic fallacy matches above the confidence threshold are penalized."),
    component("contradictionDiscipline", 1 - Math.min(1, features.contradictions.value / claims), features.contradictions.evidence, "Self-contradictions are penalized relative to claims made."),
  ];
  const total = components.reduce((sum, item) => sum + item.contribution, 0);
  const supportingEvidence = uniqueRefs(components.flatMap((item) => item.evidence));
  const score = Math.round(clamp(total / 100, 0, 1) * 100);
  // Confidence in the READING (not in the side being good). It shrinks when
  // few graph references back the score, so a one-line turn cannot produce a
  // confident-looking number.
  const confidence = round(clamp(extractionConfidence * (0.5 + 0.5 * Math.min(1, supportingEvidence.length / 8))));
  return { score, status: "scored", confidence, components, supportingEvidence };
}

/**
 * Winner determination.
 *
 * A gap below the tie threshold is a TIE, never a coin-flip: two sides within
 * the noise floor of each other have no observed winner.
 */
export function decideWinner(
  status: AssessmentStatus,
  scoreA: number | null,
  scoreB: number | null,
): { winner: ObservableAssessment["winner"]; scoreGap: number | null } {
  const scoreGap = scoreA === null || scoreB === null ? null : Math.abs(scoreA - scoreB);
  const winner: ObservableAssessment["winner"] =
    status === "insufficient_evidence" || scoreGap === null || scoreGap < WINNER_TIE_THRESHOLD
      ? "tie"
      : scoreA !== null && scoreB !== null && scoreA > scoreB
        ? "a"
        : "b";
  return { winner, scoreGap };
}

/** The component that contributed most to the gap between two sides. */
export function topComponentDifference(a: ObservableSideScore, b: ObservableSideScore): ScoreComponent | null {
  let best: ScoreComponent | null = null;
  let bestAbs = -1;
  for (const left of a.components) {
    const right = b.components.find((item) => item.id === left.id);
    const difference = Math.abs(left.contribution - (right?.contribution ?? 0));
    if (difference > bestAbs) {
      best = left;
      bestAbs = difference;
    }
  }
  return best;
}

/**
 * Impact comparison derived from observable handling, never from a
 * model-supplied 0-100 number.
 */
export function impactComparisonFeature(
  features: { a: SideObservableFeatures; b: SideObservableFeatures },
  extractionConfidence: number,
): ObservableFeature<ImpactComparisonValue> {
  const a = features.a.impactHandling.value;
  const b = features.b.impactHandling.value;
  const lead = Math.abs(a - b) < 0.1 ? "tie" : a > b ? "a" : "b";
  const evidence = uniqueRefs([...features.a.impactHandling.evidence, ...features.b.impactHandling.evidence]);
  return feature({ a: round(a), b: round(b), lead }, evidence, extractionConfidence, evidence.length ? undefined : "insufficient_evidence");
}

/** Compact per-side counts for the compact score badges in the UI. */
export function breakdownFromAssessment(assessment: ObservableAssessment): { a: ObservableBreakdown; b: ObservableBreakdown } {
  const forSide = (label: "a" | "b"): ObservableBreakdown => {
    const side = assessment.features[label];
    const impacts = assessment.graph.nodes.filter((node) => node.owner === side.owner && node.kind === "impact").length;
    return {
      claims: side.claimsMade.value,
      evidence: side.evidenceActuallyCited.value,
      rebuttals: side.directRebuttals.value,
      impacts,
      fallacies: side.confidentlyDetectableFallacies.value,
      droppedSuffered: side.droppedArguments.value,
    };
  };
  return { a: forSide("a"), b: forSide("b") };
}

/**
 * Minimum observable structure before a comparison is defensible: at least
 * two claims across the graph AND something checkable (evidence, a direct
 * clash, or an impact move). Anything less is reported as insufficient.
 */
export function hasEnoughStructure(input: {
  hasGraph: boolean;
  claimCount: number;
  evidenceCount: number;
  directClashCount: number;
  impactCount: number;
}): boolean {
  return (
    input.hasGraph &&
    input.claimCount >= 2 &&
    (input.evidenceCount > 0 || input.directClashCount > 0 || input.impactCount > 0)
  );
}
