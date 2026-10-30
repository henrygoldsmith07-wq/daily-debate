/**
 * M18 slice 1: should a reminder be dispatched now? Pure decision logic.
 * Opt-in only, quiet hours in the learner's own timezone, at most one
 * reminder per step per 24h. Says nothing about whether reminders work.
 */
import { reminderState, type ReminderInput } from "@/lib/retestReminder";

export interface ReminderPrefs {
  optedIn: boolean;
  /** IANA timezone, e.g. "Europe/London". Invalid values fall back to UTC. */
  timeZone: string;
  /** Quiet hours as local hours 0-23; start may exceed end (overnight). */
  quietStartHour: number;
  quietEndHour: number;
}

export const DEFAULT_REMINDER_PREFS: ReminderPrefs = {
  optedIn: false,
  timeZone: "UTC",
  quietStartHour: 21,
  quietEndHour: 8,
};

export function localHour(now: Date, timeZone: string): number {
  const t = now.getTime();
  if (!Number.isFinite(t)) return 0;
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(now);
  let raw: string;
  try {
    raw = fmt(timeZone);
  } catch {
    raw = fmt("UTC");
  }
  const h = Number.parseInt(raw, 10);
  return Number.isFinite(h) ? h % 24 : 0;
}

export function inQuietHours(now: Date, prefs: ReminderPrefs): boolean {
  const { quietStartHour: s, quietEndHour: e } = prefs;
  if (s === e) return false;
  const h = localHour(now, prefs.timeZone);
  return s < e ? h >= s && h < e : h >= s || h < e;
}

export type DispatchDecision =
  | { send: true; kind: ReminderInput["kind"]; daysWaiting: number }
  | { send: false; reason: "not_opted_in" | "nothing_due" | "quiet_hours" | "recently_sent" };

export function decideDispatch(
  items: readonly ReminderInput[],
  prefs: ReminderPrefs,
  lastSentAt: string | null,
  now: Date,
): DispatchDecision {
  if (!prefs.optedIn) return { send: false, reason: "not_opted_in" };
  const s = reminderState(items, now);
  if (s.tone === "none" || !s.kind) return { send: false, reason: "nothing_due" };
  if (inQuietHours(now, prefs)) return { send: false, reason: "quiet_hours" };
  const last = lastSentAt ? Date.parse(lastSentAt) : NaN;
  if (Number.isFinite(last) && now.getTime() - last < 86_400_000) return { send: false, reason: "recently_sent" };
  return { send: true, kind: s.kind, daysWaiting: s.daysWaiting };
}
