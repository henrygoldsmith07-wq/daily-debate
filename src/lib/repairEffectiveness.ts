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
// - A repair is only comparable when the user actually has later debates that
//   could express the weakness; otherwise it is "not yet measurable".
// - Summary rates need REPAIR_MIN_MEASURABLE measurable repairs AND
//   REPAIR_MIN_SAMPLE total repairs per kind; below that we say so.
// - The output is labelled observational: repair is associated with the
//   change, it does not prove the repair caused it.
//
// Pure — the admin route loads rows and stored graphs.

import type { RepairKind } from "./argumentRepair";

export interface RepairRow {
  user_id: string;
  debate_id: string;
  target_kind: string;
  score: number;
  succeeded: boolean;
  created_at: string;
}

/** Weakness counts per debate, keyed by weakness kind (from weaknessTracker). */
export interface DebateWeaknessRow {
  debateId: string;
  userId: string;
  completedAt: string;
  kinds: Record<string, number>;
}

export type RepairOutcome = "improved" | "unchanged" | "worse" | "not-yet-measurable" | "insufficient-baseline";

export interface RepairOutcomeDetail {
  target_kind: string;
  debate_id: string;
  created_at: string;
  outcome: RepairOutcome;
  beforeRate: number | null;
  afterRate: number | null;
  beforeDebates: number;
  afterDebates: number;
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

/**
 * Which observable weakness kinds a repair kind maps to. "clarity" has no
 * deterministic detector in the graph, so clarity repairs are honestly
 * reported as not measurable rather than guessed.
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

function dayMs(iso: string): number {
  return Date.parse(iso);
}

function weaknessPresent(debate: DebateWeaknessRow, kinds: string[]): boolean {
  return kinds.some((k) => (debate.kinds[k] ?? 0) > 0);
}

/**
 * Classify one repair: presence of the mapped weakness kinds in the user's
 * debates in the window before vs after the repair (excluding the repaired
 * debate itself and any debate still awaiting scoring).
 */
export function classifyRepair(
  repair: RepairRow,
  debates: DebateWeaknessRow[],
  opts: { windowDays?: number } = {},
): RepairOutcomeDetail {
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

  return {
    target_kind: repair.target_kind,
    debate_id: repair.debate_id,
    created_at: repair.created_at,
    outcome,
    beforeRate,
    afterRate,
    beforeDebates: before.length,
    afterDebates: after.length,
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
  return {
    target_kind,
    repairs: totalRepairs,
    measurable: measurable.length,
    improved,
    unchanged,
    worse,
    improvedRate: canClaim && measurable.length ? +(improved / measurable.length).toFixed(3) : null,
    note: canClaim
      ? null
      : `not yet claimable — ${totalRepairs} repair${totalRepairs === 1 ? "" : "s"} recorded, ${measurable.length} measurable (need ${REPAIR_MIN_SAMPLE} total and ${REPAIR_MIN_MEASURABLE} measurable)`,
  };
}

/**
 * Build the aggregate report. Repairs whose debates/kinds cannot be observed
 * are counted as "not-yet-measurable", never silently dropped.
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
