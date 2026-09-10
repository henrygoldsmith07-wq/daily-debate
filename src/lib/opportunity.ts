// Shared side-scoped measurement primitives.
//
// One home for the opportunity/attribution rules every metric reads, so
// rewards (coachRewards), longitudinal tracking (skillLedger), turn scoring
// (observableAssessment) and repair measurement (repairEffectiveness) cannot
// drift apart again. All functions are pure over the argument graph; "owner"
// is always the side being measured, and the opponent is whoever is not that
// side ("ai" in solo debates, "b" in PvP shapes).
//
// Rebuttal semantics live HERE and nowhere else:
//   opportunity  → eligibleOpponentMoves
//   valid target → isValidRebuttalTarget
//   answered     → userAnsweredIds
//   coverage     → rebuttalCoverageFor
//
// DroppedArgument.owner is the side whose argument went unanswered, so a
// side's failure is always entries owned by the OTHER side — an opponent
// ignoring your argument is their miss, never yours.

import type { ArgGraph, ArgNode, FallacyTag, Owner } from "./argGraph";
import { nodesOwnedBy, opponentClaimNodes } from "./argGraph";

/** Node kinds a rebuttal may legitimately target: an opponent's argument moves. */
export const REBUTTABLE_KINDS: ReadonlySet<ArgNode["kind"]> = new Set(["claim", "counterclaim", "impact"]);

/**
 * The canonical rebuttal-target rule. A target is legitimate only when ALL of
 * these hold — there is exactly one implementation of this rule in the app:
 *
 * 1. it resolves to a node that exists in the graph (no dangling ids);
 * 2. it belongs to a side OTHER than the responder (never a self-target);
 * 3. it is an eligible rebuttable node kind (claim/counterclaim/impact —
 *    evidence nodes are not rebuttable moves);
 * 4. it occurred in an EARLIER round than the response (never a future
 *    argument; a round-N response cannot answer a round-M>N target, so a
 *    malformed graph cannot manufacture coverage).
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
  if (!REBUTTABLE_KINDS.has(target.kind)) return false; // not an argument move
  if (target.round >= responseRound) return false; // must precede the response
  return true;
}

/**
 * Opponent moves the measured side had a genuine chance to answer: opponent
 * argument moves (claim/counterclaim — impact nodes are weighed, not
 * individually answerable opportunities in the coaching metrics) with at
 * least one later node owned by the measured side. A last-round opponent
 * move with no subsequent turn is not an opportunity and must never count
 * against anyone.
 */
export function eligibleOpponentMoves(graph: ArgGraph, owner: Owner): ArgNode[] {
  return opponentClaimNodes(graph, owner).filter((m) =>
    graph.nodes.some((n) => n.owner === owner && n.round > m.round),
  );
}

/**
 * Opponent-move ids the measured side actually answered. An answer counts
 * ONLY when it is a chronologically valid response: a rebuttal node owned by
 * the measured side whose target passes isValidRebuttalTarget (existing,
 * opponent-owned, rebuttable kind, earlier round), or a rebuts/counters
 * edge from the side's node to an opponent node that passes the same rule
 * (the edge's from-node round must be after the target's round).
 * Malformed graphs (self-targets, future targets, dangling ids) score nothing.
 */
export function userAnsweredIds(graph: ArgGraph, owner: Owner): Set<string> {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const ids = new Set<string>();
  for (const e of graph.edges) {
    if (e.relation !== "rebuts" && e.relation !== "counters") continue;
    const from = nodes.get(e.from);
    if (!from || from.owner !== owner) continue;
    if (isValidRebuttalTarget(graph, e.to, owner, from.round)) ids.add(e.to);
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
 * weakest-skill measurement, the skill ledger and the result story. The
 * trails contain exactly the nodes used in the calculation — nothing that
 * was filtered out (last-round moves, invalid targets) ever appears.
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

/**
 * Opponent arguments a side left unanswered (its rebuttal failure). Reads the
 * judge-supplied `dropped` entries (owner = the side whose argument went
 * unanswered, so the measured side's failure is entries owned by the OTHER
 * side). Deterministic drop detection (graphEnrichers.detectDropped) shares
 * the same chronology rule via the canonical target validation.
 */
export function unansweredBy(graph: ArgGraph, owner: Owner) {
  return graph.dropped.filter((d) => d.owner !== owner);
}
