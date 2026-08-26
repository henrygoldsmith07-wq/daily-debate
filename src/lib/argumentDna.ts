// Longitudinal Argument DNA model.
//
// The data here is intentionally derived from the same observable graph and
// skill-ledger metrics used by the judge. The UI can therefore explain a
// pattern without inventing a personality diagnosis or relying on a second
// scoring system.

import type { ArgGraph, ArgNode, Owner } from "./argGraph";
import { computeSkillProfile, PROFILE_DIMENSIONS, type ArgumentSkillProfile, type ProfileDimensionKey } from "./skillProfile";
import {
  buildSkillLedger,
  HIGHER_IS_BETTER,
  METRIC_KEYS,
  METRIC_LABELS,
  type MetricKey,
  type MetricTrajectory,
  type SkillLedger,
  type SkillMetricPoint,
} from "./skillLedger";

export type DebateFormat = "solo" | "pvp";

export interface DnaGraphStats {
  claims: number;
  evidence: number;
  counterclaims: number;
  rebuttals: number;
  impacts: number;
  unsupportedClaims: number;
  droppedArguments: number;
  contradictions: number;
  concessions: number;
  fallacies: number;
  citedEvidence: number;
}

export interface DnaDebateSnapshot {
  id: string;
  completedAt: string;
  topicTitle: string;
  format: DebateFormat;
  score: number | null;
  owner: Owner;
  rounds: number;
  graph: ArgGraph | null;
  metrics: SkillMetricPoint["metrics"];
  analysed: boolean;
  graphStats: DnaGraphStats;
}

export interface DnaPeriodSummary {
  key: string;
  debates: number;
  analysedDebates: number;
  score: number | null;
  graphStats: DnaGraphStats;
  firstSnapshotId: string;
  lastSnapshotId: string;
}

export type InsightTone = "positive" | "attention" | "neutral";

export interface ArgumentDnaInsight {
  id: string;
  tone: InsightTone;
  label: string;
  title: string;
  body: string;
  evidence: string;
  metric?: MetricKey;
  direction: "up" | "down" | "steady";
}

export interface DnaDimensionChange {
  key: ProfileDimensionKey;
  label: string;
  first: number | null;
  latest: number | null;
  delta: number | null;
}

export interface ArgumentDnaModel {
  snapshots: DnaDebateSnapshot[];
  points: SkillMetricPoint[];
  totalDebates: number;
  analysedDebates: number;
  profile: ArgumentSkillProfile;
  periods: DnaPeriodSummary[];
  insights: ArgumentDnaInsight[];
  ledger: Pick<SkillLedger, "trajectories" | "improvements" | "regressions" | "minimumForClaims">;
  comparison: {
    first: DnaDebateSnapshot | null;
    latest: DnaDebateSnapshot | null;
    dimensions: DnaDimensionChange[];
  };
}

export const EMPTY_DNA_METRICS: SkillMetricPoint["metrics"] = Object.fromEntries(
  METRIC_KEYS.map((key) => [key, null]),
) as SkillMetricPoint["metrics"];

const EMPTY_GRAPH_STATS: DnaGraphStats = {
  claims: 0,
  evidence: 0,
  counterclaims: 0,
  rebuttals: 0,
  impacts: 0,
  unsupportedClaims: 0,
  droppedArguments: 0,
  contradictions: 0,
  concessions: 0,
  fallacies: 0,
  citedEvidence: 0,
};

function blankStats(): DnaGraphStats {
  return { ...EMPTY_GRAPH_STATS };
}

function average(values: Array<number | null | undefined>): number | null {
  const numeric = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return numeric.length ? numeric.reduce((sum, value) => sum + value, 0) / numeric.length : null;
}

function round(value: number | null, digits = 3): number | null {
  return value === null ? null : Number(value.toFixed(digits));
}

function pointFor(snapshot: DnaDebateSnapshot): SkillMetricPoint {
  return {
    debateId: snapshot.id,
    completedAt: snapshot.completedAt,
    metrics: snapshot.metrics,
  };
}

function ownedNodes(graph: ArgGraph, owner: Owner): ArgNode[] {
  return graph.nodes.filter((node) => node.owner === owner);
}

export function graphStatsFor(graph: ArgGraph | null, owner: Owner = "a"): DnaGraphStats {
  if (!graph) return blankStats();
  const mine = ownedNodes(graph, owner);
  const myIds = new Set(mine.map((node) => node.id));
  const evidence = mine.filter((node) => node.kind === "evidence");

  return {
    claims: mine.filter((node) => node.kind === "claim").length,
    evidence: evidence.length,
    counterclaims: mine.filter((node) => node.kind === "counterclaim").length,
    rebuttals: mine.filter((node) => node.kind === "rebuttal").length,
    impacts: mine.filter((node) => node.kind === "impact").length,
    unsupportedClaims: graph.evidenceStats.unsupportedClaimIds.filter((id) => myIds.has(id)).length,
    droppedArguments: graph.dropped.filter((item) => item.owner === owner).length,
    contradictions: graph.contradictions.filter((item) => item.owner === owner).length,
    concessions: graph.concessions.filter((item) => item.by === owner).length,
    fallacies: graph.fallacies.filter((item) => myIds.has(item.nodeId) && item.fallacy !== "none").length,
    citedEvidence: evidence.filter((node) => (node.citations?.length ?? 0) > 0).length,
  };
}

function mergeStats(target: DnaGraphStats, source: DnaGraphStats): void {
  for (const key of Object.keys(EMPTY_GRAPH_STATS) as Array<keyof DnaGraphStats>) {
    target[key] += source[key];
  }
}

function monthKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function buildPeriods(snapshots: DnaDebateSnapshot[]): DnaPeriodSummary[] {
  const groups = new Map<string, DnaDebateSnapshot[]>();
  for (const snapshot of snapshots) {
    const key = monthKey(snapshot.completedAt);
    const group = groups.get(key) ?? [];
    group.push(snapshot);
    groups.set(key, group);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, group]) => {
      const graphStats = blankStats();
      group.forEach((snapshot) => mergeStats(graphStats, snapshot.graphStats));
      return {
        key,
        debates: group.length,
        analysedDebates: group.filter((snapshot) => snapshot.analysed).length,
        score: round(average(group.map((snapshot) => snapshot.score)), 1),
        graphStats,
        firstSnapshotId: group[0].id,
        lastSnapshotId: group[group.length - 1].id,
      };
    });
}

function windowAverage(points: SkillMetricPoint[], metric: MetricKey, fromEnd: boolean): number | null {
  if (!points.length) return null;
  const width = Math.min(5, Math.max(1, Math.floor(points.length / 2)));
  const source = fromEnd ? points.slice(-width) : points.slice(0, width);
  return round(average(source.map((point) => point.metrics[metric])));
}

function pct(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function count(value: number | null): string {
  return value === null ? "—" : String(Math.round(value));
}

function trajectoryDirection(trajectory: MetricTrajectory | undefined): "up" | "down" | "steady" {
  if (!trajectory?.goodnessDelta) return "steady";
  return trajectory.goodnessDelta > 0.02 ? "up" : trajectory.goodnessDelta < -0.02 ? "down" : "steady";
}

function insight(
  id: string,
  tone: InsightTone,
  label: string,
  title: string,
  body: string,
  evidence: string,
  direction: "up" | "down" | "steady",
  metric?: MetricKey,
): ArgumentDnaInsight {
  return { id, tone, label, title, body, evidence, direction, metric };
}

function buildInsights(points: SkillMetricPoint[], ledger: SkillLedger): ArgumentDnaInsight[] {
  if (!points.length) {
    return [
      insight(
        "baseline",
        "neutral",
        "Baseline",
        "Your first debate will give the profile a shape",
        "Complete a debate and the graph will start tracking which claims hold, which points get answered, and what changes under pressure.",
        "No completed, graph-scored debates yet",
        "steady",
      ),
    ];
  }

  if (points.length < 3) {
    return [
      insight(
        "early-signal",
        "neutral",
        "Early signal",
        "Collect a few more debates before calling it a pattern",
        "The first read is useful as a baseline, but the profile stays deliberately cautious until it has enough repetitions to separate a habit from a one-off.",
        `${points.length} graph-scored debate${points.length === 1 ? "" : "s"} · reliable patterns start at ${ledger.minimumForClaims}`,
        "steady",
      ),
    ];
  }

  const trajectories = ledger.trajectories;
  const unsupported = windowAverage(points, "unsupportedClaimRate", true);
  const causal = windowAverage(points, "causalOverclaims", true);
  const rebuttal = windowAverage(points, "rebuttalCoverage", true);
  const impact = windowAverage(points, "impactHandling", true);
  const dropped = windowAverage(points, "droppedArguments", true);
  const contradictions = windowAverage(points, "contradictions", true);
  const evidence = windowAverage(points, "evidenceGrounding", true);
  const clarity = windowAverage(points, "clarity", true);
  const result: ArgumentDnaInsight[] = [];

  if ((unsupported ?? 0) > 0.3 || (causal ?? 0) > 0) {
    result.push(
      insight(
        "causal-bridge",
        "attention",
        "Causal bridge",
        "Your claim lands before the bridge",
        "You often make strong initial claims but leave the causal bridge unstated. Add one explicit because → therefore step before moving to impact.",
        `${pct(unsupported)} of recent claims were marked unsupported${causal && causal > 0 ? ` · ${count(causal)} causal overclaim signal${causal === 1 ? "" : "s"}` : ""}`,
        trajectoryDirection(trajectories.unsupportedClaimRate),
        "unsupportedClaimRate",
      ),
    );
  } else if ((trajectories.evidenceGrounding?.goodnessDelta ?? 0) > 0.02) {
    result.push(
      insight(
        "evidence-carry",
        "positive",
        "Evidence",
        "Your evidence is carrying more of the argument",
        "Recent claims are more consistently attached to grounded sources, so the bridge from assertion to support is becoming easier to follow.",
        `Grounding is ${pct(evidence)} in the latest window · ${METRIC_LABELS.evidenceGrounding} is trending up`,
        "up",
        "evidenceGrounding",
      ),
    );
  }

  if ((rebuttal ?? 0) > (impact ?? 0) + 0.18 && impact !== null) {
    result.push(
      insight(
        "fact-value-split",
        "attention",
        "Rebuttal shape",
        "You answer facts more reliably than values",
        "Your rebuttals tend to meet factual claims head-on, while value and consequence framing gets less direct attention. Name the principle you disagree with, then answer it.",
        `Rebuttal coverage ${pct(rebuttal)} vs impact handling ${pct(impact)}`,
        trajectoryDirection(trajectories.impactHandling),
        "impactHandling",
      ),
    );
  }

  if ((dropped ?? 0) > 0.8 || (trajectories.droppedArguments?.goodnessDelta ?? 0) < -0.02) {
    result.push(
      insight(
        "pressure-shift",
        "attention",
        "Under pressure",
        "You introduce new claims instead of defending the original one",
        "When a line is challenged, the graph shows more new claims than closed rebuttal loops. Restate the original claim, answer the strongest objection, and only then widen the case.",
        `${count(dropped)} dropped argument${dropped === 1 ? "" : "s"} per recent debate on average`,
        trajectoryDirection(trajectories.droppedArguments),
        "droppedArguments",
      ),
    );
  }

  if ((contradictions ?? 0) > 0 || (trajectories.contradictions?.goodnessDelta ?? 0) < -0.02) {
    result.push(
      insight(
        "consistency",
        "attention",
        "Consistency",
        "Your position shifts before the graph catches up",
        "A few claims pull against each other across rounds. Mark the concession or narrow the claim so the reader can see what still holds.",
        `${count(contradictions)} self-contradiction signal${contradictions === 1 ? "" : "s"} per recent debate on average`,
        trajectoryDirection(trajectories.contradictions),
        "contradictions",
      ),
    );
  }

  if (clarity !== null && (trajectories.clarity?.goodnessDelta ?? 0) > 0.02) {
    result.push(
      insight(
        "clearer-delivery",
        "positive",
        "Delivery",
        "Your through-line is getting easier to follow",
        "Recent turns project a clearer claim → support → response sequence. Keep the same structure when the topic gets unfamiliar.",
        `Clarity is ${pct(clarity)} in the latest window`,
        "up",
        "clarity",
      ),
    );
  }

  const strongest = METRIC_KEYS
    .map((metric) => ({ metric, trajectory: trajectories[metric] }))
    .filter(({ trajectory }) => (trajectory?.goodnessDelta ?? 0) > 0.02)
    .sort((a, b) => (b.trajectory.goodnessDelta ?? 0) - (a.trajectory.goodnessDelta ?? 0))[0];

  if (strongest && result.length < 3) {
    const t = strongest.trajectory;
    result.push(
      insight(
        "growth-edge",
        "positive",
        "Getting stronger",
        `${METRIC_LABELS[strongest.metric]} is moving in the right direction`,
        `The latest window is stronger than your baseline on ${METRIC_LABELS[strongest.metric].toLowerCase()}. Keep the move visible in the next debate so it becomes a repeatable habit.`,
        `${pct(t.first)} → ${pct(t.last)} across the measured windows`,
        "up",
        strongest.metric,
      ),
    );
  }

  if (!result.length) {
    result.push(
      insight(
        "steady-profile",
        "neutral",
        "Stable read",
        "Your profile is holding steady",
        "No metric has moved far enough to call a durable shift yet. Use the graph comparison below to choose one move to make explicit in the next round.",
        `${points.length} graph-scored debates · changes below the noise threshold`,
        "steady",
      ),
    );
  }

  return result.slice(0, 4);
}

function profileChange(points: SkillMetricPoint[]): DnaDimensionChange[] {
  if (!points.length) {
    return PROFILE_DIMENSIONS.map(({ key, label }) => ({ key, label, first: null, latest: null, delta: null }));
  }
  const width = Math.min(5, Math.max(1, Math.floor(points.length / 2)));
  const first = computeSkillProfile(points.slice(0, width));
  const latest = computeSkillProfile(points.slice(-width));
  return PROFILE_DIMENSIONS.map(({ key, label }) => {
    const a = first.dimensions.find((dimension) => dimension.key === key)?.score ?? null;
    const b = latest.dimensions.find((dimension) => dimension.key === key)?.score ?? null;
    return { key, label, first: a, latest: b, delta: a !== null && b !== null ? b - a : null };
  });
}

export function buildArgumentDna(input: DnaDebateSnapshot[]): ArgumentDnaModel {
  const snapshots = [...input].sort((a, b) => a.completedAt.localeCompare(b.completedAt));
  const points = snapshots.filter((snapshot) => snapshot.analysed).map(pointFor);
  const ledger = buildSkillLedger(points, { includeBaseline: false, minimumForClaims: 3 });
  const profile = computeSkillProfile(points);
  const first = snapshots[0] ?? null;
  const latest = snapshots[snapshots.length - 1] ?? null;

  return {
    snapshots,
    points,
    totalDebates: snapshots.length,
    analysedDebates: points.length,
    profile,
    periods: buildPeriods(snapshots),
    insights: buildInsights(points, ledger),
    ledger: {
      trajectories: ledger.trajectories,
      improvements: ledger.improvements,
      regressions: ledger.regressions,
      minimumForClaims: ledger.minimumForClaims,
    },
    comparison: {
      first,
      latest,
      dimensions: profileChange(points),
    },
  };
}

export function isMetricImproving(metric: MetricKey, delta: number | null): boolean {
  if (delta === null) return false;
  return HIGHER_IS_BETTER[metric] ? delta > 0 : delta < 0;
}
