/**
 * M17 slice 1: when is the learner's next loop step due, and how overdue is it?
 * Pure logic for in-app reminders. Counts and dates only; no claim that a
 * reminder changes behaviour (unvalidated until sent-vs-acted is measured).
 */
const DAY_MS = 86_400_000;
/** A pending retest nudges after this long untouched; before that it is "fresh". */
export const RETEST_NUDGE_AFTER_HOURS = 20;

export interface ReminderInput {
  kind: "retest" | "recheck";
  /** ISO time the step became available. */
  availableAt: string;
}

export type ReminderTone = "none" | "ready" | "overdue";

export interface ReminderState {
  tone: ReminderTone;
  kind: ReminderInput["kind"] | null;
  /** Whole days since the step became available (0 when ready today). */
  daysWaiting: number;
}

export function reminderState(items: readonly ReminderInput[], now: Date): ReminderState {
  const none: ReminderState = { tone: "none", kind: null, daysWaiting: 0 };
  const t = now.getTime();
  if (!Number.isFinite(t)) return none;
  let best: { item: ReminderInput; at: number } | null = null;
  for (const item of items) {
    const at = Date.parse(item.availableAt);
    if (!Number.isFinite(at)) continue;
    const gate = item.kind === "retest" ? RETEST_NUDGE_AFTER_HOURS * 3_600_000 : 0;
    if (t < at + gate) continue;
    if (!best || at < best.at) best = { item, at };
  }
  if (!best) return none;
  const daysWaiting = Math.floor((t - best.at) / DAY_MS);
  return { tone: daysWaiting >= 2 ? "overdue" : "ready", kind: best.item.kind, daysWaiting };
}

export function reminderCopy(s: ReminderState): string | null {
  if (s.tone === "none" || !s.kind) return null;
  const what = s.kind === "retest" ? "retest" : "7-day re-check";
  if (s.tone === "overdue") return `Your ${what} has waited ${s.daysWaiting} days. A short one now still counts (unvalidated).`;
  return `Your ${what} is ready.`;
}

/** Sample gate before any acted-share is shown (same as the re-check gate). */
export const REMINDER_MIN_SAMPLE = 20;

export interface ReminderOutcomeInput {
  /** ISO time the step became reminder-eligible. */
  availableAt: string;
  /** ISO time the learner started it, or null if still waiting. */
  startedAt: string | null;
}

export interface ReminderOutcome {
  eligible: number;
  /** Started within 24h after becoming overdue (2+ days waiting). */
  actedAfterOverdue: number;
  overdue: number;
  /** Share of overdue steps acted on; null until the sample gate passes. */
  actedShare: number | null;
  label: "insufficient_evidence" | "descriptive_unvalidated";
}

/**
 * Sent-vs-acted without a new event type: derived from existing retest start
 * times. Descriptive only; it cannot show a reminder caused the start.
 */
export function reminderOutcome(rows: readonly ReminderOutcomeInput[], now: Date): ReminderOutcome {
  let eligible = 0;
  let overdue = 0;
  let acted = 0;
  const t = now.getTime();
  for (const r of rows) {
    const at = Date.parse(r.availableAt);
    if (!Number.isFinite(at) || !Number.isFinite(t) || at > t) continue;
    eligible++;
    const overdueAt = at + 2 * DAY_MS;
    const started = r.startedAt ? Date.parse(r.startedAt) : NaN;
    const wasOverdue = t >= overdueAt;
    if (!wasOverdue) continue;
    overdue++;
    if (Number.isFinite(started) && started >= overdueAt && started <= overdueAt + DAY_MS) acted++;
  }
  const ok = overdue >= REMINDER_MIN_SAMPLE;
  return {
    eligible,
    overdue,
    actedAfterOverdue: acted,
    actedShare: ok ? acted / overdue : null,
    label: ok ? "descriptive_unvalidated" : "insufficient_evidence",
  };
}
