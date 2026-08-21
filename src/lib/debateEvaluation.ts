// Daily Debate Evaluation — human-rated debate corpus pipeline.
// Six-dimension rubric scored per side (A/B) by multiple human raters;
// inter-rater reliability is measured FIRST and gates everything downstream.
// Then: system-vs-human comparison, score calibration, verbosity bias and
// writing-style bias detection. Pure, offline, no model calls.

import { pearsonCorrelation, spearmanCorrelation } from "./humanCorpus";

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
