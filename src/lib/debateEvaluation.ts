// Daily Debate Evaluation — human-rated debate corpus pipeline.
// Six-dimension rubric scored per side (A/B) by multiple human raters;
// inter-rater reliability is measured FIRST and gates everything downstream.
// Then: system-vs-human comparison, score calibration, verbosity bias and
// writing-style bias detection. Pure, offline, no model calls.

import { pearsonCorrelation, spearmanCorrelation } from "./humanCorpus";
import { ARGUMENT_ROLE_LABELS, ARGUMENT_TAXONOMY_VERSION, type ArgumentRole } from "./argumentTaxonomy";

export const EVAL_DIMENSIONS = [
  "evidenceQuality",
  "reasoning",
  "relevance",
  "rebuttalQuality",
  "logicalValidity",
  "sourceQuality",
] as const;

export type DebateEvalDimension = (typeof EVAL_DIMENSIONS)[number];
export type EvalScore = number; // 1..5 Likert
export type SideScores = Record<DebateEvalDimension, EvalScore>;

export interface EvalRaterVerdict {
  raterId: string;
  a: SideScores;
  b: SideScores;
  confidence?: number;
  rationale?: string;
}

export type EvalProvenance = "verified_human" | "unverified_fixture" | "synthetic";

export interface EvalDebate {
  id: string;
  transcript: string;
  topic?: string;
  raters: EvalRaterVerdict[];
  provenance?: EvalProvenance;
  createdAt?: string;
}

export interface SystemVerdict {
  id: string;
  a: Partial<SideScores>;
  b: Partial<SideScores>;
}

// ---------------------------------------------------------------------------
// Structural-role evaluation corpus and routing-savings measurement
// ---------------------------------------------------------------------------

export interface ArgumentRoleLabelCase {
  id: string;
  text: string;
  expected: ArgumentRole[];
  /** Topic is context for off-topic labels, never a correctness label. */
  topic?: string;
  provenance: "verified_human" | "unverified_fixture" | "synthetic";
}

/**
 * Small, auditable seed set for the role router. It deliberately contains
 * mixed-role moves: a real classifier evaluation must measure multi-label
 * recall rather than rewarding a forced single label.
 *
 * Coverage: five single-role items for each of the ten taxonomy roles, plus
 * ten mixed-role paragraphs (the eleventh evaluation class). All motions are
 * civically neutral (libraries, parks, schools, markets) so the set measures
 * structural labelling only — never political or controversial judgement.
 * New items are marked synthetic; promotion to verified_human goes through
 * the human-corpus protocol, never by editing in place.
 */
export const ARGUMENT_ROLE_EVAL_DATASET: readonly ArgumentRoleLabelCase[] = [
  { id: "claim-1", text: "The policy would reduce peak electricity costs.", expected: ["claim"], provenance: "synthetic" },
  { id: "claim-2", text: "The library should extend its evening hours.", expected: ["claim"], provenance: "synthetic" },
  { id: "claim-3", text: "A community garden would give residents fresh produce.", expected: ["claim"], provenance: "synthetic" },
  { id: "claim-4", text: "The town festival deserves a larger budget.", expected: ["claim"], provenance: "synthetic" },
  { id: "claim-5", text: "Shorter school days would improve student focus.", expected: ["claim"], provenance: "synthetic" },
  { id: "evidence-1", text: "According to the 2024 NREL report, storage costs fell by 18%.", expected: ["evidence"], provenance: "synthetic" },
  { id: "evidence-2", text: "The 2023 parks survey reports 40% higher weekend use.", expected: ["evidence"], provenance: "synthetic" },
  { id: "evidence-3", text: "According to the library audit, visits rose by 12%.", expected: ["evidence"], provenance: "synthetic" },
  { id: "evidence-4", text: "Research on school start times links later mornings to better attendance: https://example.org/sleep-study", expected: ["evidence"], provenance: "synthetic" },
  { id: "evidence-5", text: "City data shows recycling tonnage doubled after the bin rollout.", expected: ["evidence"], provenance: "synthetic" },
  { id: "reasoning-1", text: "Because the queue is shorter, more households can access the service.", expected: ["reasoning"], provenance: "synthetic" },
  { id: "reasoning-2", text: "Because the pool heater failed, lessons moved indoors.", expected: ["reasoning"], provenance: "synthetic" },
  { id: "reasoning-3", text: "More shade means the playground stays usable at noon.", expected: ["reasoning"], provenance: "synthetic" },
  { id: "reasoning-4", text: "The grant leads to new instruments, so the music club can restart.", expected: ["reasoning"], provenance: "synthetic" },
  { id: "reasoning-5", text: "Volunteers sort donations; therefore the pantry opens earlier.", expected: ["reasoning"], provenance: "synthetic" },
  { id: "rebuttal-1", text: "However, that cost estimate ignores the grid-upgrade requirement.", expected: ["rebuttal"], provenance: "synthetic" },
  { id: "rebuttal-2", text: "You argue the mural harms visibility, but drivers slow down instead.", expected: ["rebuttal"], provenance: "synthetic" },
  { id: "rebuttal-3", text: "That ignores the waiting list: demand already exceeds capacity.", expected: ["rebuttal"], provenance: "synthetic" },
  { id: "rebuttal-4", text: "However, the night market funds the cleanup crew.", expected: ["rebuttal"], provenance: "synthetic" },
  { id: "rebuttal-5", text: "In response, the council published the full maintenance log.", expected: ["rebuttal"], provenance: "synthetic" },
  { id: "counterexample-1", text: "One rural district kept service reliable without that subsidy.", expected: ["counterexample"], provenance: "synthetic" },
  { id: "counterexample-2", text: "One branch kept weekend hours without extra staff.", expected: ["counterexample"], provenance: "synthetic" },
  { id: "counterexample-3", text: "The north pool stayed open all winter as an exception.", expected: ["counterexample"], provenance: "synthetic" },
  { id: "counterexample-4", text: "A nearby town funds its festival entirely by donations.", expected: ["counterexample"], provenance: "synthetic" },
  { id: "counterexample-5", text: "One school kept scores steady with a four-day week.", expected: ["counterexample"], provenance: "synthetic" },
  { id: "concession-1", text: "I agree that the transition creates short-term disruption.", expected: ["concession"], provenance: "synthetic" },
  { id: "concession-2", text: "Admittedly, the new bins overflow on holidays.", expected: ["concession"], provenance: "synthetic" },
  { id: "concession-3", text: "Fair point: the poster campaign reached few renters.", expected: ["concession"], provenance: "synthetic" },
  { id: "concession-4", text: "I agree the evening bus ran nearly empty.", expected: ["concession"], provenance: "synthetic" },
  { id: "concession-5", text: "Even if turnout was low, the workshop was worth holding.", expected: ["concession"], provenance: "synthetic" },
  { id: "qualification-1", text: "That conclusion may hold only where the grid has spare capacity.", expected: ["qualification"], provenance: "synthetic" },
  { id: "qualification-2", text: "The pool plan works unless lifeguard hiring stalls.", expected: ["qualification"], provenance: "synthetic" },
  { id: "qualification-3", text: "In some cases the garden beds need replanting mid-season.", expected: ["qualification"], provenance: "synthetic" },
  { id: "qualification-4", text: "That schedule generally holds, except during exams.", expected: ["qualification"], provenance: "synthetic" },
  { id: "qualification-5", text: "Results might differ for the high-school league.", expected: ["qualification"], provenance: "synthetic" },
  { id: "question-1", text: "What evidence would show that the effect persists after year five?", expected: ["question"], provenance: "synthetic" },
  { id: "question-2", text: "When does the farmers market move outdoors?", expected: ["question"], provenance: "synthetic" },
  { id: "question-3", text: "Could the museum lend its exhibit for the fair?", expected: ["question"], provenance: "synthetic" },
  { id: "question-4", text: "Who maintains the trail markers after storms?", expected: ["question"], provenance: "synthetic" },
  { id: "question-5", text: "Should the closing time shift in winter?", expected: ["question"], provenance: "synthetic" },
  { id: "off-topic-1", text: "My favourite films this year have all been comedies.", expected: ["off-topic"], topic: "Should cities expand public transit?", provenance: "synthetic" },
  { id: "off-topic-2", text: "I finally fixed the wobbly shelf in my garage.", expected: ["off-topic"], topic: "Should the library extend evening hours?", provenance: "synthetic" },
  { id: "off-topic-3", text: "Penguins cannot fly but swim remarkably well.", expected: ["off-topic"], topic: "Should the town fund a night market?", provenance: "synthetic" },
  { id: "off-topic-4", text: "My sourdough starter survived the move.", expected: ["off-topic"], topic: "Should schools start later?", provenance: "synthetic" },
  { id: "off-topic-5", text: "Thursday chess club welcomes beginners of all ages.", expected: ["off-topic"], topic: "Should the pool open year-round?", provenance: "synthetic" },
  { id: "other-1", text: "Thanks for taking the time to debate this.", expected: ["other"], provenance: "synthetic" },
  { id: "other-2", text: "Thanks, that covers everything I wanted to raise.", expected: ["other"], provenance: "synthetic" },
  { id: "other-3", text: "Hello everyone, glad to be here.", expected: ["other"], provenance: "synthetic" },
  { id: "other-4", text: "Let us take a short break before continuing.", expected: ["other"], provenance: "synthetic" },
  { id: "other-5", text: "Noted.", expected: ["other"], provenance: "synthetic" },
  { id: "mixed-claim-evidence", text: "The policy cuts costs; Lazard's 2024 analysis reports lower levelised cost for new solar.", expected: ["claim", "evidence"], provenance: "synthetic" },
  { id: "mixed-claim-reasoning", text: "The policy improves access because the eligibility gap is smaller, so fewer people are excluded.", expected: ["claim", "reasoning"], provenance: "synthetic" },
  { id: "mixed-rebuttal-evidence", text: "That objection misses the measured result: the NIST review found failure rates fell after the upgrade.", expected: ["rebuttal", "evidence"], provenance: "synthetic" },
  { id: "mixed-counter-rebuttal", text: "The rural pilot is a counterexample to the claim that every district needs the same subsidy.", expected: ["counterexample", "rebuttal"], provenance: "synthetic" },
  { id: "mixed-concession-qualification", text: "That point is fair, although it applies only during the initial rollout.", expected: ["concession", "qualification"], provenance: "synthetic" },
  { id: "mixed-question-qualification", text: "Could the result be different if demand doubles, and what assumption controls that?", expected: ["question", "qualification"], provenance: "synthetic" },
  { id: "mixed-evidence-reasoning", text: "Pew's survey finds higher uptake, which means the access benefit is not just theoretical.", expected: ["evidence", "reasoning"], provenance: "synthetic" },
  { id: "mixed-claim-off-topic", text: "The proposal is important, but I also want to mention my weekend plans.", expected: ["claim", "off-topic"], topic: "Should the proposal be adopted?", provenance: "synthetic" },
  { id: "mixed-evidence-qualification", text: "The 2024 audit reports higher footfall, though weekends may still need extra staff.", expected: ["evidence", "qualification"], provenance: "synthetic" },
  { id: "mixed-claim-concession", text: "The market should open weekly; I agree the first month will be quiet.", expected: ["claim", "concession"], provenance: "synthetic" },
] as const;

export interface ArgumentRoleLabelMetrics {
  label: ArgumentRole;
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface ArgumentRoleEvaluationReport {
  taxonomyVersion: typeof ARGUMENT_TAXONOMY_VERSION;
  cases: number;
  exactMatch: number;
  mixedRoleCases: number;
  mixedRoleExactMatch: number;
  microPrecision: number;
  microRecall: number;
  microF1: number;
  macroF1: number;
  unknownPredictions: number;
  perLabel: ArgumentRoleLabelMetrics[];
}

type ArgumentRolePrediction = ReadonlyArray<ArgumentRole> | { labels: ReadonlyArray<ArgumentRole> };

function predictionFor(
  predictions: ReadonlyMap<string, ArgumentRolePrediction> | Readonly<Record<string, ArgumentRolePrediction>>,
  id: string,
): ReadonlyArray<ArgumentRole> {
  const value = predictions instanceof Map
    ? predictions.get(id)
    : (predictions as Readonly<Record<string, ArgumentRolePrediction>>)[id];
  if (!value) return ["other"];
  return Array.isArray(value) ? value : value.labels;
}

function f1(precision: number, recall: number): number {
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

export function evaluateArgumentRoleLabels(
  cases: ReadonlyArray<ArgumentRoleLabelCase>,
  predictions: ReadonlyMap<string, ArgumentRolePrediction> | Readonly<Record<string, ArgumentRolePrediction>>,
): ArgumentRoleEvaluationReport {
  const counts = new Map<ArgumentRole, { tp: number; fp: number; fn: number }>(ARGUMENT_ROLE_LABELS.map((label) => [label, { tp: 0, fp: 0, fn: 0 }]));
  let exact = 0;
  let mixedCases = 0;
  let mixedExact = 0;
  let unknownPredictions = 0;
  for (const item of cases) {
    const expected = new Set(item.expected);
    const predicted = new Set(predictionFor(predictions, item.id));
    if (predicted.has("other") && !expected.has("other")) unknownPredictions += 1;
    if ([...expected].every((label) => predicted.has(label)) && [...predicted].every((label) => expected.has(label))) exact += 1;
    if (expected.size > 1) {
      mixedCases += 1;
      if ([...expected].every((label) => predicted.has(label)) && [...predicted].every((label) => expected.has(label))) mixedExact += 1;
    }
    for (const label of ARGUMENT_ROLE_LABELS) {
      const want = expected.has(label);
      const got = predicted.has(label);
      const row = counts.get(label)!;
      if (want && got) row.tp += 1;
      else if (!want && got) row.fp += 1;
      else if (want && !got) row.fn += 1;
    }
  }
  const perLabel = ARGUMENT_ROLE_LABELS.map((label) => {
    const row = counts.get(label)!;
    const precision = row.tp + row.fp ? row.tp / (row.tp + row.fp) : 0;
    const recall = row.tp + row.fn ? row.tp / (row.tp + row.fn) : 0;
    return { label, ...row, precision, recall, f1: f1(precision, recall) };
  });
  const tp = perLabel.reduce((sum, row) => sum + row.tp, 0);
  const fp = perLabel.reduce((sum, row) => sum + row.fp, 0);
  const fn = perLabel.reduce((sum, row) => sum + row.fn, 0);
  const microPrecision = tp + fp ? tp / (tp + fp) : 0;
  const microRecall = tp + fn ? tp / (tp + fn) : 0;
  return {
    taxonomyVersion: ARGUMENT_TAXONOMY_VERSION,
    cases: cases.length,
    exactMatch: cases.length ? exact / cases.length : 0,
    mixedRoleCases: mixedCases,
    mixedRoleExactMatch: mixedCases ? mixedExact / mixedCases : 0,
    microPrecision,
    microRecall,
    microF1: f1(microPrecision, microRecall),
    macroF1: perLabel.reduce((sum, row) => sum + row.f1, 0) / perLabel.length,
    unknownPredictions,
    perLabel,
  };
}

export interface JudgeRoutingObservation {
  baselineExpensiveJudgeCalls: number;
  actualExpensiveJudgeCalls: number;
  argumentCount?: number;
  classifierBatches?: number;
  fallbackCount?: number;
  route?: string;
}

export interface JudgeAvoidanceMeasurement {
  observations: number;
  baselineExpensiveJudgeCalls: number;
  actualExpensiveJudgeCalls: number;
  expensiveJudgeCallsAvoided: number;
  avoidanceRate: number | null;
  routedArguments: number;
  classifierBatches: number;
  fallbackCount: number;
}

/** Compare observed judge legs with the no-router baseline. */
export function measureExpensiveJudgeAvoidance(observations: JudgeRoutingObservation[]): JudgeAvoidanceMeasurement {
  const baseline = observations.reduce((sum, row) => sum + Math.max(0, row.baselineExpensiveJudgeCalls), 0);
  const actual = observations.reduce((sum, row) => sum + Math.max(0, row.actualExpensiveJudgeCalls), 0);
  const avoided = Math.max(0, baseline - actual);
  return {
    observations: observations.length,
    baselineExpensiveJudgeCalls: baseline,
    actualExpensiveJudgeCalls: actual,
    expensiveJudgeCallsAvoided: avoided,
    avoidanceRate: baseline ? avoided / baseline : null,
    routedArguments: observations.reduce((sum, row) => sum + (row.argumentCount ?? 0), 0),
    classifierBatches: observations.reduce((sum, row) => sum + (row.classifierBatches ?? 0), 0),
    fallbackCount: observations.reduce((sum, row) => sum + (row.fallbackCount ?? 0), 0),
  };
}

export const measureJudgeCallsAvoided = measureExpensiveJudgeAvoidance;

export function sideScores(values: Partial<SideScores>, fallback: EvalScore = 3): SideScores {
  const out = {} as SideScores;
  for (const d of EVAL_DIMENSIONS) out[d] = values[d] ?? fallback;
  return out;
}

export function meanSideScore(s: SideScores): number {
  return EVAL_DIMENSIONS.reduce((acc, d) => acc + s[d], 0) / EVAL_DIMENSIONS.length;
}

const clampScore = (v: number): EvalScore => Math.max(1, Math.min(5, v));

export function extractSides(transcript: string): { a: string; b: string } {
  let a = "";
  let b = "";
  for (const line of transcript.split(/\r?\n/)) {
    if (/^\s*(?:\*\*)?player\s*a\b/i.test(line)) a += line.replace(/^\s*(?:\*\*)?player\s*a\b[^:]*:?\s*/i, "") + "\n";
    else if (/^\s*(?:\*\*)?player\s*b\b/i.test(line)) b += line.replace(/^\s*(?:\*\*)?player\s*b\b[^:]*:?\s*/i, "") + "\n";
  }
  return { a, b };
}

export function countWords(text: string): number {
  return (text.match(/[A-Za-z0-9']+/g) ?? []).length;
}

const countMatches = (text: string, re: RegExp): number => (text.match(re) ?? []).length;

export interface StyleFeatures {
  avgWordChars: number;
  longWordRatio: number;
  formalConnectorsPer100: number;
  hedgesPer100: number;
  assertivesPer100: number;
}

export function styleFeatures(text: string): StyleFeatures {
  const words = text.match(/[A-Za-z']+/g) ?? [];
  const n = words.length || 1;
  const longWords = words.filter((w) => (w.match(/[aeiouy]+/gi) ?? []).length >= 3).length;
  const per100 = (c: number) => (c / n) * 100;
  return {
    avgWordChars: words.reduce((s, w) => s + w.length, 0) / n,
    longWordRatio: longWords / n,
    formalConnectorsPer100: per100(
      countMatches(text, /\b(however|consequently|furthermore|moreover|nevertheless|thus|hence|notwithstanding)\b/gi),
    ),
    hedgesPer100: per100(countMatches(text, /\b(arguably|perhaps|possibly|somewhat|might|may|could)\b/gi)),
    assertivesPer100: per100(countMatches(text, /\b(absolutely|unequivocally|undoubtedly|clearly|certainly)\b/gi)),
  };
}

export const STYLE_FEATURE_NAMES: Array<keyof StyleFeatures> = [
  "avgWordChars",
  "longWordRatio",
  "formalConnectorsPer100",
  "hedgesPer100",
  "assertivesPer100",
];

// ---------------------------------------------------------------------------
// Inter-rater reliability (measured FIRST — gates all downstream analyses)
// ---------------------------------------------------------------------------

export interface IccResult {
  single: number;
  average: number;
}

/**
 * Two-way random effects ICC, absolute agreement (Shrout & Fleiss ICC(2,1)
 * single measures and the corresponding average-measure reliability).
 * `ratings` is items × raters (complete matrix required).
 */
export function iccTwoWay(ratings: number[][]): IccResult {
  const n = ratings.length;
  const k = n ? ratings[0].length : 0;
  if (n < 2 || k < 2) return { single: 1, average: 1 };
  const grand = ratings.flat().reduce((a, b) => a + b, 0) / (n * k);
  const itemMeans = ratings.map((row) => row.reduce((a, b) => a + b, 0) / k);
  const raterMeans = Array.from({ length: k }, (_, j) =>
    ratings.reduce((a, row) => a + row[j], 0) / n,
  );
  const ssItems = k * itemMeans.reduce((a, m) => a + (m - grand) ** 2, 0);
  const ssRaters = n * raterMeans.reduce((a, m) => a + (m - grand) ** 2, 0);
  let ssErr = 0;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < k; j++) ssErr += (ratings[i][j] - itemMeans[i] - raterMeans[j] + grand) ** 2;
  const msr = ssItems / (n - 1);
  const msc = ssRaters / (k - 1);
  const mse = ssErr / ((n - 1) * (k - 1));
  if (msr === 0 && mse === 0 && msc === 0) return { single: 1, average: 1 };
  const denomSingle = msr + (k - 1) * mse + ((k * (msc - mse)) / n);
  const denomAvg = msr + (msc - mse) / n;
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  return {
    single: denomSingle === 0 ? 1 : clamp((msr - mse) / denomSingle),
    average: denomAvg === 0 ? 1 : clamp((msr - mse) / denomAvg),
  };
}

export function meanPairwisePearson(columns: number[][]): number {
  if (columns.length < 2) return 1;
  let total = 0;
  let count = 0;
  for (let i = 0; i < columns.length; i++)
    for (let j = i + 1; j < columns.length; j++) {
      total += pearsonCorrelation(columns[i], columns[j]);
      count++;
    }
  return count ? total / count : 1;
}

export interface DimensionReliability {
  dimension: DebateEvalDimension;
  iccSingle: number;
  iccAverage: number;
  meanPairwisePearson: number;
  reliable: boolean;
}

export interface ReliabilityOptions {
  /** Minimum single-measure ICC for a dimension to pass the gate. */
  iccMin?: number;
  /** Alternate pass route via pairwise Pearson when ICC is borderline. */
  pairwisePearsonMin?: number;
}

export interface ReliabilityReport {
  measuredFirst: true;
  gatePassed: boolean;
  failingDimensions: DebateEvalDimension[];
  perDimension: DimensionReliability[];
}

function ratingColumns(corpus: EvalDebate[], dim: DebateEvalDimension): number[][] {
  const columns: number[][] = [];
  for (let r = 0; ; r++) {
    const col: number[] = [];
    let any = false;
    for (const d of corpus) {
      for (const side of ["a", "b"] as const) {
        const v = d.raters[r]?.[side]?.[dim];
        if (typeof v === "number") {
          col.push(v);
          any = true;
        }
      }
    }
    if (!any) break;
    columns.push(col);
  }
  return columns;
}

function matrixItemsByRaters(corpus: EvalDebate[], dim: DebateEvalDimension): number[][] {
  const rows: number[][] = [];
  for (const d of corpus) {
    for (const side of ["a", "b"] as const) {
      const row = d.raters.map((r) => r[side][dim]);
      if (row.every((v) => Number.isFinite(v)) && row.length >= 2) rows.push(row);
    }
  }
  return rows;
}

export function measureReliability(
  corpus: EvalDebate[],
  opts: ReliabilityOptions = {},
): ReliabilityReport {
  const iccMin = opts.iccMin ?? 0.75;
  const pearsonMin = opts.pairwisePearsonMin ?? 0.8;
  const perDimension: DimensionReliability[] = [];
  const failing: DebateEvalDimension[] = [];
  for (const dim of EVAL_DIMENSIONS) {
    const matrix = matrixItemsByRaters(corpus, dim);
    const icc = iccTwoWay(matrix);
    const cols = ratingColumns(corpus, dim);
    const mp = meanPairwisePearson(cols);
    const reliable = icc.single >= iccMin || mp >= pearsonMin;
    perDimension.push({ dimension: dim, iccSingle: icc.single, iccAverage: icc.average, meanPairwisePearson: mp, reliable });
    if (!reliable) failing.push(dim);
  }
  return { measuredFirst: true, gatePassed: failing.length === 0, failingDimensions: failing, perDimension };
}

// ---------------------------------------------------------------------------
// Aligned side-level view (the unit of comparison/calibration/bias analysis)
// ---------------------------------------------------------------------------

interface SideUnit {
  debateId: string;
  side: "a" | "b";
  human: SideScores;
  system: SideScores;
  text: string;
  words: number;
}

function buildUnits(corpus: EvalDebate[], system: SystemVerdict[]): SideUnit[] {
  const sysById = new Map(system.map((s) => [s.id, s]));
  const units: SideUnit[] = [];
  for (const d of corpus) {
    const sv = sysById.get(d.id);
    if (!sv) throw new Error(`no system verdict for debate ${d.id}`);
    const texts = extractSides(d.transcript);
    for (const side of ["a", "b"] as const) {
      const ratersWithSide = d.raters.filter((r) => r[side]);
      if (!ratersWithSide.length) continue;
      const human = {} as SideScores;
      for (const dim of EVAL_DIMENSIONS) {
        const vals = ratersWithSide.map((r) => clampScore(r[side][dim] ?? 3));
        human[dim] = vals.reduce((a, b) => a + b, 0) / vals.length;
      }
      const text = texts[side];
      units.push({
        debateId: d.id,
        side,
        human,
        system: sideScores(sv[side]),
        text,
        words: countWords(text),
      });
    }
  }
  return units;
}

// ---------------------------------------------------------------------------
// System vs human comparison (per dimension)
// ---------------------------------------------------------------------------

export interface DimensionComparison {
  dimension: DebateEvalDimension;
  pearson: number;
  spearman: number;
  mae: number;
}

export function compareSystemToHumans(units: SideUnit[]): DimensionComparison[] {
  return EVAL_DIMENSIONS.map((dim) => {
    const human = units.map((u) => u.human[dim]);
    const system = units.map((u) => u.system[dim]);
    const mae = human.reduce((acc, h, i) => acc + Math.abs(h - system[i]), 0) / units.length;
    return {
      dimension: dim,
      pearson: pearsonCorrelation(human, system),
      spearman: spearmanCorrelation(human, system),
      mae,
    };
  });
}

// ---------------------------------------------------------------------------
// Calibration: linear map system -> human scale, with leave-one-out MAE
// ---------------------------------------------------------------------------

export interface LinearCalibration {
  slope: number;
  intercept: number;
}

export function fitLinear(xs: number[], ys: number[]): LinearCalibration {
  const n = xs.length;
  if (n < 2) return { slope: 1, intercept: 0 };
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let varx = 0;
  for (let i = 0; i < n; i++) {
    cov += (xs[i] - mx) * (ys[i] - my);
    varx += (xs[i] - mx) ** 2;
  }
  if (varx === 0) return { slope: 1, intercept: my };
  const slope = cov / varx;
  return { slope, intercept: my - slope * mx };
}

export function applyLinear(c: LinearCalibration, x: number): number {
  return c.slope * x + c.intercept;
}

export function loocvMae(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return Number.NaN;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const trainX = xs.filter((_, j) => j !== i);
    const trainY = ys.filter((_, j) => j !== i);
    const c = fitLinear(trainX, trainY);
    total += Math.abs(applyLinear(c, xs[i]) - ys[i]);
  }
  return total / n;
}

export interface DimensionCalibration extends LinearCalibration {
  dimension: DebateEvalDimension;
  maeBefore: number;
  maeAfter: number;
  loocvMae: number;
}

export function calibrateDimension(human: number[], system: number[], dimension: DebateEvalDimension): DimensionCalibration {
  const c = fitLinear(system, human);
  const calibrated = system.map((s) => applyLinear(c, s));
  const maeBefore = human.reduce((acc, h, i) => acc + Math.abs(h - system[i]), 0) / human.length;
  const maeAfter = human.reduce((acc, h, i) => acc + Math.abs(h - calibrated[i]), 0) / human.length;
  return { dimension, ...c, maeBefore, maeAfter, loocvMae: loocvMae(system, human) };
}

// ---------------------------------------------------------------------------
// Bias detection: residual partial correlations controlling for human scores
// ---------------------------------------------------------------------------

/** corr(x, y | z) via residuals of x~z and y~z. */
export function partialCorrelation(x: number[], y: number[], z: number[]): number {
  const resid = (target: number[], given: number[]): number[] => {
    const c = fitLinear(given, target);
    return target.map((t, i) => t - applyLinear(c, given[i]));
  };
  return pearsonCorrelation(resid(x, z), resid(y, z));
}

export interface BiasFeatureResult {
  feature: string;
  partialR: number;
  detected: boolean;
}

export interface VerbosityBiasReport {
  pooledPartialR: number;
  detected: boolean;
  perDimension: Array<{ dimension: DebateEvalDimension; partialR: number }>;
}

export interface StyleBiasReport {
  features: BiasFeatureResult[];
  detected: boolean;
}

export interface BiasThresholds {
  verbosity?: number;
  style?: number;
}

export function detectVerbosityBias(
  corpus: EvalDebate[],
  system: SystemVerdict[],
  thresholds: BiasThresholds = {},
): VerbosityBiasReport {
  const t = thresholds.verbosity ?? 0.3;
  const units = buildUnits(corpus, system);
  const humanOverall = units.map((u) => meanSideScore(u.human));
  const sysOverall = units.map((u) => meanSideScore(u.system));
  const words = units.map((u) => u.words);
  const pooled = partialCorrelation(sysOverall, words, humanOverall);
  const perDimension = EVAL_DIMENSIONS.map((dim) => ({
    dimension: dim,
    partialR: partialCorrelation(
      units.map((u) => u.system[dim]),
      words,
      units.map((u) => u.human[dim]),
    ),
  }));
  return { pooledPartialR: pooled, detected: Math.abs(pooled) >= t, perDimension };
}

export function detectStyleBias(
  corpus: EvalDebate[],
  system: SystemVerdict[],
  thresholds: BiasThresholds = {},
): StyleBiasReport {
  const t = thresholds.style ?? 0.3;
  const units = buildUnits(corpus, system);
  const humanOverall = units.map((u) => meanSideScore(u.human));
  const sysOverall = units.map((u) => meanSideScore(u.system));
  const features = STYLE_FEATURE_NAMES.map((name) => {
    const vals = units.map((u) => styleFeatures(u.text)[name]);
    const pr = partialCorrelation(sysOverall, vals, humanOverall);
    return { feature: name, partialR: pr, detected: Math.abs(pr) >= t };
  });
  return { features, detected: features.some((f) => f.detected) };
}

// ---------------------------------------------------------------------------
// Orchestrator — reliability FIRST, then comparison, calibration, bias
// ---------------------------------------------------------------------------

export interface DailyDebateEvalOptions extends ReliabilityOptions, BiasThresholds {}

export interface DailyDebateEvalReport {
  order: ["reliability", "comparison", "calibration", "bias"];
  debates: number;
  sides: number;
  usable: boolean;
  reliability: ReliabilityReport;
  comparison: DimensionComparison[];
  calibration: DimensionCalibration[];
  bias: { verbosity: VerbosityBiasReport; style: StyleBiasReport };
  notes: string[];
}

export function dailyDebateEvaluation(
  corpus: EvalDebate[],
  system: SystemVerdict[],
  opts: DailyDebateEvalOptions = {},
): DailyDebateEvalReport {
  if (!corpus.length || !system.length) throw new Error("corpus and system verdicts must be non-empty");
  const reliability = measureReliability(corpus, opts);
  const units = buildUnits(corpus, system);
  const comparison = compareSystemToHumans(units);
  const calibration = EVAL_DIMENSIONS.map((dim) =>
    calibrateDimension(
      units.map((u) => u.human[dim]),
      units.map((u) => u.system[dim]),
      dim,
    ),
  );
  const bias = {
    verbosity: detectVerbosityBias(corpus, system, opts),
    style: detectStyleBias(corpus, system, opts),
  };
  const notes: string[] = [];
  if (!reliability.gatePassed) {
    notes.push(
      `Inter-rater reliability below threshold on: ${reliability.failingDimensions.join(", ")}. ` +
        "Comparison, calibration and bias results are unreliable until labels stabilise — add raters or tighten the rubric.",
    );
  }
  const worstMae = [...calibration].sort((a, b) => b.maeAfter - a.maeAfter)[0];
  notes.push(`Largest post-calibration MAE: ${worstMae.dimension} (${worstMae.maeAfter.toFixed(2)} on a 1..5 scale).`);
  if (bias.verbosity.detected) notes.push("Verbosity bias detected beyond human-score control.");
  if (bias.style.detected) notes.push("Writing-style bias detected beyond human-score control.");
  return {
    order: ["reliability", "comparison", "calibration", "bias"],
    debates: corpus.length,
    sides: units.length,
    usable: reliability.gatePassed,
    reliability,
    comparison,
    calibration,
    bias,
    notes,
  };
}
