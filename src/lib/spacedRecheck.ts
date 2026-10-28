import type { RepairRecord } from "./retest";

/**
 * Spaced second retest (M9): after a retest where the repaired skill was
 * observed, a 7-day re-check asks whether the gain is durable.
 *
 * Honesty rules (docs/roadmap.md): one observed retest is not proof; the
 * re-check is labelled unvalidated and is only scheduled from a STORED
 * "skill-observed" verdict. Nothing is inferred from scores.
 */
export const RECHECK_DELAY_DAYS = 7;
export const RECHECK_EXPIRY_DAYS = 14;
const DAY_MS = 86_400_000;

export type RecheckState = "not-scheduled" | "waiting" | "due" | "expired";

export interface RecheckStatus {
  state: RecheckState;
  /** ISO time the re-check becomes available (null when not scheduled). */
  dueAt: string | null;
  /** Days left until due (waiting), whole days rounded up. */
  daysUntilDue: number | null;
}

type RecheckInput = Pick<RepairRecord, "retest_outcome" | "retest_completed_at"> & {
  recheck_debate_id?: string | null;
};

export function recheckStatus(repair: RecheckInput, now: Date): RecheckStatus {
  const none: RecheckStatus = { state: "not-scheduled", dueAt: null, daysUntilDue: null };
  if (repair.retest_outcome !== "skill-observed" || repair.recheck_debate_id) return none;
  const done = repair.retest_completed_at ? Date.parse(repair.retest_completed_at) : NaN;
  if (!Number.isFinite(done) || !Number.isFinite(now.getTime())) return none;
  const due = done + RECHECK_DELAY_DAYS * DAY_MS;
  const dueAt = new Date(due).toISOString();
  if (now.getTime() < due) {
    return { state: "waiting", dueAt, daysUntilDue: Math.ceil((due - now.getTime()) / DAY_MS) };
  }
  if (now.getTime() >= done + RECHECK_EXPIRY_DAYS * DAY_MS) return { state: "expired", dueAt, daysUntilDue: null };
  return { state: "due", dueAt, daysUntilDue: 0 };
}

/** The oldest due re-check, if any (oldest first so none starve). */
export function nextDueRecheck<T extends RecheckInput>(repairs: readonly T[], now: Date): T | null {
  const due = repairs
    .filter((r) => recheckStatus(r, now).state === "due")
    .sort((a, b) => Date.parse(a.retest_completed_at ?? "") - Date.parse(b.retest_completed_at ?? ""));
  return due[0] ?? null;
}

export function recheckCopy(status: RecheckStatus): string | null {
  if (status.state === "due") return "Your 7-day re-check is ready: does the repaired skill still show up? (unvalidated)";
  if (status.state === "waiting" && status.daysUntilDue !== null) {
    return `Re-check unlocks in ${status.daysUntilDue} day${status.daysUntilDue === 1 ? "" : "s"}.`;
  }
  return null;
}
