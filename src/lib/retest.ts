// Deliberate retest tracking — the spine of the learning loop.
//
// The product loop is: debate → one weakness → repair → deliberate retest on
// a DIFFERENT topic → longitudinal evidence. This module owns the rules that
// make the retest legible and honest:
//
//   - a repair queues a retest; the UI can say "this debate is a retest of
//     rebuttal, repaired after Tuesday's debate";
//   - a retest MUST use a different topic from the repaired debate, so a
//     matching skill move is transfer, not memory;
//   - at the end of a retest the outcome is one of exactly four truthful
//     states, never a mastery claim;
//   - repeated evidence may earn longitudinal language ("appearing in 3 of
//     your last 4 eligible debates") but one success never does.
//
// Measurement semantics reuse the canonical detectors (repairEffectiveness /
// opportunity.ts) — no second definition of "the weakness was present" or
// "an opportunity existed". Pure; routes persist.

import type { ArgGraph, Owner } from "./argGraph";
import { countWeaknessesForSide, debateOpportunities, hasOpportunity, weaknessKindsFor, type DebateWeaknessRow } from "./repairEffectiveness";
import { isRepairKind, repairStateFromScore, type RepairKind, type RepairState } from "./argumentRepair";

export type { RepairState, RepairKind };

export type RepairFormativeState = RepairState;

export type RetestOutcome =
  | "skill-observed"
  | "skill-not-observed"
  | "no-valid-opportunity"
  | "not-enough-evidence";

export const RETEST_OUTCOME_LABELS: Record<RetestOutcome, string> = {
  "skill-observed": "Skill observed in this retest",
  "skill-not-observed": "Skill not observed this time",
  "no-valid-opportunity": "No valid opportunity occurred",
  "not-enough-evidence": "Not enough evidence to judge",
};

export interface RepairRecord {
  id: string;
  user_id: string;
  debate_id: string;
  target_kind: RepairKind | string;
  source_text: string;
  rewrite_text: string;
  score: number;
  succeeded: boolean;
  created_at: string;
  retest_debate_id?: string | null;
  retest_outcome?: RetestOutcome | null;
  retest_completed_at?: string | null;
}

/**
 * Formative repair state, delegated to the canonical scorer vocabulary
 * (argumentRepair) — one definition across the repair flow, Progress and the
 * skill journey. `succeeded` is an explicit attempt-level outcome, so a
 * successful rewrite always reads repair_demonstrated regardless of score.
 */
export function formativeStateFor(score: number, succeeded: boolean): RepairState {
  return succeeded ? "repair_demonstrated" : repairStateFromScore(score);
}

export const FORMATIVE_STATE_LABELS: Record<RepairState, string> = {
  needs_another_pass: "Needs another pass",
  partially_repaired: "Partially repaired",
  repair_demonstrated: "Repair demonstrated",
};

export const FORMATIVE_STATE_DETAIL: Record<RepairState, string> = {
  needs_another_pass: "The rewrite hasn't added the missing component yet.",
  partially_repaired: "One part of the move is fixed; the rest is still missing.",
  repair_demonstrated: "The rewrite contains the missing component.",
};

/**
 * The formative check: what observable component of the target move is still
 * missing? `missingSignals` are the satisfied-component cues from the repair
 * scorer that the rewrite did NOT hit. One state per submission, one gap —
 * never a pile of simultaneous complaints.
 */
export function formativeCheck(
  score: number,
  succeeded: boolean,
  missingSignals: string[],
): { state: RepairFormativeState; missing: string | null } {
  const state = formativeStateFor(score, succeeded);
  return { state, missing: missingSignals[0] ?? null };
}

/** One clean sentence explaining WHY the weakness weakens the argument. */
export const WEAKNESS_CONSEQUENCE: Record<string, string> = {
  evidence: "Without a named source, a listener can dismiss the claim as an opinion — however true it is.",
  rebuttal: "An unanswered counterargument stays standing; judges count what survives, not what was meant.",
  logic: "A skipped reasoning step is exactly where an opponent inserts their counterexample.",
  impact: "A point that never says what changes hands the weighing to the other side.",
  structure: "A contradiction or dropped thread gives the other side a free win they didn't have to earn.",
  clarity: "When the claim and its reason blur together, neither gets credit.",
};

/**
 * Was the repaired weakness absent in the retest? Reads the same canonical
 * weakness counters every other layer uses (side-scoped to the user).
 */
export function weaknessPresentIn(
  graph: ArgGraph,
  owner: Owner,
  repairKind: string,
): boolean {
  if (!isRepairKind(repairKind)) return false;
  const kinds = weaknessKindsFor(repairKind);
  const counts = countWeaknessesForSide(graph, owner);
  return kinds.some((k) => (counts[k] ?? 0) > 0);
}

/**
 * The four truthful retest outcomes. `retest` is the retest debate's weakness
 * row (kinds + opportunity counts); `graph` is its merged assessment graph
 * (needed for the presence check). Sprint-format retests are "not enough
 * evidence": a 3-round sample can't separate "used the skill" from "never
 * faced the situation", so we say so instead of guessing.
 */
export function retestOutcomeFor(
  repair: { target_kind: string },
  retest: DebateWeaknessRow,
  graph: ArgGraph,
  owner: Owner,
  opts: { format?: "sprint" | "full" } = {},
): RetestOutcome {
  if (!hasOpportunity(repair.target_kind, retest)) return "no-valid-opportunity";
  if (opts.format === "sprint") return "not-enough-evidence";
  return weaknessPresentIn(graph, owner, repair.target_kind)
    ? "skill-not-observed"
    : "skill-observed";
}

export interface RetestNarrative {
  outcome: RetestOutcome;
  label: string;
  /** Plain-language explanation of what was actually observed. */
  detail: string;
  /** Eligible debates observed since the repair (the retest included). */
  eligibleObservations: number;
  /** Among those, how many showed the behaviour. */
  observedCount: number;
  /** True once the sample supports longitudinal language (>=3 eligible). */
  longitudinal: boolean;
  /** Wording for "is this skill appearing more consistently over time?" */
  consistencyLine: string | null;
}

/** Minimum eligible observations before any consistency language. */
export const LONGITUDINAL_MIN_OBSERVATIONS = 3;

/**
 * Post-retest narrative: the outcome of THIS retest plus, only when the
 * sample supports it, how the behaviour has looked across later debates.
 * Never claims mastery; observational wording throughout.
 */
export function retestNarrative(
  outcome: RetestOutcome,
  observation: { eligible: boolean; observed: boolean; at: string }[],
): RetestNarrative {
  const eligible = observation.filter((o) => o.eligible);
  const observed = eligible.filter((o) => o.observed);
  const longitudinal = eligible.length >= LONGITUDINAL_MIN_OBSERVATIONS;
  const n = eligible.length;
  const k = observed.length;
  let consistencyLine: string | null = null;
  if (longitudinal) {
    consistencyLine =
      k === n
        ? `Across ${n} eligible debates since your repair, the behaviour appeared every time (${k} of ${n}). Keep testing it — consistency is what turns a repair into a habit.`
        : k === 0
          ? `Across ${n} eligible debates since your repair, the behaviour hasn't appeared yet (0 of ${n}). That's a signal to practise it deliberately, not a verdict.`
          : `Across ${n} eligible debates since your repair, the behaviour appeared in ${k} of ${n}. Early evidence of a pattern — not yet proof it will hold.`;
  }
  return {
    outcome,
    label: RETEST_OUTCOME_LABELS[outcome],
    detail: RETEST_OUTCOME_DETAIL[outcome],
    eligibleObservations: n,
    observedCount: k,
    longitudinal,
    consistencyLine,
  };
}

export const RETEST_OUTCOME_DETAIL: Record<RetestOutcome, string> = {
  "skill-observed": "The repaired behaviour appeared on its own, without prompting. One observation — the next eligible debates are what make it a pattern.",
  "skill-not-observed": "The situation came up and the behaviour didn't appear this time. One debate is a small sample; the skill stays on your training list.",
  "no-valid-opportunity": "This debate never gave you the chance to show the skill, so it says nothing about whether the repair stuck.",
  "not-enough-evidence": "This session was too short to judge the skill fairly. A full debate gives the behaviour room to appear.",
};

/**
 * The transition copy after a successful repair: what happens next, and why
 * the retest must come on a different topic.
 */
export function repairSuccessTransition(repairKind: string, label: string): {
  headline: string;
  body: string;
} {
  return {
    headline: "Repair demonstrated. Now prove you can use it without prompting.",
    body: `Daily Debate will deliberately test ${label.toLowerCase()} in a later, different-topic debate — no reminder, no cue. Using it there is what counts: a skill you only show when prompted isn't yours yet.`,
  };
}

/** Different-topic rule: a retest may never reuse the repaired debate's topic. */
export function retestTopicIsEligible(retestTopicId: string, repairedTopicId: string | null | undefined): boolean {
  return !repairedTopicId || retestTopicId !== repairedTopicId;
}

/** The one open loop for a user, highest priority first: the oldest unreteted successful repair. */
export function pickPendingRetest(repairs: RepairRecord[]): RepairRecord | null {
  const pending = repairs
    .filter((r) => r.succeeded && !r.retest_debate_id)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  return pending[0] ?? null;
}

/** Unfinished repair: a debate with a weakness but no completed repair. */
export function pickUnfinishedRepair(
  repairs: RepairRecord[],
  debatesWithWeakness: Array<{ debate_id: string; kind: string; created_at: string }>,
): { debateId: string; kind: string } | null {
  const repairedDebates = new Set(repairs.map((r) => r.debate_id));
  const open = debatesWithWeakness
    .filter((d) => !repairedDebates.has(d.debate_id))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return open[0] ? { debateId: open[0].debate_id, kind: open[0].kind } : null;
}

/** Opportunity volume for one completed debate (used by the retest verdict UI). */
export function opportunityCounts(graph: ArgGraph, owner: Owner): { majorClaims: number; opponentMoves: number } {
  return debateOpportunities(graph, owner);
}
