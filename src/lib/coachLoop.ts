// Learning-loop lifecycle tracker.
//
// For each coached weakness, tracks how far it has progressed:
//   detected → practised → improved in drill → improved in a later full debate → retained
//
// Pure — consumes ledger points + drill assignment rows, produces stage data.

import type { MetricKey } from "./skillLedger";
import { HIGHER_IS_BETTER } from "./skillLedger";

export type LoopStage =
  | "detected"                // weakness identified in a debate assessment
  | "practised"              // drill assigned and attempt submitted
  | "improved_in_drill"      // drill attempt scored above before-score
  | "improved_in_debate"     // next full debate shows improvement on this dimension
  | "retained";              // improvement persisted across 2+ subsequent debates

export interface DrillAssignmentLite {
  id: string;
  dimension: string;
  assignedDate: string;
  createdAt: string;
  minutes?: number;
  beforeScore: number | null;
  attemptText: string | null;
  attemptScore: number | null;
  movement: number | null;
  status: string; // 'open' | 'attempted'
}

export interface DimensionTimelinePoint {
  completedAt: string;
  /** goodness-normalised value (higher = better) */
  value: number;
}

export interface LoopStatus {
  dimension: string;
  label: string;
  stage: LoopStage;
  /** Human-readable explanation of what happened */
  summary: string;
  drillId: string | null;
  drillAssignedAt: string | null;
  drillAttemptScore: number | null;
  /** Skill movement observed in subsequent debates (null = not yet measurable) */
  debateMovement: number | null;
  /** Whether improvement persisted across ≥2 subsequent debates */
  retained: boolean | null;
}

const DIMENSION_LABELS: Record<string, string> = {
  evidence: "Evidence",
  rebuttal: "Rebuttal",
  logic: "Logic",
  clarity: "Clarity",
  impact: "Impact",
  steelmanning: "Steelmanning",
  structure: "Structure",
};

/** Map coach dimension → ledger metric key for trajectory lookup. */
const DIMENSION_METRIC: Record<string, MetricKey> = {
  evidence: "evidenceGrounding",
  rebuttal: "rebuttalCoverage",
  logic: "fallacyRate",
  clarity: "clarity",
  impact: "impactHandling",
  steelmanning: "steelmanQuality",
  structure: "droppedArguments",
};

function goodness(value: number | null, metric: MetricKey): number | null {
  if (value === null) return null;
  return HIGHER_IS_BETTER[metric] ? value : 1 - value;
}

/**
 * Extract dimension-specific timeline points from ledger points.
 * Returns goodness-normalised values sorted chronologically.
 */
export function dimensionTimeline(
  points: Array<{ completedAt: string; metrics: Record<string, number | null> }>,
  dimension: string,
): DimensionTimelinePoint[] {
  const metric = DIMENSION_METRIC[dimension];
  if (!metric) return [];
  return points
    .map((p) => ({
      completedAt: p.completedAt,
      value: goodness(p.metrics[metric], metric),
    }))
    .filter((p): p is { completedAt: string; value: number } => p.value !== null)
    .sort((a, b) => a.completedAt.localeCompare(b.completedAt));
}

/**
 * Measure whether the dimension improved after the drill assignment date.
 * Compares mean of `window` debates before vs `window` after.
 */
export function measureDebateImprovement(
  timeline: DimensionTimelinePoint[],
  assignedAtIso: string,
  window = 2,
): { improved: boolean | null; delta: number | null } {
  const idx = timeline.findIndex((p) => p.completedAt >= assignedAtIso);
  if (idx === -1 || timeline.length < 2) return { improved: null, delta: null };
  const beforeSlice = timeline.slice(Math.max(0, idx - window), idx);
  const afterSlice = timeline.slice(idx, idx + window);
  // If no post-drill debates exist yet, can't measure
  if (!afterSlice.length || !beforeSlice.length) return { improved: null, delta: null };
  const before = beforeSlice.reduce((s, p) => s + p.value, 0) / beforeSlice.length;
  const after = afterSlice.reduce((s, p) => s + p.value, 0) / afterSlice.length;
  const delta = Math.round((after - before) * 1000) / 1000;
  return { improved: delta > 0.02, delta };
}

/**
 * Check whether the improvement persisted across ≥2 subsequent measurement
 * windows AFTER the initial improvement was detected. This distinguishes a
 * one-off spike from genuine skill acquisition.
 */
export function checkRetention(
  timeline: DimensionTimelinePoint[],
  assignedAtIso: string,
  initialWindow = 2,
  retentionWindow = 2,
): boolean | null {
  const idx = timeline.findIndex((p) => p.completedAt >= assignedAtIso);
  if (idx === -1) return null;
  const afterDrill = timeline.slice(idx + initialWindow); // skip the immediate-improvement window
  if (afterDrill.length < retentionWindow) return null;
  const preDrill = timeline.slice(Math.max(0, idx - initialWindow), idx);
  if (!preDrill.length) return null;
  const preVal = preDrill.reduce((s, p) => s + p.value, 0) / preDrill.length;
  const retVal = afterDrill.length
    ? afterDrill[afterDrill.length - 1].value // last value: is the skill still at improved level NOW?
    : null;
  if (retVal === null) return null;
  return retVal > preVal; // still better than pre-drill baseline
}

// --- main loop computation ---------------------------------------------------

/**
 * Compute the learning-loop status for each coached dimension.
 * This is THE function that closes the loop between detection and proof.
 */
export function computeLoopStatuses(
  points: Array<{ completedAt: string; metrics: Record<string, number | null> }>,
  assignments: DrillAssignmentLite[],
): LoopStatus[] {
  // Group assignments by dimension, keep most recent per dimension
  const byDim = new Map<string, DrillAssignmentLite>();
  for (const a of assignments) {
    const existing = byDim.get(a.dimension);
    if (!existing || a.createdAt > existing.createdAt) byDim.set(a.dimension, a);
  }

  const statuses: LoopStatus[] = [];

  for (const [dimension, assignment] of byDim) {
    const timeline = dimensionTimeline(points, dimension);
    const label = DIMENSION_LABELS[dimension] ?? dimension;

    let stage: LoopStage = "detected";
    let summary = `${label} identified as a training area.`;
    const drillId: string | null = assignment.id;
    const drillAssignedAt: string | null = assignment.createdAt;
    let drillAttemptScore: number | null = null;
    let debateMovement: number | null = null;
    let retained: boolean | null = null;

    // Stage: practised (attempt submitted)
    if (assignment.status === "attempted" && assignment.attemptText) {
      stage = "practised";
      summary = `${label} drill attempted.`;
      drillAttemptScore = assignment.attemptScore ?? null;

      // Stage: improved in drill (attempt score > before score)
      const before = assignment.beforeScore ?? 0;
      const attempt = assignment.attemptScore ?? 0;
      if (attempt > before) {
        stage = "improved_in_drill";
        summary = `${label} drill scored ${attempt}/100 (up from ${Math.round(before)}).`;
      }

      // Stage: improved in later full debate
      const movement = measureDebateImprovement(timeline, assignment.createdAt, 2);
      if (movement.improved !== null) {
        debateMovement = movement.delta;
        if (movement.improved) {
          stage = "improved_in_debate";
          summary = `${label} improved ${movement.delta! > 0 ? "+" : ""}${movement.delta} in subsequent debates.`;
        }

        // Stage: retained across further debates
        const ret = checkRetention(timeline, assignment.createdAt, 2, 2);
        if (ret !== null) {
          retained = ret;
          if (ret && movement.improved) {
            stage = "retained";
            summary = `${label} improvement retained across multiple debates.`;
          }
        }
      }
    }

    statuses.push({
      dimension,
      label,
      stage,
      summary,
      drillId,
      drillAssignedAt,
      drillAttemptScore,
      debateMovement,
      retained,
    });
  }

  // Sort by progression (most advanced first)
  const ORDER: LoopStage[] = ["detected", "practised", "improved_in_drill", "improved_in_debate", "retained"];
  return statuses.sort((a, b) => ORDER.indexOf(b.stage) - ORDER.indexOf(a.stage));
}

// --- coach prompt after finishing a debate -------------------------------------

export interface CoachPrompt {
  show: boolean;
  headline: string;
  detail: string;
  ctaLabel: string;
  ctaHref: string;
}

/**
 * Should we surface a coaching CTA after finishing a debate?
 * Returns the prompt only when there's a clear weakness AND a matching drill.
 */
export function formatCoachPrompt(
  ledger: {
    regressions: string[];
    trajectories: Record<string, { last: number | null; improved: boolean | null }>;
    minimumForClaims: number;
    debates: number;
  },
  latestAssignment?: DrillAssignmentLite,
): CoachPrompt {
  const base: CoachPrompt = {
    show: false,
    headline: "",
    detail: "",
    ctaLabel: "",
    ctaHref: "/progress",
  };

  // Not enough data yet — but an active assignment overrides this
  if (ledger.debates < 2 && !latestAssignment?.attemptText) return base;

  // Active assignment: always surface it regardless of trajectory state
  if (latestAssignment?.status === "open") {
    const dimLabel = DIMENSION_LABELS[latestAssignment.dimension] ?? latestAssignment.dimension;
    return {
      ...base,
      show: true,
      headline: `Your ${dimLabel.toLowerCase()} needs work`,
      detail: `A ${latestAssignment.minutes ?? 3}-minute drill is waiting for you.`,
      ctaLabel: "Start drill",
      ctaHref: "/progress",
    };
  }

  if (latestAssignment?.status === "attempted") {
    return {
      ...base,
      show: true,
      headline: `${DIMENSION_LABELS[latestAssignment.dimension] ?? "Skill"} drill completed`,
      detail: "Your next debate will show whether the improvement sticks.",
      ctaLabel: "View progress",
      ctaHref: "/progress",
    };
  }

  // Find the weakest dimension
  const weakest = ledger.regressions[0] ??
    Object.entries(ledger.trajectories)
      .filter(([, t]) => t.last !== null)
      .sort(([, a], [, b]) => (a.last ?? 100) - (b.last ?? 100))[0]?.[0];

  if (!weakest) return base;

  const dimKey = weakest as keyof typeof DIMENSION_METRIC;
  const label = DIMENSION_LABELS[dimKey] ?? weakest;

  return {
    ...base,
    show: true,
    headline: `${label} is your current weakness`,
    detail: `Practice this skill to see measurable improvement.`,
    ctaLabel: "Start training",
    ctaHref: "/progress",
  };
}
