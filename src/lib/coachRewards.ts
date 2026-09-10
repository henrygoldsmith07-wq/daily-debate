// Coach rewards — XP bonuses for improvement behaviours, not just participation.
//
// The legacy system awards points = sum(depth+evidence+logic+rebuttal+clarity).
// This module adds BONUS XP on top for behaviours that indicate actual skill
// growth. The optimisation target shifts from "get points" to "become better".
//
// SIDE-SCOPING CONTRACT: every reward refers ONLY to the human user's own
// behaviour. The rewarded side is always the solo user (owner "a"); the
// opponent is whoever is not the user — "ai" in solo debates, "b" in PvP
// shapes. Opponent performance must never grant or remove a user reward:
// - a grounded OPPONENT claim grants nothing;
// - an opponent ignoring the USER's claim grants nothing;
// - a fallacy on an opponent node changes nothing;
// - impact improvement means the USER made an impact move, not that the
//   debate happens to contain an impact comparison.
//
// Pure — takes assessment data + context, returns earned reward events.

import type { ObservableAssessment } from "./observableAssessment";
import {
  claimNodesOwnedBy,
  nodesOwnedBy,
  opponentClaimNodes,
  type ArgGraph,
  type Owner,
} from "./argGraph";
import {
  eligibleOpponentMoves,
  fallaciesOwnedBy,
  rebuttalCoverageFor,
  unsupportedOwnedBy,
  userAnsweredIds,
} from "./opportunity";

export type RewardEventKind =
  | "complete-debate"
  | "improve-weakest-skill"
  | "ground-a-claim"
  | "answer-every-rebuttal"
  | "unfamiliar-topic";

export const REWARD_XP: Record<RewardEventKind, number> = {
  "complete-debate": 50,
  "improve-weakest-skill": 20,
  "ground-a-claim": 15,
  "answer-every-rebuttal": 20,
  "unfamiliar-topic": 10,
};

export const REWARD_LABELS: Record<RewardEventKind, string> = {
  "complete-debate": "Completed a full debate",
  "improve-weakest-skill": "Improved your weakest skill",
  "ground-a-claim": "Properly grounded a claim",
  "answer-every-rebuttal": "Answered every major rebuttal",
  "unfamiliar-topic": "Debated an unfamiliar topic",
};

export interface RewardEvent {
  kind: RewardEventKind;
  xp: number;
  label: string;
  /** Which skill dimension improved (improve-weakest-skill only). */
  dimension?: string;
  /** Human-readable evidence, e.g. "Evidence 40% → 85% across 3 prior debates". */
  detail?: string;
}

/**
 * Context needed to compute rewards. All optional fields degrade gracefully —
 * missing data means that specific reward isn't evaluated, not that it fails.
 */
export interface RewardContext {
  /** Merged observable assessment for the completed debate */
  assessment: ObservableAssessment;
  /** Previous debates' merged assessments (chronological, excluding current) */
  priorAssessments: ObservableAssessment[];
  /** Categories of topics this user has already debated */
  previouslyDebatedCategories: string[];
  /** Category of the current topic */
  currentCategory: string;
}

// --- side-scoping ---------------------------------------------------------------
//
// The rewarded side is always the solo user (REWARDED_OWNER); the opponent is
// whoever is not the user. DroppedArgument.owner is the side whose argument
// went unanswered, so a side's FAILURE is always entries owned by the OTHER
// side. Shared selection primitives live in argGraph.ts, shared measurement
// primitives in opportunity.ts — this module holds only reward policy.

/** The rewarded side in solo debates: the human user. */
export const REWARDED_OWNER: Owner = "a";

// --- individual checks --------------------------------------------------------
// All checks below are user-scoped: they read the user's nodes, the user's
// citations, and the user's rebuttal targets only.

function hasGroundedClaim(graph: ArgGraph): boolean {
  const claims = nodesOwnedBy(graph, REWARDED_OWNER).filter((n) => n.kind === "claim");
  if (!claims.length) return false;
  // At least one of the USER's claims has a supported evidence link AND the
  // supporting evidence is the user's own with a real citation.
  const supportedIds = new Set(
    graph.edges.filter((e) => e.relation === "supports").map((e) => e.to)
  );
  return claims.some((c) => {
    if (!supportedIds.has(c.id)) return false;
    const evidence = graph.nodes.find(
      (n) =>
        n.kind === "evidence" &&
        n.owner === REWARDED_OWNER &&
        graph.edges.some((e) => e.from === n.id && e.to === c.id)
    );
    return evidence?.citations?.some((cit) => cit.sourceName.length > 2) ?? false;
  });
}

function hasFullRebuttalCoverage(graph: ArgGraph): boolean {
  // One shared definition with the improvement measurement and the ledger:
  // every ELIGIBLE opponent move answered. Final-round moves the user had no
  // later turn to answer are not opportunities and never count against them.
  // Zero eligible opportunities means no reward (not a free pass).
  return rebuttalCoverageFor(graph, REWARDED_OWNER).value === 1;
}

function isUnfamiliarCategory(currentCategory: string, previousCategories: string[]): boolean {
  if (!currentCategory) return false;
  return !previousCategories.some(
    (c) => c.toLowerCase().trim() === currentCategory.toLowerCase().trim()
  );
}

// --- weakest-dimension improvement measurement --------------------------------
//
// "Improved your weakest skill" must name a real dimension and a real change:
//  1. measure each dimension per debate as an OPPORTUNITY-NORMALISED rate
//     (raw counts would reward shorter debates, not better debating);
//  2. a dimension is measurable for a debate only if that debate offered a
//     genuine opportunity (zero opportunity = unmeasurable, never perfect);
//  3. PHASE 1 (priors only): compute prior means for every dimension,
//     excluding dimensions with < IMPROVEMENT_MIN_PRIOR_DEBATES measured
//     priors or < IMPROVEMENT_MIN_PRIOR_OPPORTUNITIES cumulative
//     opportunities; select the lowest mean (fixed-order tie-break);
//  4. PHASE 2 (current only): measure exactly that dimension in the current
//     debate — if unmeasurable, no claim; never substitute a second-weakest;
//  5. award only when the gain clears IMPROVEMENT_MIN_DELTA.
//
// Sprint and Full debates mix freely: every debate contributes a rate, so
// length alone cannot manufacture improvement. Per-debate rates average
// equally (each debate is one rep) rather than pooled, so one long debate
// cannot dominate the baseline.

export type ImprovementDimension = "evidence" | "rebuttal" | "logic" | "impact";

/** Fixed evaluation order — also the deterministic tie-break. */
export const IMPROVEMENT_DIMENSIONS: ImprovementDimension[] = ["evidence", "rebuttal", "logic", "impact"];

/** Minimum measured prior debates before a dimension is eligible. */
export const IMPROVEMENT_MIN_PRIOR_DEBATES = 2;

/**
 * Minimum cumulative opportunities across measured priors before a dimension
 * is eligible. Two debates with one opportunity each (total 2) stay
 * insufficient: a rate estimated from two chances cannot support an
 * improvement claim.
 */
export const IMPROVEMENT_MIN_PRIOR_OPPORTUNITIES = 4;

/** Minimum goodness gain (0..1) to count as meaningful improvement. */
export const IMPROVEMENT_MIN_DELTA = 0.05;

export const IMPROVEMENT_DIMENSION_LABELS: Record<ImprovementDimension, string> = {
  evidence: "Evidence",
  rebuttal: "Rebuttal",
  logic: "Logic",
  impact: "Impact",
};

export interface DimensionReading {
  /** Goodness 0..1 (higher = better), or null when unmeasurable. */
  value: number | null;
  /** Opportunity count backing the reading (0 = unmeasurable). */
  opportunities: number;
}

/**
 * Measure one dimension for one debate as an opportunity-normalised goodness.
 * - evidence: 1 − unsupported own claims / eligible own claims
 * - rebuttal: 1 − unanswered eligible opponent moves / eligible opponent moves
 * - logic: 1 − min(1, own fallacies / ALL own moves — the detector's scope)
 * - impact: 1 if the user made an explicit impact move, else 0
 *   (measurable only when the debate offered something to weigh: ≥1 own claim
 *   AND (≥1 opponent move OR ≥2 own claims to compare))
 */
export function measureDimension(graph: ArgGraph, dimension: ImprovementDimension): DimensionReading {
  const mine = nodesOwnedBy(graph, REWARDED_OWNER);
  switch (dimension) {
    case "evidence": {
      const claims = claimNodesOwnedBy(graph, REWARDED_OWNER);
      if (!claims.length) return { value: null, opportunities: 0 };
      const unsupported = new Set(unsupportedOwnedBy(graph, REWARDED_OWNER));
      const rate = claims.filter((c) => unsupported.has(c.id)).length / claims.length;
      return { value: 1 - rate, opportunities: claims.length };
    }
    case "rebuttal": {
      const eligible = eligibleOpponentMoves(graph, REWARDED_OWNER);
      if (!eligible.length) return { value: null, opportunities: 0 };
      const answered = userAnsweredIds(graph, REWARDED_OWNER);
      const missed = eligible.filter((m) => !answered.has(m.id)).length;
      return { value: 1 - missed / eligible.length, opportunities: eligible.length };
    }
    case "logic": {
      // Numerator and denominator share one scope: EVERY user-owned node,
      // because that is exactly the node set the fallacy detector scans.
      // A fallacy tag on any own node (claim, rebuttal, evidence, impact)
      // counts, and every own node counts as an opportunity — so a counted
      // fallacy always has its move present in the denominator.
      const moves = nodesOwnedBy(graph, REWARDED_OWNER);
      if (!moves.length) return { value: null, opportunities: 0 };
      const rate = Math.min(1, fallaciesOwnedBy(graph, REWARDED_OWNER).length / moves.length);
      return { value: 1 - rate, opportunities: moves.length };
    }
    case "impact": {
      const claims = claimNodesOwnedBy(graph, REWARDED_OWNER);
      const opponentMoves = opponentClaimNodes(graph, REWARDED_OWNER).length;
      // Weighing needs something to weigh: the user's own claims plus either
      // an opposing position or multiple own claims to compare.
      if (!claims.length || (opponentMoves < 1 && claims.length < 2)) {
        return { value: null, opportunities: 0 };
      }
      const hasImpact = mine.some((n) => n.kind === "impact");
      return { value: hasImpact ? 1 : 0, opportunities: claims.length };
    }
  }
}

export interface WeakestDimensionComparison {
  dimension: ImprovementDimension;
  priorMean: number;
  priorDebates: number;
  /** Cumulative opportunities backing the prior mean. */
  priorOpportunities: number;
  current: number;
  currentOpportunities: number;
  delta: number;
  improved: boolean;
}

/**
 * Find the genuinely weakest eligible dimension using PRIOR evidence only,
 * then measure exactly that dimension in the current debate — never a
 * second-weakest substitute.
 *
 *  1. For every dimension, collect prior readings (opportunity-normalised).
 *  2. Exclude dimensions with < IMPROVEMENT_MIN_PRIOR_DEBATES measured priors
 *     or < IMPROVEMENT_MIN_PRIOR_OPPORTUNITIES cumulative opportunities.
 *  3. Select the lowest prior mean deterministically (fixed-order tie-break).
 *  4. Measure that exact dimension in the current debate; if unmeasurable,
 *     return null — no claim at all.
 *  5. Award only when the gain clears IMPROVEMENT_MIN_DELTA.
 */
export function compareWeakestDimension(
  current: ArgGraph,
  priors: ArgGraph[],
): WeakestDimensionComparison | null {
  // Phase 1 — priors only: means over eligible dimensions.
  let weakest: { dimension: ImprovementDimension; priorMean: number; priorDebates: number; priorOpportunities: number } | null = null;
  for (const dimension of IMPROVEMENT_DIMENSIONS) {
    const priorValues = priors
      .map((g) => measureDimension(g, dimension))
      .filter((r): r is { value: number; opportunities: number } => r.value !== null);
    if (priorValues.length < IMPROVEMENT_MIN_PRIOR_DEBATES) continue;
    const priorOpportunities = priorValues.reduce((s, r) => s + r.opportunities, 0);
    if (priorOpportunities < IMPROVEMENT_MIN_PRIOR_OPPORTUNITIES) continue;
    const priorMean = priorValues.reduce((s, r) => s + r.value, 0) / priorValues.length;
    // Strictly-lower mean wins; ties keep the earlier (fixed-order) dimension.
    if (!weakest || priorMean < weakest.priorMean) {
      weakest = { dimension, priorMean, priorDebates: priorValues.length, priorOpportunities };
    }
  }
  if (!weakest) return null;

  // Phase 2 — the selected dimension only, measured in the current debate.
  const reading = measureDimension(current, weakest.dimension);
  if (reading.value === null) return null;
  const delta = reading.value - weakest.priorMean;
  return {
    dimension: weakest.dimension,
    priorMean: weakest.priorMean,
    priorDebates: weakest.priorDebates,
    priorOpportunities: weakest.priorOpportunities,
    current: reading.value,
    currentOpportunities: reading.opportunities,
    delta,
    improved: delta >= IMPROVEMENT_MIN_DELTA,
  };
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

// --- main computation -----------------------------------------------------------

/**
 * Compute all earned improvement rewards for a completed debate.
 * Pure — no side effects, fully testable.
 */
export function computeCoachRewards(ctx: RewardContext): RewardEvent[] {
  const events: RewardEvent[] = [];
  const add = (kind: RewardEventKind, extra?: Partial<RewardEvent>) =>
    events.push({ kind, xp: REWARD_XP[kind], label: REWARD_LABELS[kind], ...extra });

  // 1. Completion bonus (always earned when the route fires)
  add("complete-debate");

  // 2. Grounded a claim
  if (hasGroundedClaim(ctx.assessment.graph)) add("ground-a-claim");

  // 3. Full rebuttal coverage
  if (hasFullRebuttalCoverage(ctx.assessment.graph)) add("answer-every-rebuttal");

  // 4. Improved weakest skill: only the genuinely weakest eligible dimension,
  // measured against its own prior mean — with the evidence in the metadata.
  const comparison = compareWeakestDimension(
    ctx.assessment.graph,
    ctx.priorAssessments.map((p) => p.graph),
  );
  if (comparison?.improved) {
    add("improve-weakest-skill", {
      dimension: comparison.dimension,
      detail: `${IMPROVEMENT_DIMENSION_LABELS[comparison.dimension]} ${pct(comparison.priorMean)} → ${pct(comparison.current)} · ${comparison.priorOpportunities} opportunities across ${comparison.priorDebates} prior debates`,
    });
  }

  // 5. Unfamiliar topic category
  if (isUnfamiliarCategory(ctx.currentCategory, ctx.previouslyDebatedCategories)) {
    add("unfamiliar-topic");
  }

  return events;
}

/** Sum total bonus XP from reward events. */
export function totalBonusXP(events: RewardEvent[]): number {
  return events.reduce((s, e) => s + e.xp, 0);
}
