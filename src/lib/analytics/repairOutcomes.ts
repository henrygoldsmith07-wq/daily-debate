// The longitudinal training-loop outcome funnel.
//
// One joined view over the full learning chain:
//
//   weakness detected -> repair offered -> first successful rewrite ->
//   explicit repair_retests assignment -> recurrence / no recurrence ->
//   later retention
//
// Strictly OBSERVATIONAL (same honesty rule as retention.ts): users who
// repair differ from those who do not, so every number here is an association
// with explicit denominators, sample sizes and missing-data counts - never
// evidence that a repair caused a change.
//
// Two measurement disciplines are load-bearing: retries are collapsed into
// ONE repair episode per (user, debate, kind), so retrying can never inflate a
// denominator or fake an intervention cutoff; and a repair is only compared
// when the user has LATER debates that could express the weakness, otherwise
// it stays "not yet measurable" rather than being assumed clean.

import {
  collapseRepairAttempts,
  hasOpportunity,
  weaknessKindsFor,
  type DebateWeaknessRow,
  type RepairRetestAnalyticsRow,
  type RepairRow,
} from "../repairEffectiveness";
import type { RepairKind } from "../argumentRepair";
import { type FunnelEventRow, type FunnelRate } from "./events";
import { returnRateAfterAnchor, type ReturnRate } from "./retention";

export const REPAIR_OUTCOME_MIN_SAMPLE = 5;

/** True when any of the repaired weakness kinds is present in a debate's counts. */
function weaknessPresent(kinds: Record<string, number>, wanted: string[]): boolean {
  return wanted.some((k) => (kinds[k] ?? 0) > 0);
}

export interface RepairOutcomeRow {
  userId: string;
  debateId: string;
  targetKind: RepairKind;
  createdAt: string;
  /** A repair_started event exists for the same user+debate at/before completion. */
  accepted: boolean;
  /** Whole days from first successful repair to the explicit durable retest. */
  daysToRetest: number | null;
  firstRetestDebateId: string | null;
  /** Whether the repaired weakness kinds recurred in the first retest. */
  firstRetestRecurred: boolean | null;
  /**
   * Chronological per-retest recurrence flags over every ELIGIBLE later
   * debate (the exposure base). length === eligibleRetests.
   */
  retestRecurrences: boolean[];
  /** 1-based index of the first recurring eligible retest; null = none observed. */
  firstRecurrenceAtRetest: number | null;
  /** Whole days from repair to the first recurring eligible retest; null = none. */
  daysToFirstRecurrence: number | null;
  /** Recurrences among eligible retests AFTER the first (density numerator). */
  recurrencesAfterFirst: number;
  /** Eligible retests after the first (density denominator); 0 until a 2nd exists. */
  retestsAfterFirst: number;
  /** Recurrence within the first 3 eligible retests; null while exposure < 3. */
  recurredWithinFirstThree: boolean | null;
  /** Eligible later debates (the retest denominator for this repair). */
  eligibleRetests: number;
}

export interface RepairOutcomeFunnel {
  /** Raw persisted rewrite submissions. */
  attempts: number;
  /** Distinct successful (user, debate, target-kind) repair episodes. */
  repairs: number;
  /** Episodes that never crossed the repair threshold; excluded from effectiveness/retest outcomes. */
  failedOnlyRepairs: number;
  /** Raw attempts beyond the first within an episode. */
  retryAttemptsCollapsed: number;
  /** Repairs with a matching repair_started event (acceptance proxy). */
  acceptance: FunnelRate;
  /** repair_started events without a debate_id that cannot be matched. */
  unmatchedStarts: number;
  /** Successful repairs with an explicit durable retest assignment. */
  retestsObserved: number;
  /** Successful repairs with no explicit durable retest yet. */
  retestsPending: number;
  medianDaysToRetest: number | null;
  /** PRIMARY outcome: first-retest recurrence among observed retests. */
  firstRetestRecurrence: FunnelRate;
  /**
   * Opportunity-adjusted density: recurrences among eligible retests AFTER
   * the first, divided by the number of those retests (pooled across repairs
   * with ≥2 eligible retests). Exposure-neutral: extra follow-up debates add
   * numerator AND denominator, so more retests never imply worse outcomes.
   */
  recurrencePerEligibleRetest: FunnelRate & { retestSlots: number };
  /**
   * Fixed-window recurrence: of the repairs with ≥3 eligible retests, how
   * many saw the weakness back within the first three. Repairs with less
   * exposure are counted, never guessed.
   */
  firstThreeExposure: FunnelRate & { belowWindow: number };
  /** Among repairs that recurred at some observed retest: median days to FIRST recurrence. */
  timeToFirstRecurrence: { medianDays: number | null; observedRepairs: number; censoredRepairs: number };
  /** Among the same repairs: median number of ELIGIBLE retests passed before recurrence. */
  opportunitiesBeforeRecurrence: { median: number | null };
  /** D1/D7/D30 return anchored at each user's first repair (not first activity). */
  postRepairReturn: { d1: ReturnRate; d7: ReturnRate; d30: ReturnRate };
  note: string;
}

export function buildRepairOutcomeRows(
  repairs: RepairRow[],
  debates: DebateWeaknessRow[],
  events: FunnelEventRow[],
  retests: RepairRetestAnalyticsRow[] = [],
): RepairOutcomeRow[] {
  const byUser = new Map<string, DebateWeaknessRow[]>();
  for (const d of debates) {
    const list = byUser.get(d.userId) ?? [];
    list.push(d);
    byUser.set(d.userId, list);
  }
  for (const list of byUser.values()) {
    list.sort((a, b) => Date.parse(a.completedAt) - Date.parse(b.completedAt));
  }
  const starts = events.filter((e) => e.name === "repair_started" && e.debate_id);
  const episodes = collapseRepairAttempts(repairs).filter(
    (episode) => episode.succeeded && episode.firstSuccessAt && episode.successfulRepairResultId,
  );
  const retestsByRepair = new Map<string, RepairRetestAnalyticsRow[]>();
  for (const retest of retests) {
    if (retest.observable !== true || !retest.completed_at) continue;
    const list = retestsByRepair.get(retest.repair_result_id) ?? [];
    list.push(retest);
    retestsByRepair.set(retest.repair_result_id, list);
  }
  for (const list of retestsByRepair.values()) {
    list.sort((a, b) => Date.parse(a.completed_at!) - Date.parse(b.completed_at!));
  }

  return episodes.map((repair) => {
    const kinds = weaknessKindsFor(repair.target_kind);
    const repairedAtIso = repair.firstSuccessAt!;
    const repairedAt = Date.parse(repairedAtIso);
    const accepted = starts.some(
      (e) =>
        e.user_id === repair.user_id &&
        e.debate_id === repair.debate_id &&
        Date.parse(e.created_at) <= repairedAt,
    );
    const deliberate = retestsByRepair.get(repair.successfulRepairResultId!)?.[0] ?? null;
    const first = deliberate
      ? (byUser.get(repair.user_id) ?? []).find((d) => d.debateId === deliberate.assigned_debate_id) ?? null
      : null;
    const deliberateCompletedAt = deliberate?.completed_at ? Date.parse(deliberate.completed_at) : null;
    // The first outcome is the explicitly assigned retest. After that point,
    // ordinary later opportunity-bearing debates are longitudinal follow-up
    // exposure, not re-labelled as the deliberate retest.
    const followups = deliberateCompletedAt === null
      ? []
      : (byUser.get(repair.user_id) ?? [])
          .filter((d) => d.debateId !== repair.debate_id && d.debateId !== deliberate?.assigned_debate_id)
          .filter((d) => Date.parse(d.completedAt) > deliberateCompletedAt)
          .filter((d) => hasOpportunity(repair.target_kind, d));
    const firstMeasurable = !!first && hasOpportunity(repair.target_kind, first);
    const exposure = firstMeasurable ? [first, ...followups] : [];
    const retestRecurrences = exposure.map((d) => weaknessPresent(d.kinds, kinds));
    const recurrenceIdx = retestRecurrences.indexOf(true);
    return {
      userId: repair.user_id,
      debateId: repair.debate_id,
      targetKind: repair.target_kind,
      createdAt: repairedAtIso,
      accepted,
      daysToRetest: deliberate?.completed_at
        ? Math.floor((Date.parse(deliberate.completed_at) - repairedAt) / 86_400_000)
        : null,
      firstRetestDebateId: deliberate?.assigned_debate_id ?? null,
      firstRetestRecurred: firstMeasurable ? retestRecurrences[0] : null,
      retestRecurrences,
      firstRecurrenceAtRetest: recurrenceIdx === -1 ? null : recurrenceIdx + 1,
      daysToFirstRecurrence:
        recurrenceIdx === -1
          ? null
          : Math.floor((Date.parse(exposure[recurrenceIdx].completedAt) - repairedAt) / 86_400_000),
      recurrencesAfterFirst: retestRecurrences.slice(1).filter(Boolean).length,
      retestsAfterFirst: Math.max(0, exposure.length - 1),
      recurredWithinFirstThree: exposure.length >= 3 ? retestRecurrences.slice(0, 3).some(Boolean) : null,
      eligibleRetests: exposure.length,
    };
  });
}

export function buildRepairOutcomeFunnel(
  repairs: RepairRow[],
  debates: DebateWeaknessRow[],
  events: FunnelEventRow[],
  opts: { now?: string; minSample?: number; retests?: RepairRetestAnalyticsRow[] } = {},
): RepairOutcomeFunnel {
  const now = opts.now ?? new Date().toISOString();
  const minSample = opts.minSample ?? REPAIR_OUTCOME_MIN_SAMPLE;
  const attemptedEpisodes = collapseRepairAttempts(repairs);
  const successfulEpisodes = attemptedEpisodes.filter(
    (episode) => episode.succeeded && episode.firstSuccessAt && episode.successfulRepairResultId,
  );
  const rows = buildRepairOutcomeRows(repairs, debates, events, opts.retests ?? []);
  const withRetest = rows.filter((r) => r.firstRetestDebateId !== null);
  const measuredFirstRetests = withRetest.filter((r) => r.firstRetestRecurred !== null);
  const medianDaysToRetest = medianNumbers(withRetest.map((r) => r.daysToRetest as number));
  const starts = events.filter((e) => e.name === "repair_started" && e.debate_id);
  const acceptedCount = attemptedEpisodes.filter((repair) =>
    starts.some(
      (event) =>
        event.user_id === repair.user_id &&
        event.debate_id === repair.debate_id &&
        Date.parse(event.created_at) <= Date.parse(repair.firstAttemptAt),
    ),
  ).length;
  const firstRecurred = measuredFirstRetests.filter((r) => r.firstRetestRecurred).length;
  const unmatchedStarts = events.filter((e) => e.name === "repair_started" && !e.debate_id).length;

  // Opportunity-adjusted density across eligible retests AFTER the first.
  const densityRows = rows.filter((r) => r.retestsAfterFirst >= 1);
  const retestSlots = densityRows.reduce((s, r) => s + r.retestsAfterFirst, 0);
  const recurrencesInSlots = densityRows.reduce((s, r) => s + r.recurrencesAfterFirst, 0);

  // Fixed-window (first 3) recurrence, restricted to repairs that HAVE 3+
  // eligible retests — shorter exposure is reported separately, never guessed.
  const window3 = rows.filter((r) => r.recurredWithinFirstThree !== null);
  const within3Recurred = window3.filter((r) => r.recurredWithinFirstThree).length;
  const belowWindow3 = measuredFirstRetests.length - window3.length;

  // Time to first recurrence among repairs that recurred at some point;
  // the rest are censored (observed retests, no recurrence yet).
  const recurred = rows.filter((r) => r.firstRecurrenceAtRetest !== null);
  const censored = measuredFirstRetests.filter((r) => r.firstRecurrenceAtRetest === null).length;

  // Post-repair return: anchor each user at their FIRST repair completion.
  const anchors = new Map<string, string>();
  const sortedRepairs = [...successfulEpisodes].sort((a, b) => Date.parse(a.firstSuccessAt!) - Date.parse(b.firstSuccessAt!));
  for (const r of sortedRepairs) {
    if (!anchors.has(r.user_id)) anchors.set(r.user_id, r.firstSuccessAt!);
  }

  return {
    attempts: repairs.length,
    repairs: rows.length,
    failedOnlyRepairs: attemptedEpisodes.length - successfulEpisodes.length,
    retryAttemptsCollapsed: Math.max(0, repairs.length - attemptedEpisodes.length),
    acceptance: {
      numerator: acceptedCount,
      denominator: attemptedEpisodes.length,
      sample: attemptedEpisodes.length,
      rate: attemptedEpisodes.length >= minSample ? +(acceptedCount / attemptedEpisodes.length).toFixed(3) : null,
      note: attemptedEpisodes.length >= minSample
        ? null
        : `not yet measurable — ${attemptedEpisodes.length} attempted repair episode${attemptedEpisodes.length === 1 ? "" : "s"} (need ${minSample})`,
    },
    unmatchedStarts,
    retestsObserved: withRetest.length,
    retestsPending: rows.length - withRetest.length,
    medianDaysToRetest,
    firstRetestRecurrence: {
      numerator: firstRecurred,
      denominator: measuredFirstRetests.length,
      sample: measuredFirstRetests.length,
      rate: measuredFirstRetests.length >= minSample ? +(firstRecurred / measuredFirstRetests.length).toFixed(3) : null,
      note: measuredFirstRetests.length >= minSample
        ? null
        : `not yet measurable — ${measuredFirstRetests.length} explicit retest${measuredFirstRetests.length === 1 ? "" : "s"} have loaded weakness evidence (need ${minSample})`,
    },
    recurrencePerEligibleRetest: {
      numerator: recurrencesInSlots,
      denominator: retestSlots,
      sample: densityRows.length,
      retestSlots,
      rate: densityRows.length >= minSample && retestSlots > 0 ? +(recurrencesInSlots / retestSlots).toFixed(3) : null,
      note: densityRows.length >= minSample
        ? `pooled over ${retestSlots} eligible retests (2nd+) from ${densityRows.length} repairs`
        : `not yet measurable — ${densityRows.length} repairs have a 2nd eligible retest (need ${minSample})`,
    },
    firstThreeExposure: {
      numerator: within3Recurred,
      denominator: window3.length,
      sample: window3.length,
      belowWindow: belowWindow3,
      rate: window3.length >= minSample ? +(within3Recurred / window3.length).toFixed(3) : null,
      note: window3.length >= minSample
        ? `${belowWindow3} repair${belowWindow3 === 1 ? "" : "s"} have fewer than 3 eligible retests and are excluded, never guessed`
        : `not yet measurable — ${window3.length} repairs have 3+ eligible retests (need ${minSample})`,
    },
    timeToFirstRecurrence: {
      medianDays: medianNumbers(recurred.map((r) => r.daysToFirstRecurrence as number)),
      observedRepairs: recurred.length,
      censoredRepairs: censored,
    },
    opportunitiesBeforeRecurrence: {
      median: medianNumbers(recurred.map((r) => (r.firstRecurrenceAtRetest as number) - 1)),
    },
    postRepairReturn: {
      d1: returnRateAfterAnchor(events, anchors, 1, now, minSample),
      d7: returnRateAfterAnchor(events, anchors, 7, now, minSample),
      d30: returnRateAfterAnchor(events, anchors, 30, now, minSample),
    },
    note: "Observational only — users who complete repairs differ from those who don't. Failed-only repair episodes remain attempt/conversion history and never enter effectiveness denominators. Successful episodes are anchored at their first successful rewrite, and the primary retest is the explicit durable repair_retests assignment. Later opportunity-bearing debates are follow-up exposure only. Recurrence density and fixed-window measures remain opportunity-adjusted, and never-recurred repairs are censored rather than assumed clean.",
  };
}

function medianNumbers(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
