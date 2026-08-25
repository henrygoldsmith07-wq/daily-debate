// Coach rewards — XP bonuses for improvement behaviours, not just participation.
//
// The legacy system awards points = sum(depth+evidence+logic+rebuttal+clarity).
// This module adds BONUS XP on top for behaviours that indicate actual skill
// growth. The optimisation target shifts from "get points" to "become better".
//
// Pure — takes assessment data + context, returns earned reward events.

import type { ObservableAssessment } from "./observableAssessment";
import type { ArgGraph } from "./argGraph";

export type RewardEventKind =
  | "complete-debate"
  | "improve-weakest-skill"
  | "ground-a-claim"
  | "answer-every-rebuttal"
  | "complete-drill"
  | "beat-benchmark"
  | "unfamiliar-topic";

export const REWARD_XP: Record<RewardEventKind, number> = {
  "complete-debate": 50,
  "improve-weakest-skill": 20,
  "ground-a-claim": 15,
  "answer-every-rebuttal": 20,
  "complete-drill": 25,
  "beat-benchmark": 30,
  "unfamiliar-topic": 10,
};

export const REWARD_LABELS: Record<RewardEventKind, string> = {
  "complete-debate": "Completed a full debate",
  "improve-weakest-skill": "Improved your weakest skill",
  "ground-a-claim": "Properly grounded a claim",
  "answer-every-rebuttal": "Answered every major rebuttal",
  "complete-drill": "Completed a targeted drill",
  "beat-benchmark": "Beat previous benchmark",
  "unfamiliar-topic": "Debated an unfamiliar topic",
};

export interface RewardEvent {
  kind: RewardEventKind;
  xp: number;
  label: string;
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

// --- individual checks --------------------------------------------------------

function hasGroundedClaim(graph: ArgGraph): boolean {
  const claims = graph.nodes.filter((n) => n.kind === "claim");
  if (!claims.length) return false;
  // At least one claim has a supported evidence link AND a real citation
  const supportedIds = new Set(
    graph.edges.filter((e) => e.relation === "supports").map((e) => e.to)
  );
  return claims.some((c) => {
    if (!supportedIds.has(c.id)) return false;
    const evidence = graph.nodes.find(
      (n) => n.kind === "evidence" && graph.edges.some((e) => e.from === n.id && e.to === c.id)
    );
    return evidence?.citations?.some((cit) => cit.sourceName.length > 2) ?? false;
  });
}

function hasFullRebuttalCoverage(graph: ArgGraph): boolean {
  // Direct graph check — more robust than reading enriched features because
  // it doesn't depend on how enrichment computes the coverage ratio.
  const opposing = graph.nodes.filter(
    (n) => n.owner !== "a" && n.owner !== "ai" && (n.kind === "counterclaim" || n.kind === "claim")
  );
  if (!opposing.length) return false;
  const targetedIds = new Set(
    graph.nodes.filter((n) => n.kind === "rebuttal" && n.owner === "a").flatMap((r) => r.targets ?? [])
  );
  return opposing.every((o) => targetedIds.has(o.id));
}

function isUnfamiliarCategory(currentCategory: string, previousCategories: string[]): boolean {
  if (!currentCategory) return false;
  return !previousCategories.some(
    (c) => c.toLowerCase().trim() === currentCategory.toLowerCase().trim()
  );
}

/** Detect whether the user's weakest dimension improved vs their prior average. */
function weakestSkillImproved(current: ObservableAssessment, priors: ObservableAssessment[]): boolean {
  if (!priors.length) return false; // can't measure without baseline

  const extractScores = (a: ObservableAssessment) => ({
    unsupportedRate: a.graph.evidenceStats.unsupportedClaimIds.length /
      Math.max(1, a.graph.nodes.filter((n) => n.kind === "claim").length),
    droppedCount: a.graph.dropped.length,
    fallacyCount: a.graph.fallacies.length,
    impactMissing: !a.graph.impactComparison ? 1 : 0,
  });

  const cur = extractScores(current);
  const priorMean = priors.reduce((acc, p) => {
    const s = extractScores(p);
    return {
      unsupportedRate: acc.unsupportedRate + s.unsupportedRate / priors.length,
      droppedCount: acc.droppedCount + s.droppedCount / priors.length,
      fallacyCount: acc.fallacyCount + s.fallacyCount / priors.length,
      impactMissing: acc.impactMissing + s.impactMissing / priors.length,
    };
  }, { unsupportedRate: 0, droppedCount: 0, fallacyCount: 0, impactMissing: 0 });

  // Improved if current is better than prior mean on ANY dimension
  return (
    cur.unsupportedRate < priorMean.unsupportedRate ||
    cur.droppedCount < priorMean.droppedCount ||
    cur.fallacyCount < priorMean.fallacyCount ||
    cur.impactMissing < priorMean.impactMissing
  );
}

// --- main computation -----------------------------------------------------------

/**
 * Compute all earned improvement rewards for a completed debate.
 * Pure — no side effects, fully testable.
 */
export function computeCoachRewards(ctx: RewardContext): RewardEvent[] {
  const events: RewardEvent[] = [];
  const add = (kind: RewardEventKind) =>
    events.push({ kind, xp: REWARD_XP[kind], label: REWARD_LABELS[kind] });

  // 1. Completion bonus (always earned when the route fires)
  add("complete-debate");

  // 2. Grounded a claim
  if (hasGroundedClaim(ctx.assessment.graph)) add("ground-a-claim");

  // 3. Full rebuttal coverage
  if (hasFullRebuttalCoverage(ctx.assessment.graph)) add("answer-every-rebuttal");

  // 4. Improved weakest skill (needs ≥1 prior debate for comparison)
  if (weakestSkillImproved(ctx.assessment, ctx.priorAssessments)) {
    add("improve-weakest-skill");
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
