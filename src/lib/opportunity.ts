// Shared side-scoped measurement primitives.
//
// One home for the opportunity/attribution rules every metric reads, so
// rewards (coachRewards), longitudinal tracking (skillLedger) and repair
// measurement (repairEffectiveness) cannot drift apart again. All functions
// are pure over the argument graph; "owner" is always the side being
// measured, and the opponent is whoever is not that side ("ai" in solo
// debates, "b" in PvP shapes).
//
// DroppedArgument.owner is the side whose argument went unanswered, so a
// side's failure is always entries owned by the OTHER side — an opponent
// ignoring your argument is their miss, never yours.

import type { ArgGraph, ArgNode, FallacyTag, Owner } from "./argGraph";
import { nodesOwnedBy, opponentClaimNodes } from "./argGraph";

/** Opponent moves a side could answer: claims/counterclaims NOT owned by it. */
export function opponentMovesFor(graph: ArgGraph, owner: Owner): ArgNode[] {
  return opponentClaimNodes(graph, owner);
}

/**
 * Opponent moves the measured side had a genuine chance to answer: opponent
 * claim/counterclaim nodes with at least one later node owned by the
 * measured side. A last-round opponent move with no subsequent turn is not
 * an opportunity and must never count against anyone.
 */
export function eligibleOpponentMoves(graph: ArgGraph, owner: Owner): ArgNode[] {
  return opponentMovesFor(graph, owner).filter((m) =>
    graph.nodes.some((n) => n.owner === owner && n.round > m.round),
  );
}

/** Opponent-move ids the measured side actually answered. */
export function userAnsweredIds(graph: ArgGraph, owner: Owner): Set<string> {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const ids = new Set<string>();
  for (const e of graph.edges) {
    if (e.relation !== "rebuts" && e.relation !== "counters") continue;
    if (nodes.get(e.from)?.owner === owner && nodes.get(e.to)?.owner !== owner) {
      ids.add(e.to);
    }
  }
  for (const n of graph.nodes) {
    if (n.kind !== "rebuttal" || n.owner !== owner) continue;
    for (const t of n.targets ?? []) {
      if (nodes.get(t)?.owner !== owner) ids.add(t);
    }
  }
  return ids;
}

export interface CoverageReading {
  /** Answered eligible moves / eligible moves, or null when unmeasurable. */
  value: number | null;
  /** Eligible opportunity count backing the reading (0 = unmeasurable). */
  opportunities: number;
}

/**
 * Canonical rebuttal coverage: eligible opponent arguments answered divided
 * by eligible opponent arguments. The single definition shared by rewards,
 * weakest-skill measurement and the skill ledger.
 */
export function rebuttalCoverageFor(graph: ArgGraph, owner: Owner): CoverageReading {
  const eligible = eligibleOpponentMoves(graph, owner);
  if (!eligible.length) return { value: null, opportunities: 0 };
  const answered = userAnsweredIds(graph, owner);
  const missed = eligible.filter((m) => !answered.has(m.id)).length;
  return { value: 1 - missed / eligible.length, opportunities: eligible.length };
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
