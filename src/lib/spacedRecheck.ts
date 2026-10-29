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

/** Minimum eligible repairs before a re-check funnel is reported as a rate. */
export const RECHECK_MIN_SAMPLE = 20;

export interface RecheckFunnel {
  eligible: number;
  waiting: number;
  due: number;
  expired: number;
  /** insufficient_evidence until RECHECK_MIN_SAMPLE eligible repairs exist. */
  evidence: "insufficient_evidence" | "reported";
  /** Share of eligible re-checks that expired unused; null when gated. */
  expiredShare: number | null;
}

/** Funnel over stored skill-observed retests (counts only; no durability claim). */
export function recheckFunnel(repairs: readonly RecheckInput[], now: Date): RecheckFunnel {
  const f = { eligible: 0, waiting: 0, due: 0, expired: 0 };
  for (const r of repairs) {
    const s = recheckStatus(r, now).state;
    if (s === "not-scheduled") continue;
    f.eligible += 1;
    f[s] += 1;
  }
  const ok = f.eligible >= RECHECK_MIN_SAMPLE;
  return { ...f, evidence: ok ? "reported" : "insufficient_evidence", expiredShare: ok ? f.expired / f.eligible : null };
}

/**
 * Pick the re-check motion: a fresh motion (never the original debate's or the
 * retest's) so durability is not just memory of a prior argument. Deterministic
 * per repair so a refresh shows the same motion. Returns null when no fresh
 * candidate exists (the re-check then stays unscheduled rather than reusing one).
 */
export function pickRecheckMotion(
  candidates: readonly string[],
  usedMotions: readonly string[],
  seed: string,
): string | null {
  const used = new Set(usedMotions.map((m) => m.trim().toLowerCase()));
  const fresh = [...new Set(candidates.map((c) => c.trim()))].filter((c) => c && !used.has(c.toLowerCase())).sort();
  if (fresh.length === 0) return null;
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return fresh[h % fresh.length];
}

export interface RecheckPlan {
  repairId: string;
  motion: string;
  label: string;
}

/**
 * Plan for starting a due re-check: the oldest due repair plus a fresh motion.
 * Returns null when nothing is due or no fresh motion exists (never reuses one).
 */
export function planRecheck<T extends RecheckInput & { id: string }>(
  repairs: readonly T[],
  candidates: readonly string[],
  usedMotionsByRepair: Readonly<Record<string, readonly string[]>>,
  now: Date,
): RecheckPlan | null {
  const due = nextDueRecheck(repairs, now);
  if (!due) return null;
  const motion = pickRecheckMotion(candidates, usedMotionsByRepair[due.id] ?? [], due.id);
  if (!motion) return null;
  return { repairId: due.id, motion, label: "7-day re-check (unvalidated)" };
}

export type DurableGainOutcome = "durable" | "not-durable" | "inconclusive";

/**
 * Classify a completed re-check from the STORED skill verdict only. A skill
 * that did not show up again as a weakness is "durable"; a recurrence is
 * "not-durable"; anything else (missing, unscored, insufficient) stays
 * "inconclusive". One observation, never a validated claim.
 */
export function durableGainOutcome(verdict: string | null | undefined): DurableGainOutcome {
  if (verdict === "skill-observed") return "durable";
  if (verdict === "weakness-recurred") return "not-durable";
  return "inconclusive";
}

export interface DurableGainSummary {
  durable: number;
  notDurable: number;
  inconclusive: number;
  evidence: "insufficient_evidence" | "reported";
  /** Durable share of conclusive re-checks; null until the sample gate passes. */
  durableShare: number | null;
}

export function summariseDurableGain(verdicts: ReadonlyArray<string | null | undefined>): DurableGainSummary {
  const s = { durable: 0, notDurable: 0, inconclusive: 0 };
  for (const v of verdicts) {
    const o = durableGainOutcome(v);
    if (o === "durable") s.durable += 1;
    else if (o === "not-durable") s.notDurable += 1;
    else s.inconclusive += 1;
  }
  const conclusive = s.durable + s.notDurable;
  const ok = conclusive >= RECHECK_MIN_SAMPLE;
  return { ...s, evidence: ok ? "reported" : "insufficient_evidence", durableShare: ok ? s.durable / conclusive : null };
}
