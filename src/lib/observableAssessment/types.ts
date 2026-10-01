// Shared types and constants for observable debate assessment.
//
// A model may extract an ArgGraph, but it never chooses the score: the scorer
// recomputes graph statistics, attaches evidence references to every scored
// component, and returns "insufficient_evidence" when the graph cannot support
// a meaningful comparison. These types describe that contract.

import type { ArgGraph, Owner } from "../argGraph";
import type { EngineReport } from "../argumentEvaluation";

export const OBSERVABLE_ASSESSMENT_VERSION = 1;
export const WINNER_TIE_THRESHOLD = 5;
export const CONFIDENT_FALLACY_THRESHOLD = 0.72;

/** The only weights used by the core 0-100 score. They sum to 100. */
export const SCORE_WEIGHTS = Object.freeze({
  supportedClaimRate: 20,
  evidenceQuality: 25,
  rebuttalCoverage: 20,
  argumentResponseRate: 10,
  impactHandling: 10,
  groundedDroppedArguments: 5,
  concessionHandling: 3,
  fallacyDiscipline: 4,
  contradictionDiscipline: 3,
});

export type AssessmentStatus = "scored" | "insufficient_evidence";
export type FeatureStatus = "observed" | "uncertain" | "insufficient_evidence";
export type ExtractionSource = "deterministic" | "llm" | "human";

export interface EvidenceRef {
  id: string;
  kind: "node" | "edge" | "derived";
  excerpt: string;
  round?: number;
  note?: string;
}

export interface ObservableFeature<T> {
  value: T;
  status: FeatureStatus;
  /** Confidence in the observation, not confidence that the side is good. */
  confidence: number;
  evidence: EvidenceRef[];
}

export interface ArgumentResponseValue {
  responded: number;
  opportunities: number;
  rate: number;
}

export interface ImpactComparisonValue {
  a: number;
  b: number;
  lead: "a" | "b" | "tie";
}

export interface SideObservableFeatures {
  owner: Owner;
  claimsMade: ObservableFeature<number>;
  claimsDirectlySupported: ObservableFeature<number>;
  evidenceActuallyCited: ObservableFeature<number>;
  evidenceRelevance: ObservableFeature<number>;
  directRebuttals: ObservableFeature<number>;
  rebuttalCoverage: ObservableFeature<number>;
  droppedArguments: ObservableFeature<number>;
  contradictions: ObservableFeature<number>;
  unsupportedAssertions: ObservableFeature<number>;
  concededPoints: ObservableFeature<number>;
  concessionHandling: ObservableFeature<number>;
  argumentResponses: ObservableFeature<ArgumentResponseValue>;
  impactHandling: ObservableFeature<number>;
  confidentlyDetectableFallacies: ObservableFeature<number>;
}

export interface ScoreComponent {
  id: keyof typeof SCORE_WEIGHTS;
  weight: number;
  rawValue: number;
  contribution: number;
  evidence: EvidenceRef[];
  rationale: string;
}

export interface ObservableSideScore {
  score: number | null;
  status: AssessmentStatus;
  confidence: number;
  components: ScoreComponent[];
  supportingEvidence: EvidenceRef[];
}

export interface ExtractionInfo {
  source: ExtractionSource;
  confidence: number;
  validationIssues: string[];
  uncertainty: string[];
}

export interface ObservableAssessment {
  version: 1;
  status: AssessmentStatus;
  winner: "a" | "b" | "tie";
  scoreGap: number | null;
  scores: { a: number | null; b: number | null };
  features: { a: SideObservableFeatures; b: SideObservableFeatures };
  sideScores: { a: ObservableSideScore; b: ObservableSideScore };
  impactComparison: ObservableFeature<ImpactComparisonValue>;
  scoreComposition: {
    formula: string;
    weights: typeof SCORE_WEIGHTS;
    tieThreshold: number;
  };
  extraction: ExtractionInfo;
  uncertainty: string[];
  decidingFactor: string;
  rationale: string;
  /** The graph shown to users is the graph after deterministic enrichment. */
  graph: ArgGraph;
  /** Engine findings (causal overclaim, fake precision, rebuttal/steelman quality) - additive, may be absent on older records. */
  engine?: EngineReport;
}

export interface AssessmentOptions {
  /** Graph owner used for labelled side A. Defaults to PvP's `a`. */
  sideA?: Owner;
  /** Graph owner used for labelled side B. Defaults to PvP's `b`. */
  sideB?: Owner;
  extractionSource?: ExtractionSource;
  extractionConfidence?: number;
  labelA?: string;
  labelB?: string;
}

export interface ObservableBreakdown {
  claims: number;
  evidence: number;
  rebuttals: number;
  impacts: number;
  fallacies: number;
  droppedSuffered: number;
}

export interface SupportLink {
  claim: ArgGraph["nodes"][number];
  evidence: ArgGraph["nodes"][number];
  edge?: ArgGraph["edges"][number];
  relevance: number;
  quality: number;
}
