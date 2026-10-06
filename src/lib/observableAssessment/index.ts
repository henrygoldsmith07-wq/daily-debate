// Observable debate assessment - stable public surface.
//
// This barrel keeps `@/lib/observableAssessment` working exactly as before for
// every consumer while the implementation lives in focused modules:
//
//   types.ts            - the contract (weights, features, scores, options)
//   graphEnrichment.ts  - deterministic enrichment + evidence primitives
//   features.ts         - observable feature extraction
//   scoring.ts          - scoring policy, winner and confidence rules
//   assess.ts           - orchestration and user-facing phrasing
//   turnExtraction.ts   - deterministic per-turn graph extraction
//   turnProjection.ts   - learner-facing projections over an assessment

export {
  OBSERVABLE_ASSESSMENT_VERSION,
  WINNER_TIE_THRESHOLD,
  CONFIDENT_FALLACY_THRESHOLD,
  SCORE_WEIGHTS,
} from "./types";
export type {
  AssessmentOptions,
  AssessmentStatus,
  ArgumentResponseValue,
  EvidenceRef,
  ExtractionInfo,
  ExtractionSource,
  FeatureStatus,
  ImpactComparisonValue,
  ObservableAssessment,
  ObservableBreakdown,
  ObservableFeature,
  ObservableSideScore,
  ScoreComponent,
  SideObservableFeatures,
  SupportLink,
} from "./types";

export {
  bestCitationGrounding,
  citationGrounding,
  citationRefs,
  clamp,
  cloneGraph,
  derivedRef,
  edgeRef,
  emptyGraph,
  enrichObservableGraph,
  feature,
  isClaimLike,
  lexicalRelevance,
  mergeUniqueBy,
  nodeRef,
  recomputeEvidenceStats,
  round,
  tokens,
  uniqueRefs,
  validationIssues,
} from "./graphEnrichment";

export {
  addressedTargetIds,
  buildSideFeatures,
  directRebuttalRefs,
  engineReport,
  engagementOpportunitiesFor,
  impactHandling,
  supportLinks,
} from "./features";

export {
  averageClaimEvidenceQuality,
  breakdownFromAssessment,
  component,
  decideWinner,
  hasEnoughStructure,
  impactComparisonFeature,
  scoreSide,
  topComponentDifference,
} from "./scoring";

export { assessArgumentGraph, finalizePvpAssessment, labelFor, swapGraphSides } from "./assess";
export { citationFromText, graphFromTurn, splitSentences } from "./turnExtraction";
export { assessTurn, mergeAssessmentGraphs, turnScoresFromAssessment } from "./turnProjection";
export type { TurnObservableAssessment } from "./turnProjection";
