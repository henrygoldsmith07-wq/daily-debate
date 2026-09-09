// Does repair actually work? — observational measure over repair_results.
//
// For each completed repair we look at whether the SAME weakness kind shows up
// in the user's debates BEFORE vs AFTER the repair (within a bounded window):
//
//   weakness detected → repair completed → next relevant debates → improved / unchanged / worse
//
// Constraints, deliberately conservative:
// - Only presence/absence of observable weaknesses in stored argument graphs is
//   compared — no model opinion.
// - Weakness counts are SIDE-SCOPED (the user's own nodes): an opponent's
//   dropped arguments can never register as the user's weakness.
// - A repair kind without a genuine deterministic weakness detector (clarity
//   today) is "not currently measurable" — it can never enter the improved /
//   unchanged / worse comparison by accident.
// - A repair is only comparable when the user actually has later debates that
//   could express the weakness; otherwise it is "not yet measurable".
// - Summary rates need REPAIR_MIN_MEASURABLE measurable repairs AND
//   REPAIR_MIN_SAMPLE total repairs per kind; below that we say so.
// - The output is labelled observational: repair is associated with the
//   change, it does not prove the repair caused it.
//
// Pure — the admin route loads rows and stored graphs.

import type { ArgGraph, Owner } from "./argGraph";
import type { RepairKind } from "./argumentRepair";

export interface RepairRow {
  user_id: string;
  debate_id: string;
  target_kind: string;
  score: number;
  succeeded: boolean;
  created_at: string;
}

/** Weakness counts per debate, keyed by weakness kind (side-scoped). */
export interface DebateWeaknessRow {
  debateId: string;
  userId: string;
  completedAt: string;
  kinds: Record<string, number>;
}

export type RepairOutcome =
  | "improved"
  | "unchanged"
  | "worse"
  | "not-currently-measurable"
  | "not-yet-measurable"
  | "insufficient-baseline";

export interface RepairOutcomeDetail {
  target_kind: string;
  debate_id: string;
  created_at: string;
  outcome: RepairOutcome;
  beforeRate: number | null;
  afterRate: number | null;
  beforeDebates: number;
  afterDebates: number;
  /** The first later debate (the deliberate retest) and whether the weakness recurred there. */
  firstRetest?: { debateId: string; weaknessPresent: boolean } | null;
}

export interface RepairKindEffectiveness {
  target_kind: string;
  repairs: number;
  measurable: number;
  improved: number;
  unchanged: number;
  worse: number;
  /** improvement share among measurable repairs, or null below thresholds */
  improvedRate: number | null;
  /** Deliberate-retest evidence: did the weakness recur in the first later debate? */
  retest: RetestStats;
  note: string | null;
}

export interface RepairEffectivenessReport {
  generatedAt: string;
  windowDays: number;
  totalRepairs: number;
  usersCovered: number;
  perKind: RepairKindEffectiveness[];
  overall: RepairKindEffectiveness;
  honestyNote: string;
}

export const REPAIR_WINDOW_DAYS = 30;
/** A kind's summary needs this many measurable repairs before any rate. */
export const REPAIR_MIN_SAMPLE = 5;
/** And at least this many of them must actually be measurable. */
export const REPAIR_MIN_MEASURABLE = 3;

export interface RetestStats {
  repairsWithRetest: number;
  /** Share of first retests where the same weakness recurred; null below threshold. */
  firstRetestWeaknessRate: number | null;
  note: string | null;
}

/**
 * Repair kinds with NO genuine deterministic weakness detector in the stored
 * argument graph. These repairs are hard-classified "not currently
 * measurable" and can never enter the improved/unchanged/worse comparison —
 * not even by accidentally comparing 0% vs 0%.
 */
export const NOT_CURRENTLY_MEASURABLE_KINDS: ReadonlySet<string> = new Set(["clarity"]);

/**
 * Which observable weakness kinds a repair kind maps to. Every mapped kind
 * must have a side-scoped deterministic detector in `countWeaknessesForSide`;
 * kinds without one must be listed in NOT_CURRENTLY_MEASURABLE_KINDS.
 *
 * Audit (deterministic detector per kind):
 * - evidence   → unsupported-claim detector (unsupportedClaimIds ∩ own claims) ✓
 * - rebuttal   → dropped-argument detector (own claims the opponent never answered) ✓
 * - logic      → fallacy detector (deterministic classification above the
 *                confidence threshold, tagged on own nodes) ✓
 * - impact     → own-impact detector (debate contains no impact node owned by
 *                the user) ✓
 * - structure  → dropped-argument + self-contradiction detectors (own nodes) ✓
 * - clarity    → NO detector (subjective wording quality) — not measurable
 */
export function weaknessKindsFor(kind: string): string[] {
  switch (kind as RepairKind) {
    case "evidence":
      return ["evidence"];
    case "rebuttal":
      return ["rebuttal", "dropped"];
    case "logic":
      return ["logic"];
    case "impact":
      return ["impact"];
    case "structure":
      return ["dropped", "contradiction"];
    case "clarity":
      return ["clarity"];
    default:
      return [kind];
  }
}

/**
 * Side-scoped weakness counts from a merged argument graph. Only the owner's
 * own nodes can produce a weakness — the opponent's dropped arguments or
 * fallacies say nothing about the user. `clarity` is always 0 because no
 * deterministic clarity detector exists; clarity repairs are excluded from
 * effectiveness measurement via NOT_CURRENTLY_MEASURABLE_KINDS.
 */
export function countWeaknessesForSide(graph: ArgGraph, owner: Owner): Record<string, number> {
  const ownIds = new Set(graph.nodes.filter((n) => n.owner === owner).map((n) => n.id));
  const ownClaims = graph.nodes.filter(
    (n) => n.owner === owner && (n.kind === "claim" || n.kind === "counterclaim"),
  );
  const unsupported = graph.evidenceStats.unsupportedClaimIds.filter((id) => ownIds.has(id)).length;
  const dropped = graph.dropped.filter((d) => d.owner === owner).length;
  const contradictions = graph.contradictions.filter((c) => c.owner === owner).length;
  const ownImpacts = graph.nodes.filter((n) => n.owner === owner && n.kind === "impact").length;

  return {
    // Unsupported claims the user made (evidence weakness).
    evidence: unsupported,
    // Rebuttal proxy: the opponent left user arguments unanswered.
    rebuttal: dropped > 0 ? 1 : 0,
    // Fallacies flagged on the user's own nodes.
    logic: graph.fallacies.filter((f) => ownIds.has(f.nodeId)).length,
    // No deterministic detector — kept at 0 and excluded upstream.
    clarity: 0,
    // Weakness present when the user made no explicit impact move at all.
    impact: ownImpacts === 0 ? 1 : 0,
    // Structural failures on the user's own side.
    dropped,
    // Concessions are tracked for completeness, not used by any repair kind.
    concession: graph.concessions.filter((c) => c.by === owner).length,
    contradiction: contradictions,
    // Major-claim volume gives "opportunity" context (not a weakness itself).
    majorClaims: ownClaims.length,
  };
}

function dayMs(iso: string): number {
  return Date.parse(iso);
}

function weaknessPresent(debate: DebateWeaknessRow, kinds: string[]): boolean {
  return kinds.some((k) => (debate.kinds[k] ?? 0) > 0);
}

/**
 * Classify one repair: presence of the mapped weakness kinds in the user's
 * debates in the window before vs after the repair (excluding the repaired
 * debate itself and any debate still awaiting scoring). Kinds without a
 * deterministic detector are "not currently measurable" by construction.
 */
export function classifyRepair(
  repair: RepairRow,
  debates: DebateWeaknessRow[],
  opts: { windowDays?: number } = {},
): RepairOutcomeDetail {
  if (NOT_CURRENTLY_MEASURABLE_KINDS.has(repair.target_kind)) {
    return {
      target_kind: repair.target_kind,
      debate_id: repair.debate_id,
      created_at: repair.created_at,
      outcome: "not-currently-measurable",
      beforeRate: null,
      afterRate: null,
      beforeDebates: 0,
      afterDebates: 0,
    };
  }

  const windowDays = opts.windowDays ?? REPAIR_WINDOW_DAYS;
  const kinds = weaknessKindsFor(repair.target_kind);
  const t = dayMs(repair.created_at);
  const cutoffBefore = t - windowDays * 86_400_000;
  const cutoffAfter = t + windowDays * 86_400_000;

  const mine = debates.filter((d) => d.userId === repair.user_id && d.debateId !== repair.debate_id);
  const before = mine.filter(
    (d) => dayMs(d.completedAt) >= cutoffBefore && dayMs(d.completedAt) < t,
  );
  const after = mine.filter(
    (d) => dayMs(d.completedAt) > t && dayMs(d.completedAt) <= cutoffAfter,
  );

  const beforeRate = before.length ? before.filter((d) => weaknessPresent(d, kinds)).length / before.length : null;
  const afterRate = after.length ? after.filter((d) => weaknessPresent(d, kinds)).length / after.length : null;

  let outcome: RepairOutcome;
  if (!before.length || !after.length) {
    outcome = !after.length ? "not-yet-measurable" : "insufficient-baseline";
  } else if ((afterRate as number) < (beforeRate as number)) {
    outcome = "improved";
  } else if ((afterRate as number) > (beforeRate as number)) {
    outcome = "worse";
  } else {
    outcome = "unchanged";
  }

  // Retest linkage: the FIRST later debate that could express the weakness is
  // the deliberate retest; report whether the weakness appeared in it.
  const firstRetest = after[0];
  const retested = firstRetest ? weaknessPresent(firstRetest, kinds) : null;

  return {
    target_kind: repair.target_kind,
    debate_id: repair.debate_id,
    created_at: repair.created_at,
    outcome,
    beforeRate,
    afterRate,
    beforeDebates: before.length,
    afterDebates: after.length,
    firstRetest: firstRetest
      ? { debateId: firstRetest.debateId, weaknessPresent: retested as boolean }
      : null,
  };
}

function summarise(
  target_kind: string,
  details: RepairOutcomeDetail[],
  totalRepairs: number,
): RepairKindEffectiveness {
  const measurable = details.filter((d) => d.outcome === "improved" || d.outcome === "unchanged" || d.outcome === "worse");
  const improved = measurable.filter((d) => d.outcome === "improved").length;
  const unchanged = measurable.filter((d) => d.outcome === "unchanged").length;
  const worse = measurable.filter((d) => d.outcome === "worse").length;
  const canClaim = totalRepairs >= REPAIR_MIN_SAMPLE && measurable.length >= REPAIR_MIN_MEASURABLE;
  const notCurrentlyMeasurable = details.filter((d) => d.outcome === "not-currently-measurable").length;
  return {
    target_kind,
    repairs: totalRepairs,
    measurable: measurable.length,
    improved,
    unchanged,
    worse,
    improvedRate: canClaim && measurable.length ? +(improved / measurable.length).toFixed(3) : null,
    retest: retestStats(details),
    note: NOT_CURRENTLY_MEASURABLE_KINDS.has(target_kind)
      ? `not currently measurable — no deterministic ${target_kind} signal exists in the argument graph yet`
      : canClaim
        ? null
        : `not yet claimable — ${totalRepairs} repair${totalRepairs === 1 ? "" : "s"} recorded, ${measurable.length} measurable (need ${REPAIR_MIN_SAMPLE} total and ${REPAIR_MIN_MEASURABLE} measurable)${notCurrentlyMeasurable ? `; ${notCurrentlyMeasurable} not currently measurable` : ""}`,
  };
}

/**
 * Retest evidence: of the repairs with a measurable comparison, how many had
 * their first later debate within the window, and did the weakness recur in
 * that first retest? Rates only at REPAIR_MIN_MEASURABLE retests.
 */
function retestStats(details: RepairOutcomeDetail[]): RetestStats {
  const retested = details.filter((d) => d.firstRetest);
  const recurred = retested.filter((d) => d.firstRetest!.weaknessPresent).length;
  const measurable = retested.length >= REPAIR_MIN_MEASURABLE;
  return {
    repairsWithRetest: retested.length,
    firstRetestWeaknessRate: measurable ? +(recurred / retested.length).toFixed(3) : null,
    note: measurable
      ? null
      : `first-retest rate pending — ${retested.length} repair${retested.length === 1 ? "" : "s"} have had a retest (need ${REPAIR_MIN_MEASURABLE})`,
  };
}

/**
 * Build the aggregate report. Repairs whose debates/kinds cannot be observed
 * are classified explicitly ("not-yet-measurable", "insufficient-baseline",
 * "not-currently-measurable"), never silently dropped.
 */
export function buildRepairEffectiveness(
  repairs: RepairRow[],
  debates: DebateWeaknessRow[],
  opts: { now?: string; windowDays?: number } = {},
): RepairEffectivenessReport {
  const now = opts.now ?? new Date().toISOString();
  const details = repairs.map((r) => classifyRepair(r, debates, { windowDays: opts.windowDays }));

  const kinds = [...new Set(repairs.map((r) => r.target_kind))];
  const perKind = kinds
    .map((kind) => summarise(kind, details.filter((d) => d.target_kind === kind), repairs.filter((r) => r.target_kind === kind).length))
    .sort((a, b) => b.repairs - a.repairs);
  const overall = summarise("all", details, repairs.length);

  return {
    generatedAt: now,
    windowDays: opts.windowDays ?? REPAIR_WINDOW_DAYS,
    totalRepairs: repairs.length,
    usersCovered: new Set(repairs.map((r) => r.user_id)).size,
    perKind,
    overall,
    honestyNote:
      "Observational only: this compares weakness presence in debates before vs after a repair. It is an association, not proof the repair caused the change — users who repair may also differ in other ways.",
  };
}
