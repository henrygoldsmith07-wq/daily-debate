import { RETEST_OUTCOME_LABELS, type RepairRecord, type RetestOutcome } from "./retest";

/**
 * Per-debate loop state for the History list: did this debate's weakness get
 * repaired, and did this debate carry a finished retest verdict?
 *
 * Honesty rules (docs/roadmap.md, retestDisclosure.ts):
 * - A retest that has not produced a stored verdict yields NOTHING. History
 *   must never reveal that a debate is (or was) the silent test before it has
 *   finished, and must never name the skill under test.
 * - Verdict wording is the shared RETEST_OUTCOME_LABELS vocabulary, so History
 *   cannot say more than the result card did (no pass/fail inflation).
 * - Only stored rows count; nothing is inferred from scores.
 */
export interface HistoryLoopState {
  repair: "repaired" | "attempted" | null;
  retest: { outcome: RetestOutcome; label: string } | null;
}

type JourneyRepair = Pick<RepairRecord, "debate_id" | "succeeded" | "retest_debate_id" | "retest_outcome">;

export function historyLoopFor(debateId: string, repairs: readonly JourneyRepair[]): HistoryLoopState {
  const mine = repairs.filter((r) => r.debate_id === debateId);
  const repair: HistoryLoopState["repair"] = mine.length
    ? mine.some((r) => r.succeeded)
      ? "repaired"
      : "attempted"
    : null;
  const tested = repairs.find((r) => r.retest_debate_id === debateId && r.retest_outcome);
  const outcome = tested?.retest_outcome ?? null;
  return {
    repair,
    retest: outcome ? { outcome, label: RETEST_OUTCOME_LABELS[outcome] } : null,
  };
}

export function historyLoopMap(
  debateIds: readonly string[],
  repairs: readonly JourneyRepair[],
): Map<string, HistoryLoopState> {
  const map = new Map<string, HistoryLoopState>();
  for (const id of debateIds) {
    const state = historyLoopFor(id, repairs);
    if (state.repair || state.retest) map.set(id, state);
  }
  return map;
}
