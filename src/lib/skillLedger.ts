// Longitudinal skill ledger — turns scored debates into a per-user metric
// trajectory so improvement claims become measurable ("rebuttal coverage
// 54% -> 78% after N debates") instead of anecdotal.
//
// Every metric derives deterministically from the stored observable
// assessment (same inputs the judge/scorer sees): no model opinion, no
// self-report. Pure functions throughout — the API route only fetches rows.

import type { ArgGraph } from "./argGraph";
import type { ObservableAssessment } from "./observableAssessment";
import { graphFromTurn, mergeAssessmentGraphs, assessArgumentGraph } from "./observableAssessment";
import { fitLinear } from "./debateEvaluation";
import { scoreRebuttalQuality } from "./argumentEvaluation";
import { validateGraph } from "./argGraph";
import { isKnownSource } from "./citationVerifier";

export type MetricKey =
  | "unsupportedClaimRate"
  | "rebuttalCoverage"
  | "evidenceGrounding"
  | "droppedArguments"
  | "contradictions"
  | "impactHandling"
  | "steelmanQuality"
  | "fallacyRate"
  | "causalOverclaims"
  | "fakePrecisionHits"
  | "uncitedEvidenceRate"
  | "clarity";

export const METRIC_KEYS: MetricKey[] = [
  "unsupportedClaimRate",
  "rebuttalCoverage",
  "evidenceGrounding",
  "droppedArguments",
  "contradictions",
  "impactHandling",
  "steelmanQuality",
  "fallacyRate",
  "causalOverclaims",
  "fakePrecisionHits",
  "uncitedEvidenceRate",
  "clarity",
];

/** true = higher is better. Counts (dropped/contradictions/overclaims/hits/rates-of-bad) are lower-better. */
export const HIGHER_IS_BETTER: Record<MetricKey, boolean> = {
  unsupportedClaimRate: false,
  rebuttalCoverage: true,
  evidenceGrounding: true,
  droppedArguments: false,
  contradictions: false,
  impactHandling: true,
  steelmanQuality: true,
  fallacyRate: false,
  causalOverclaims: false,
  fakePrecisionHits: false,
  uncitedEvidenceRate: false,
  clarity: true,
};

export const METRIC_LABELS: Record<MetricKey, string> = {
  unsupportedClaimRate: "Unsupported claims per claim",
  rebuttalCoverage: "Rebuttal coverage",
  evidenceGrounding: "Evidence grounding",
  droppedArguments: "Dropped arguments",
  contradictions: "Self-contradictions",
  impactHandling: "Impact handling",
  steelmanQuality: "Steelmanning",
  fallacyRate: "Fallacy frequency",
  causalOverclaims: "Causal overclaims",
  fakePrecisionHits: "Fake-precision figures",
  uncitedEvidenceRate: "Cited evidence lacking citations",
  clarity: "Clarity (turn projection)",
};

export interface SkillMetricPoint {
  debateId: string;
  completedAt: string;
  metrics: Record<MetricKey, number | null>;
}

function round3(v: number | null): number | null {
  return v === null ? null : Math.round(v * 1000) / 1000;
}

/**
 * Extract one ledger point from a debate's merged observable assessment.
 * `owner` selects the user's side; `clarity` may be supplied from turn-level
 * display scores when available.
 */
export function extractSkillPoint(
  debateId: string,
  completedAt: string,
  assessment: ObservableAssessment,
  owner: ArgGraph["nodes"][number]["owner"] = "a",
  clarity10?: number | null,
): SkillMetricPoint {
  const g: ArgGraph = assessment.graph;
  const substantive = g.nodes.filter((n) => n.kind === "claim" || n.kind === "counterclaim" || n.kind === "impact");
  const mine = substantive.filter((n) => n.owner === owner);
  const myIds = new Set(mine.map((n) => n.id));

  const unsupported = g.evidenceStats.unsupportedClaimIds.length;
  const claimsMade = substantive.length;
  const rbq = scoreRebuttalQuality(g, owner);
  const issues = validateGraph(g);
  const citationIssues = issues.filter((i) => /no citation/i.test(i)).length;
  // Grounding = share of cited/strong evidence nodes whose citations name a
  // real, allowlisted institution (MyBlog does not ground a claim).
  const citedStrength = g.nodes.filter(
    (n) => n.kind === "evidence" && (n.evidenceStrength === "cited" || n.evidenceStrength === "strong"),
  );
  const grounded = citedStrength.filter((n) => (n.citations ?? []).some((c) => isKnownSource(c.sourceName))).length;

  // Engine reports are keyed a/b; solo debates run the AI as side B ("ai"),
  // so the user's engine column is always "a" here.
  const engineSide = assessment.engine?.a;

  const impactValue =
    assessment.impactComparison && typeof assessment.impactComparison.value === "object"
      ? ((assessment.impactComparison.value as unknown as Record<string, number | null>)[owner] ?? null)
      : null;

  const metrics: Record<MetricKey, number | null> = {
    unsupportedClaimRate: round3(claimsMade > 0 ? Math.min(1, unsupported / claimsMade) : null),
    rebuttalCoverage: rbq ? round3(rbq.coverage) : null,
    evidenceGrounding: round3(citedStrength.length ? grounded / citedStrength.length : null),
    droppedArguments: g.dropped.filter((d) => d.owner === owner).length,
    contradictions: g.contradictions.filter((c) => c.owner === owner).length,
    impactHandling:
      impactValue === null || impactValue === undefined ? null : round3(Math.max(0, Math.min(1, impactValue))),
    steelmanQuality: engineSide?.steelmanQuality ? round3(engineSide.steelmanQuality.score) : null,
    fallacyRate: round3(
      substantive.length ? g.fallacies.filter((f) => myIds.has(f.nodeId)).length / Math.max(1, mine.length) : null,
    ),
    causalOverclaims: engineSide?.causalOverclaims ?? null,
    fakePrecisionHits: engineSide?.unsourcedPrecisionHits ?? null,
    uncitedEvidenceRate: round3(citedStrength.length ? Math.min(1, citationIssues / citedStrength.length) : null),
    clarity: clarity10 != null ? round3(Math.max(0, Math.min(1, clarity10 / 10))) : null,
  };
  return { debateId, completedAt, metrics };
}

export interface MetricTrajectory {
  metric: MetricKey;
  n: number;
  first: number | null;
  last: number | null;
  /** last-window minus first-window (signed by raw value; see HIGHER_IS_BETTER) */
  delta: number | null;
  /** least-squares slope per debate index */
  slopePerDebate: number | null;
  /** delta in "goodness" terms (positive = improved) */
  goodnessDelta: number | null;
  improved: boolean | null;
  series: Array<{ at: string; value: number | null }>;
}

const WINDOW = 5;

export function trajectoryFor(points: SkillMetricPoint[], metric: MetricKey): MetricTrajectory {
  const series = points.map((p) => ({ at: p.completedAt, value: p.metrics[metric] }));
  if (points.length < 2) {
    return { metric, n: points.length, first: null, last: null, delta: null, slopePerDebate: null, goodnessDelta: null, improved: null, series };
  }
  const w = Math.min(WINDOW, Math.floor(points.length / 2));
  const head = points.slice(0, w).map((p) => p.metrics[metric]).filter((v): v is number => v !== null);
  const tail = points.slice(-w).map((p) => p.metrics[metric]).filter((v): v is number => v !== null);
  const first = head.length ? +(head.reduce((s, v) => s + v, 0) / head.length).toFixed(3) : null;
  const last = tail.length ? +(tail.reduce((s, v) => s + v, 0) / tail.length).toFixed(3) : null;
  const delta = first !== null && last !== null ? +(last - first).toFixed(3) : null;
  const good = delta === null ? null : +(delta * (HIGHER_IS_BETTER[metric] ? 1 : -1)).toFixed(3);

  const paired = points.map((p, i) => ({ i, v: p.metrics[metric] })).filter((x): x is { i: number; v: number } => x.v !== null);
  let slope: number | null = null;
  if (paired.length >= 3) {
    const fit = fitLinear(paired.map((p) => p.i), paired.map((p) => p.v));
    slope = +(fit.slope * (HIGHER_IS_BETTER[metric] ? 1 : -1)).toFixed(4); // goodness slope
  }

  return {
    metric,
    n: points.length,
    first,
    last,
    delta,
    slopePerDebate: slope,
    goodnessDelta: good,
    improved: good === null ? null : good > 0.02,
    series,
  };
}

export interface SkillLedger {
  debates: number;
  trajectories: Record<MetricKey, MetricTrajectory>;
  /** Metrics with a positive, above-noise goodness delta. */
  improvements: MetricKey[];
  regressions: MetricKey[];
  /** Fixed deterministic reference opponent, derived once from a canonical debate. */
  benchmarkBaseline: SkillMetricPoint["metrics"] | null;
  versusBaseline: Partial<Record<MetricKey, number | null>>;
  minimumForClaims: number;
}

let baselineCache: SkillMetricPoint["metrics"] | null = null;

/** Deterministic reference opponent: a canonical balanced debate, scored by the same pipeline. */
export function getBenchmarkBaseline(): SkillMetricPoint["metrics"] {
  if (baselineCache) return baselineCache;
  const rounds = [
    { u: "Small classes raise outcomes per Tennessee STAR.", o: "STAR gains faded and scaling lowers teacher quality." },
    { u: "Pew polling shows parents prefer smaller classes.", o: "Brookings finds tutoring outperforms per dollar." },
  ];
  const graphs = rounds.map((r, i) =>
    graphFromTurn({ userMessage: r.u, opponentMessage: r.o, round: i + 1 }),
  );
  const assessment = assessArgumentGraph(mergeAssessmentGraphs(graphs), {
    sideA: "a",
    sideB: "b",
    extractionSource: "deterministic",
    labelA: "Benchmark",
    labelB: "Opponent",
  });
  baselineCache = extractSkillPoint("benchmark", "", assessment, "a").metrics;
  return baselineCache;
}

export function buildSkillLedger(
  points: SkillMetricPoint[],
  opts: { minimumForClaims?: number; includeBaseline?: boolean } = {},
): SkillLedger {
  const minimumForClaims = opts.minimumForClaims ?? 10;
  const trajectories = Object.fromEntries(METRIC_KEYS.map((k) => [k, trajectoryFor(points, k)])) as Record<
    MetricKey,
    MetricTrajectory
  >;
  const improvements = METRIC_KEYS.filter((k) => trajectories[k].improved === true);
  const regressions = METRIC_KEYS.filter((k) => trajectories[k].improved === false);

  let benchmarkBaseline: SkillMetricPoint["metrics"] | null = null;
  let versusBaseline: Partial<Record<MetricKey, number | null>> = {};
  if (opts.includeBaseline !== false && points.length) {
    try {
      benchmarkBaseline = getBenchmarkBaseline();
      versusBaseline = Object.fromEntries(
        METRIC_KEYS.map((k) => {
          const mine = points[points.length - 1].metrics[k];
          const base = benchmarkBaseline?.[k];
          if (mine === null || base === null || mine === undefined || base === undefined) return [k, null];
          const d = +(mine - base).toFixed(3);
          return [k, HIGHER_IS_BETTER[k] ? d : -d]; // positive = better than benchmark
        }),
      );
    } catch {
      benchmarkBaseline = null;
    }
  }

  return { debates: points.length, trajectories, improvements, regressions, benchmarkBaseline, versusBaseline, minimumForClaims };
}
