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

export interface ReminderMessage {
  subject: string;
  body: string;
}

/** M18 slice 2: plain, non-promissory copy for a dispatched reminder. */
export function reminderMessage(d: Extract<DispatchDecision, { send: true }>): ReminderMessage {
  const days = Math.max(0, Math.floor(d.daysWaiting));
  const wait = days === 0 ? "today" : days === 1 ? "1 day" : `${days} days`;
  if (d.kind === "retest") {
    return {
      subject: "Your retest is ready",
      body: `Your repair has been waiting ${wait === "today" ? "since today" : wait}. A retest is the only way to see whether it held. This is not a score of how well it works.`,
    };
  }
  return {
    subject: "Your re-check is ready",
    body: `Your re-check has been waiting ${wait === "today" ? "since today" : wait}. It shows whether a gain lasted; one result is not proof.`,
  };
}

/** Event payload stored in product_events context (no migration needed). */
export function reminderSentEvent(d: Extract<DispatchDecision, { send: true }>, now: Date) {
  return { type: "reminder_sent" as const, kind: d.kind, daysWaiting: d.daysWaiting, sentAt: now.toISOString() };
}

export interface ReminderOutcomeEvent {
  type: "reminder_sent" | "reminder_acted";
  sentAt?: string;
  actedAt?: string;
}

export const REMINDER_MIN_SAMPLE = 5;
/** A reminder counts as acted on if the learner starts within this window. */
export const REMINDER_ACT_WINDOW_MS = 48 * 3_600_000;

export type ReminderActedSummary =
  | { status: "insufficient_evidence"; sent: number; needed: number }
  | { status: "ok"; sent: number; acted: number; actedRate: number; label: "unvalidated" };

function countActed(events: readonly ReminderOutcomeEvent[]): { sent: number; acted: number } {
  const sent = events.filter((e) => e.type === "reminder_sent" && Number.isFinite(Date.parse(e.sentAt ?? "")));
  const acted = events
    .filter((e) => e.type === "reminder_acted" && Number.isFinite(Date.parse(e.actedAt ?? "")))
    .map((e) => Date.parse(e.actedAt as string));
  const used = new Set<number>();
  let n = 0;
  for (const s of sent) {
    const t = Date.parse(s.sentAt as string);
    const i = acted.findIndex((a, idx) => !used.has(idx) && a >= t && a - t <= REMINDER_ACT_WINDOW_MS);
    if (i >= 0) {
      used.add(i);
      n++;
    }
  }
  return { sent: sent.length, acted: n };
}

/** M18 slice 3: sent-vs-acted summary, sample-gated. Not evidence reminders cause retests. */
export function summariseReminderOutcomes(events: readonly ReminderOutcomeEvent[]): ReminderActedSummary {
  const { sent, acted: n } = countActed(events);
  if (sent < REMINDER_MIN_SAMPLE) return { status: "insufficient_evidence", sent, needed: REMINDER_MIN_SAMPLE };
  return { status: "ok", sent, acted: n, actedRate: n / sent, label: "unvalidated" };
}

/** Matches acted to sent within each user (never across users), then gates on total sent. */
export function summariseSentActedPerUser(rows: readonly { userId: string; event: ReminderOutcomeEvent }[]): ReminderActedSummary {
  const by = new Map<string, ReminderOutcomeEvent[]>();
  for (const r of rows) by.set(r.userId, [...(by.get(r.userId) ?? []), r.event]);
  let sent = 0;
  let acted = 0;
  for (const evs of by.values()) {
    const c = countActed(evs);
    sent += c.sent;
    acted += c.acted;
  }
  if (sent < REMINDER_MIN_SAMPLE) return { status: "insufficient_evidence", sent, needed: REMINDER_MIN_SAMPLE };
  return { status: "ok", sent, acted, actedRate: acted / sent, label: "unvalidated" };
}

export interface ReminderPrefEvent {
  name: string;
  createdAt: string;
}

/**
 * M18 slice 4: opt-in state derived from product_events (no migration): the
 * latest opt-in/opt-out event wins; no event means not opted in. Timezone and
 * quiet hours stay at defaults until a settings store exists.
 */
export function prefsFromEvents(events: readonly ReminderPrefEvent[]): ReminderPrefs {
  let latest = -Infinity;
  let optedIn = false;
  for (const e of events) {
    if (e.name !== "reminder_opted_in" && e.name !== "reminder_opted_out") continue;
    const t = Date.parse(e.createdAt);
    if (!Number.isFinite(t) || t < latest) continue;
    latest = t;
    optedIn = e.name === "reminder_opted_in";
  }
  return { ...DEFAULT_REMINDER_PREFS, optedIn };
}
