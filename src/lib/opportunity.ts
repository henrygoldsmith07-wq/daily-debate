// Shared side-scoped measurement primitives — THE rebuttal semantics layer.
//
// One home for the opportunity/attribution rules every product layer reads,
// so rewards (coachRewards), longitudinal tracking (skillLedger), turn
// scoring (observableAssessment), dropped detection (graphEnrichers),
// coaching goals (coachingGoal), result stories (resultSnapshot) and repair
// measurement (repairEffectiveness) cannot drift apart again. All functions
// are pure over the argument graph; "owner" is always the side being
// measured, and the opponent is whoever is not that side ("ai" in solo
// debates, "b" in PvP shapes).
//
// The canonical chain, implemented ONCE here:
//   opportunity  → eligibleOpponentMoves        (what could be answered)
//   valid target → isValidRebuttalTarget        (what a response may aim at)
//   valid answer → isValidRebuttalResponse      (what counts as a response)
//   answered     → userAnsweredIds              (which opportunities were met)
//   coverage     → rebuttalCoverageFor          (answered / eligible)
//   unanswered   → unansweredOpportunitiesBy    (which opportunities were missed)
//
// Canonical opportunity kinds are OPPONENT CLAIM AND COUNTERCLAIM. Impact
// nodes are weighing moves (measured by impact handling), not per-argument
// rebuttal opportunities; evidence nodes are support, never opportunities.
// DroppedArgument.owner is the side whose argument went unanswered, so a
// side's failure is always entries owned by the OTHER side — an opponent
// ignoring your argument is their miss, never yours.

import type { ArgEdgeRelation, ArgGraph, ArgNode, FallacyTag, Owner } from "./argGraph";
import { nodesOwnedBy, opponentClaimNodes } from "./argGraph";

/**
 * Node kinds that constitute a rebuttal opportunity when introduced by the
 * opponent: their argument moves (claim / counterclaim). Impact is a weighing
 * move; evidence is support — neither is an answerable argument here.
 */
export const OPPORTUNITY_KINDS: ReadonlySet<ArgNode["kind"]> = new Set(["claim", "counterclaim"]);

/**
 * Strong rebuttal targets: the opponent counterclaim is the heaviest
 * answerable argument move. Impact is weighing rather than a rebuttal
 * opportunity, so it does not earn rebuttal-target credit.
 */
export const STRONG_TARGET_KINDS: ReadonlySet<ArgNode["kind"]> = new Set(["counterclaim"]);

/**
 * Broader ENGAGEMENT scope for the per-round argument-response view only:
 * any opponent argument move (claim/counterclaim/impact) the side could
 * engage with. Never used for rebuttal coverage — impact is weighed by
 * impact handling, not answered per-argument.
 */
export const ENGAGEMENT_KINDS: ReadonlySet<ArgNode["kind"]> = new Set(["claim", "counterclaim", "impact"]);

/**
 * Node kinds that may ACT as a rebuttal response: explicit rebuttal nodes,
 * counterclaim nodes and claim nodes (the extractors legitimately emit
 * claim/counterclaim → rebuts/counters edges for opposing argument moves).
 * Evidence nodes are support, never responses — an evidence → counters edge
 * is malformed — and impact nodes are weighing moves, not answers.
 */
export const RESPONSE_KINDS: ReadonlySet<ArgNode["kind"]> = new Set(["rebuttal", "counterclaim", "claim"]);

/** Edge relations that may carry a rebuttal answer. */
export const ANSWER_RELATIONS: ReadonlySet<ArgEdgeRelation> = new Set(["rebuts", "counters"]);

/**
 * The canonical rebuttal-target rule. A target is legitimate only when ALL of
 * these hold — there is exactly one implementation of this rule in the app:
 *
 * 1. it resolves to a node that exists in the graph (no dangling ids);
 * 2. it belongs to a side OTHER than the responder (never a self-target);
 * 3. it is a canonical OPPORTUNITY kind (claim/counterclaim — evidence and
 *    impact are not rebuttal opportunities);
 * 4. it occurred in an EARLIER round than the response (never a future or
 *    same-round target; a round-N response cannot answer a round-≥N target,
 *    so a malformed graph cannot manufacture coverage).
 */
export function isValidRebuttalTarget(
  graph: ArgGraph,
  targetId: string,
  responder: Owner,
  responseRound: number,
): boolean {
  const target = graph.nodes.find((n) => n.id === targetId);
  if (!target) return false; // unknown/dangling id
  if (target.owner === responder) return false; // never the responder's own node
  if (!OPPORTUNITY_KINDS.has(target.kind)) return false; // not an answerable argument
  if (target.round >= responseRound) return false; // must strictly precede the response
  return true;
}

/**
 * The canonical response rule: validates BOTH ends of an answer at once.
 * A graph edge (or an implicit rebuttal target) counts as a valid answer
 * only when ALL of these hold:
 *
 * 1. the response node exists (no dangling ids);
 * 2. the response node belongs to the measured side;
 * 3. the response node is a permitted RESPONSE kind (rebuttal/counterclaim/
 *    claim — evidence and impact can never answer an argument);
 * 4. the edge relation is a permitted answer relation (rebuts/counters);
 * 5. the target passes isValidRebuttalTarget (opponent opportunity, earlier
 *    round, correct kind) against THIS response node's round.
 *
 * Malformed shapes that score nothing: evidence → counters, self-targets,
 * future/same-round targets, dangling ids, unsupported relations.
 */
export function isValidRebuttalResponse(
  graph: ArgGraph,
  responseId: string,
  targetId: string,
  relation: string,
  owner: Owner,
): boolean {
  if (!ANSWER_RELATIONS.has(relation as ArgEdgeRelation)) return false;
  const response = graph.nodes.find((n) => n.id === responseId);
  if (!response) return false; // dangling response id
  if (response.owner !== owner) return false; // must be the measured side's move
  if (!RESPONSE_KINDS.has(response.kind)) return false; // evidence/claim/impact cannot answer
  return isValidRebuttalTarget(graph, targetId, owner, response.round);
}

/**
 * Opponent moves the measured side had a genuine chance to answer: opponent
 * claim/counterclaim nodes with at least one later node owned by the measured
 * side. A last-round opponent move with no subsequent turn is not an
 * opportunity and must never count against anyone.
 */
export function eligibleOpponentMoves(graph: ArgGraph, owner: Owner): ArgNode[] {
  return opponentClaimNodes(graph, owner).filter((m) =>
    graph.nodes.some((n) => n.owner === owner && n.round > m.round),
  );
}

/**
 * Opponent-move ids the measured side actually answered. An answer counts
 * ONLY when BOTH ends pass the canonical validation:
 *  - an explicit `rebuttal.targets` entry: the rebuttal node is owned by the
 *    side and its kind is a response kind (rebuttal always is), the target is
 *    valid and earlier;
 *  - a rebuts/counters edge: the edge is a valid response (from-node is a
 *    response-kind node owned by the side, target valid and earlier).
 * Malformed graphs (self-targets, future targets, dangling ids,
 * evidence → counters) score nothing.
 */
export function userAnsweredIds(graph: ArgGraph, owner: Owner): Set<string> {
  const ids = new Set<string>();
  for (const e of graph.edges) {
    if (isValidRebuttalResponse(graph, e.from, e.to, e.relation, owner)) {
      ids.add(e.to);
    }
  }
  for (const n of graph.nodes) {
    if (n.kind !== "rebuttal" || n.owner !== owner) continue;
    for (const t of n.targets ?? []) {
      if (isValidRebuttalTarget(graph, t, owner, n.round)) ids.add(t);
    }
  }
  return ids;
}

export interface CoverageReading {
  /** Answered eligible moves / eligible moves, or null when unmeasurable. */
  value: number | null;
  /** Eligible opportunity count backing the reading (0 = unmeasurable). */
  opportunities: number;
  /** Exact trail: the eligible opportunities this reading was computed over. */
  eligibleIds: string[];
  /** Exact trail: eligible opportunities the side actually answered. */
  answeredIds: string[];
  /** Exact trail: eligible opportunities that went unanswered. */
  unmatchedIds: string[];
}

/**
 * Canonical rebuttal coverage: eligible opponent arguments answered divided
 * by eligible opponent arguments. The single definition shared by rewards,
 * weakest-skill measurement, the skill ledger, core scoring and the result
 * story. The trails contain exactly the nodes used in the calculation —
 * nothing that was filtered out (last-round moves, invalid targets, excluded
 * kinds) ever appears.
 */
export function rebuttalCoverageFor(graph: ArgGraph, owner: Owner): CoverageReading {
  const eligible = eligibleOpponentMoves(graph, owner);
  if (!eligible.length) {
    return { value: null, opportunities: 0, eligibleIds: [], answeredIds: [], unmatchedIds: [] };
  }
  const answered = userAnsweredIds(graph, owner);
  const eligibleIds = eligible.map((m) => m.id);
  const answeredIds = eligibleIds.filter((id) => answered.has(id));
  const unmatchedIds = eligibleIds.filter((id) => !answered.has(id));
  return {
    value: answeredIds.length / eligible.length,
    opportunities: eligible.length,
    eligibleIds,
    answeredIds,
    unmatchedIds,
  };
}

/**
 * The side's rebuttal weakness as opportunities: the eligible opponent
 * arguments it left unanswered, as graph nodes. This is the structural
 * definition behind drop detection (graphEnrichers.detectDropped) and
 * weakness measurement (repairEffectiveness), guaranteeing:
 *
 *   canonical unanswered opportunities == rebuttal weaknesses
 *
 * for the same graph — by construction, not by parallel implementation.
 */
export function unansweredOpportunitiesBy(graph: ArgGraph, owner: Owner): ArgNode[] {
  const missed = userAnsweredIds(graph, owner);
  return eligibleOpponentMoves(graph, owner).filter((m) => !missed.has(m.id));
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
