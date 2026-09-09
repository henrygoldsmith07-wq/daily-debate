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
import type { ArgGraph, ArgNode, FallacyTag, Owner } from "./argGraph";

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

// --- side-scoping helpers -----------------------------------------------------
//
// Centralised so no detector re-implements (and potentially inverts) the
// owner convention. DroppedArgument.owner is the side whose argument went
// unanswered, so a side's FAILURE is always entries owned by the OTHER side.

/** The rewarded side in solo debates: the human user. */
export const REWARDED_OWNER: Owner = "a";

/** Nodes owned by a side (user behaviour lives here). */
export function nodesOwnedBy(graph: ArgGraph, owner: Owner): ArgNode[] {
  return graph.nodes.filter((n) => n.owner === owner);
}

/** Opponent moves a side could answer: claims/counterclaims NOT owned by it. */
export function opponentMovesFor(graph: ArgGraph, owner: Owner): ArgNode[] {
  return graph.nodes.filter(
    (n) => n.owner !== owner && (n.kind === "claim" || n.kind === "counterclaim"),
  );
}

/** Fallacy tags attached to a side's own nodes (opponent fallacies excluded). */
export function fallaciesOwnedBy(graph: ArgGraph, owner: Owner): FallacyTag[] {
  const ids = new Set(nodesOwnedBy(graph, owner).map((n) => n.id));
  return graph.fallacies.filter((f) => ids.has(f.nodeId));
}

/** Unsupported claim ids belonging to a side's own claims. */
export function unsupportedOwnedBy(graph: ArgGraph, owner: Owner): string[] {
  const ids = new Set(nodesOwnedBy(graph, owner).map((n) => n.id));
  return graph.evidenceStats.unsupportedClaimIds.filter((id) => ids.has(id));
}

/** Opponent arguments a side left unanswered (its rebuttal failure). */
export function unansweredBy(graph: ArgGraph, owner: Owner) {
  return graph.dropped.filter((d) => d.owner !== owner);
}

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
  // Direct graph check — more robust than reading enriched features because
  // it doesn't depend on how enrichment computes the coverage ratio.
  // Opponent = anyone who is not the user: "ai" in solo, "b" in PvP shapes.
  const opposing = opponentMovesFor(graph, REWARDED_OWNER);
  if (!opposing.length) return false;
  const targetedIds = new Set(
    graph.nodes
      .filter((n) => n.kind === "rebuttal" && n.owner === REWARDED_OWNER)
      .flatMap((r) => r.targets ?? [])
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

  const extractScores = (a: ObservableAssessment) => {
    const myClaims = nodesOwnedBy(a.graph, REWARDED_OWNER).filter(
      (n) => n.kind === "claim" || n.kind === "counterclaim",
    );
    const myUnsupported = unsupportedOwnedBy(a.graph, REWARDED_OWNER).length;
    return {
      unsupportedRate: myUnsupported / Math.max(1, myClaims.length),
      // Opponent arguments the user left unanswered — never the user's own
      // ignored arguments (those are the opponent's miss).
      droppedCount: unansweredBy(a.graph, REWARDED_OWNER).length,
      fallacyCount: fallaciesOwnedBy(a.graph, REWARDED_OWNER).length,
      // User behaviour: did the user make an explicit impact move this time?
      impactMissing: nodesOwnedBy(a.graph, REWARDED_OWNER).some((n) => n.kind === "impact") ? 0 : 1,
    };
  };

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
