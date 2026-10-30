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
