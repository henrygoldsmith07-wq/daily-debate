// Rhetorical-role classifier evaluation: confusion, calibration, latency,
// fast-vs-smart behaviour, mixed-role detection, and shadow-route agreement.
//
// Precision/recall/F1 per label come from evaluateArgumentRoleLabels
// (debateEvaluation.ts) over the labelled dataset (ARGUMENT_ROLE_EVAL_DATASET:
// five single-role items per taxonomy role plus ten mixed-role paragraphs,
// the eleventh evaluation class). This module adds the measurements that
// function does not cover:
//
// - confusion matrix over primary roles (gold primary = first expected label,
//   predicted primary = first predicted label, missing prediction = "other");
// - calibration of the classifier's primary confidence (expected calibration
//   error over fixed bins: is 0.9 confidence right 90% of the time?);
// - latency distribution of classification calls;
// - fast-vs-smart tier comparison (label agreement, escalation counts,
//   latency deltas) so tier behaviour is measured, not assumed;
// - mixed-role detection scored as its own binary class (predicting
//   multi-role vs single-role), because mixed paragraphs are where forced
//   single-label classifiers silently lose recall;
// - shadow-route agreement: do predicted labels route debates the same way
//   gold labels would (same route, same judge-path decision)?
//
// All functions are pure and offline. Live-provider runs, if ever needed,
// stay outside this module: callers inject predictions.
//
// Neutrality: the dataset motions are civically neutral on purpose. Nothing
// here scores political correctness, winners, or persuasiveness — only
// whether structural labels match their gold labels.

import {
  ARGUMENT_ROLE_EVAL_DATASET,
  evaluateArgumentRoleLabels,
  type ArgumentRoleEvaluationReport,
  type ArgumentRoleLabelCase,
} from "./debateEvaluation";
import {
  ARGUMENT_ROLE_LABELS,
  type ArgumentRole,
  type ArgumentRoute,
} from "./argumentTaxonomy";
import type { ArgumentRoutingPlan } from "./argumentRouting";

export type RolePredictionMap =
  | ReadonlyMap<string, ReadonlyArray<ArgumentRole>>
  | Readonly<Record<string, ReadonlyArray<ArgumentRole>>>;

export type ConfidenceMap =
  | ReadonlyMap<string, number>
  | Readonly<Record<string, number>>;

function predictedLabels(predictions: RolePredictionMap, id: string): ReadonlyArray<ArgumentRole> {
  const value = predictions instanceof Map
    ? predictions.get(id)
    : (predictions as Readonly<Record<string, ReadonlyArray<ArgumentRole>>>)[id];
  return value ?? ["other"];
}

function predictedConfidence(confidences: ConfidenceMap | undefined, id: string): number | null {
  if (!confidences) return null;
  const value = confidences instanceof Map
    ? confidences.get(id)
    : (confidences as Readonly<Record<string, number>>)[id];
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
}

/** Coverage of the labelled set: gold items per taxonomy role plus mixed-role paragraphs. */
export interface DatasetCoverage {
  cases: number;
  perRole: Record<ArgumentRole, number>;
  mixedRoleCases: number;
  offTopicWithTopic: number;
}

export function describeDatasetCoverage(
  cases: ReadonlyArray<ArgumentRoleLabelCase> = ARGUMENT_ROLE_EVAL_DATASET,
): DatasetCoverage {
  const perRole = Object.fromEntries(ARGUMENT_ROLE_LABELS.map((label) => [label, 0])) as Record<ArgumentRole, number>;
  let mixed = 0;
  let offTopicWithTopic = 0;
  for (const item of cases) {
    for (const label of new Set(item.expected)) perRole[label] += 1;
    if (item.expected.length > 1) mixed += 1;
    if (item.expected.includes("off-topic") && item.topic) offTopicWithTopic += 1;
  }
  return { cases: cases.length, perRole, mixedRoleCases: mixed, offTopicWithTopic };
}

// ---------------------------------------------------------------------------
// Confusion matrix over primary roles
// ---------------------------------------------------------------------------

export interface ConfusionMatrix {
  /** Taxonomy order; matrix[goldIndex][predictedIndex] counts items. */
  labels: readonly ArgumentRole[];
  matrix: number[][];
}

export function buildConfusionMatrix(
  cases: ReadonlyArray<ArgumentRoleLabelCase>,
  predictions: RolePredictionMap,
): ConfusionMatrix {
  const index = new Map<ArgumentRole, number>(ARGUMENT_ROLE_LABELS.map((label, i) => [label, i]));
  const matrix = ARGUMENT_ROLE_LABELS.map(() => ARGUMENT_ROLE_LABELS.map(() => 0));
  for (const item of cases) {
    const gold = item.expected[0] ?? "other";
    const predicted = predictedLabels(predictions, item.id)[0] ?? "other";
    matrix[index.get(gold)!][index.get(predicted)!] += 1;
  }
  return { labels: ARGUMENT_ROLE_LABELS, matrix };
}

// ---------------------------------------------------------------------------
// Calibration of primary confidence (expected calibration error)
// ---------------------------------------------------------------------------

export interface CalibrationBin {
  lo: number;
  hi: number;
  n: number;
  /** Share of items in the bin whose predicted primary matched gold primary. */
  accuracy: number | null;
  /** Mean predicted confidence in the bin. */
  meanConfidence: number | null;
}

export interface CalibrationReport {
  n: number;
  bins: CalibrationBin[];
  /** Mean |accuracy − confidence| weighted by bin mass. */
  ece: number | null;
  /** Largest |accuracy − confidence| over non-empty bins. */
  maxGap: number | null;
}

export function calibrationReport(
  cases: ReadonlyArray<ArgumentRoleLabelCase>,
  predictions: RolePredictionMap,
  confidences: ConfidenceMap | undefined,
  binCount = 10,
): CalibrationReport {
  const samples: Array<{ confidence: number; correct: boolean }> = [];
  for (const item of cases) {
    const confidence = predictedConfidence(confidences, item.id);
    if (confidence === null) continue;
    const gold = item.expected[0] ?? "other";
    const predicted = predictedLabels(predictions, item.id)[0] ?? "other";
    samples.push({ confidence, correct: gold === predicted });
  }
  const bins: CalibrationBin[] = Array.from({ length: binCount }, (_, i) => ({
    lo: i / binCount,
    hi: (i + 1) / binCount,
    n: 0,
    accuracy: null,
    meanConfidence: null,
  }));
  for (const sample of samples) {
    const slot = Math.min(binCount - 1, Math.floor(sample.confidence * binCount));
    const bin = bins[slot];
    bin.n += 1;
    bin.accuracy = (bin.accuracy ?? 0) + (sample.correct ? 1 : 0);
    bin.meanConfidence = (bin.meanConfidence ?? 0) + sample.confidence;
  }
  let weightedGap = 0;
  let maxGap: number | null = null;
  for (const bin of bins) {
    if (!bin.n) continue;
    bin.accuracy = bin.accuracy! / bin.n;
    bin.meanConfidence = bin.meanConfidence! / bin.n;
    const gap = Math.abs(bin.accuracy - bin.meanConfidence);
    weightedGap += (bin.n / samples.length) * gap;
    maxGap = maxGap === null ? gap : Math.max(maxGap, gap);
  }
  return {
    n: samples.length,
    bins,
    ece: samples.length ? weightedGap : null,
    maxGap,
  };
}

// ---------------------------------------------------------------------------
// Latency distribution
// ---------------------------------------------------------------------------

export interface LatencySummary {
  n: number;
  meanMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}

function percentile(sortedAsc: number[], p: number): number {
  const rank = Math.max(1, Math.ceil(p * sortedAsc.length));
  return sortedAsc[Math.min(rank, sortedAsc.length) - 1];
}

export function summariseLatencies(samplesMs: number[]): LatencySummary {
  if (!samplesMs.length) return { n: 0, meanMs: null, p50Ms: null, p95Ms: null, maxMs: null };
  const sorted = [...samplesMs].sort((a, b) => a - b);
  return {
    n: sorted.length,
    meanMs: sorted.reduce((s, v) => s + v, 0) / sorted.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted[sorted.length - 1],
  };
}

// ---------------------------------------------------------------------------
// Mixed-role detection as its own binary class
// ---------------------------------------------------------------------------

export interface MixedRoleDetection {
  cases: number;
  mixedCases: number;
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
}

function isMultiRole(labels: ReadonlyArray<ArgumentRole>): boolean {
  return labels.filter((label) => label !== "other").length > 1;
}

export function evaluateMixedRoleDetection(
  cases: ReadonlyArray<ArgumentRoleLabelCase>,
  predictions: RolePredictionMap,
): MixedRoleDetection {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let mixed = 0;
  for (const item of cases) {
    const want = item.expected.length > 1;
    const got = isMultiRole(predictedLabels(predictions, item.id));
    if (want) mixed += 1;
    if (want && got) tp += 1;
    else if (!want && got) fp += 1;
    else if (want && !got) fn += 1;
  }
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  return {
    cases: cases.length,
    mixedCases: mixed,
    tp,
    fp,
    fn,
    precision,
    recall,
    f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall),
  };
}

// ---------------------------------------------------------------------------
// Fast-vs-smart tier comparison
// ---------------------------------------------------------------------------

export interface TierRunResult {
  tier: string;
  labels: Record<string, ReadonlyArray<ArgumentRole>>;
  latencyMs: number[];
  escalatedCount: number;
}

export interface TierComparison {
  ids: number;
  /** Share of items with identical predicted label sets. */
  labelAgreement: number | null;
  /** Share of items with identical predicted primary roles. */
  primaryAgreement: number | null;
  /** Mean (smart − fast) latency per call, ms. */
  meanLatencyDeltaMs: number | null;
  fastEscalated: number;
  smartEscalated: number;
  flips: Array<{ id: string; fast: ReadonlyArray<ArgumentRole>; smart: ReadonlyArray<ArgumentRole> }>;
}

export function compareClassifierTiers(fast: TierRunResult, smart: TierRunResult): TierComparison {
  const ids = [...new Set([...Object.keys(fast.labels), ...Object.keys(smart.labels)])].sort();
  let exact = 0;
  let primary = 0;
  const flips: TierComparison["flips"] = [];
  for (const id of ids) {
    const fastLabels = [...(fast.labels[id] ?? ["other"])];
    const smartLabels = [...(smart.labels[id] ?? ["other"])];
    const same = fastLabels.length === smartLabels.length && fastLabels.every((label) => smartLabels.includes(label));
    if (same) exact += 1;
    else flips.push({ id, fast: fastLabels, smart: smartLabels });
    if ((fastLabels[0] ?? "other") === (smartLabels[0] ?? "other")) primary += 1;
  }
  const fastMean = fast.latencyMs.length ? fast.latencyMs.reduce((s, v) => s + v, 0) / fast.latencyMs.length : null;
  const smartMean = smart.latencyMs.length ? smart.latencyMs.reduce((s, v) => s + v, 0) / smart.latencyMs.length : null;
  return {
    ids: ids.length,
    labelAgreement: ids.length ? exact / ids.length : null,
    primaryAgreement: ids.length ? primary / ids.length : null,
    meanLatencyDeltaMs: fastMean !== null && smartMean !== null ? smartMean - fastMean : null,
    fastEscalated: fast.escalatedCount,
    smartEscalated: smart.escalatedCount,
    flips,
  };
}

// ---------------------------------------------------------------------------
// Shadow-route agreement: predicted labels vs gold labels
// ---------------------------------------------------------------------------

export interface ShadowRouteAgreement {
  pairs: number;
  /** Share of debates routed to the same route by both label sources. */
  routeAgreement: number | null;
  /** Share with the same expensive-judge decision (the routing consequence). */
  judgePathAgreement: number | null;
  disagreements: Array<{ id: string; goldRoute: ArgumentRoute; predictedRoute: ArgumentRoute }>;
}

export function measureShadowRouteAgreement(
  pairs: Array<{ id: string; gold: ArgumentRoutingPlan; predicted: ArgumentRoutingPlan }>,
): ShadowRouteAgreement {
  const disagreements: ShadowRouteAgreement["disagreements"] = [];
  let judgePath = 0;
  for (const pair of pairs) {
    if (pair.gold.route !== pair.predicted.route) {
      disagreements.push({ id: pair.id, goldRoute: pair.gold.route, predictedRoute: pair.predicted.route });
    }
    if (pair.gold.requiresExpensiveJudge === pair.predicted.requiresExpensiveJudge) judgePath += 1;
  }
  return {
    pairs: pairs.length,
    routeAgreement: pairs.length ? (pairs.length - disagreements.length) / pairs.length : null,
    judgePathAgreement: pairs.length ? judgePath / pairs.length : null,
    disagreements,
  };
}

// ---------------------------------------------------------------------------
// Orchestrator: one report over the labelled dataset
// ---------------------------------------------------------------------------

export interface RhetoricalRoleEvaluationInput {
  predictions: RolePredictionMap;
  /** Primary-confidence per item id (omitted when the source withholds it). */
  confidences?: ConfidenceMap;
  /** Per-call latency samples in ms. */
  latenciesMs?: number[];
  /** Optional paired tier runs for fast-vs-smart behaviour. */
  tiers?: { fast: TierRunResult; smart: TierRunResult };
  /** Optional paired routing plans for shadow-route agreement. */
  routePairs?: Array<{ id: string; gold: ArgumentRoutingPlan; predicted: ArgumentRoutingPlan }>;
}

export interface RhetoricalRoleEvaluationReport {
  taxonomyCoverage: DatasetCoverage;
  labels: ArgumentRoleEvaluationReport;
  confusion: ConfusionMatrix;
  mixedRole: MixedRoleDetection;
  calibration: CalibrationReport;
  latency: LatencySummary;
  tiers: TierComparison | null;
  shadowRouteAgreement: ShadowRouteAgreement | null;
}

export function evaluateRhetoricalRoles(input: RhetoricalRoleEvaluationInput): RhetoricalRoleEvaluationReport {
  const cases = ARGUMENT_ROLE_EVAL_DATASET;
  return {
    taxonomyCoverage: describeDatasetCoverage(cases),
    labels: evaluateArgumentRoleLabels(cases, input.predictions),
    confusion: buildConfusionMatrix(cases, input.predictions),
    mixedRole: evaluateMixedRoleDetection(cases, input.predictions),
    calibration: calibrationReport(cases, input.predictions, input.confidences),
    latency: summariseLatencies(input.latenciesMs ?? []),
    tiers: input.tiers ? compareClassifierTiers(input.tiers.fast, input.tiers.smart) : null,
    shadowRouteAgreement: input.routePairs ? measureShadowRouteAgreement(input.routePairs) : null,
  };
}
