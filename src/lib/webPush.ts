// Web Push reminders — pure decision logic and copy (copied from Duolingo's
// streak-saver, with its rule: protect the channel).
//
// At most one push per learner per day, only in an early-evening window of
// the learner's own timezone, never in quiet hours, and only when there is a
// reason: a streak about to lapse, or a repair still waiting to be tested.
// The retest message obeys the disclosure rule (retestDisclosure.ts): it says
// a loop is open, never which skill is being tested, and never ties the test
// to a day.

import { DEFAULT_REMINDER_PREFS, inQuietHours, localHour } from "./reminderDelivery";
import { dateKeyInTimeZone } from "./timeZone";

export type PushKind = "streak" | "retest";

/** Local hours [start, end) in which a push may be sent. Before the default quiet hours (21:00). */
export const PUSH_WINDOW_START_HOUR = 17;
export const PUSH_WINDOW_END_HOUR = 21;
/** Any push at all: once per this many ms (the hourly sender cannot double up inside a day). */
export const PUSH_MIN_GAP_MS = 20 * 3_600_000;
/** A pending retest is mentioned at most this often; it is not urgent and must not nag. */
export const RETEST_PUSH_MIN_GAP_MS = 72 * 3_600_000;

export interface PushDecisionInput {
  now: Date;
  timeZone: string;
  /** Local date (YYYY-MM-DD) of the learner's last practice, from profiles. */
  lastActivityDate: string | null;
  currentStreak: number;
  pendingRetests: number;
  /** Most recent push of any kind, ISO. */
  lastPushAt: string | null;
  /** Most recent retest push, ISO. */
  lastRetestPushAt: string | null;
}

export type PushDecision =
  | { send: true; kind: PushKind; streak: number }
  | { send: false; reason: "outside_window" | "quiet_hours" | "recently_sent" | "practised_today" | "nothing_due" };

function previousDay(dateKey: string): string {
  const t = Date.parse(`${dateKey}T12:00:00Z`) - 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

function within(lastIso: string | null, gapMs: number, now: Date): boolean {
  if (!lastIso) return false;
  const last = Date.parse(lastIso);
  return Number.isFinite(last) && now.getTime() - last < gapMs;
}

export function decidePush(input: PushDecisionInput): PushDecision {
  const { now, timeZone } = input;
  const hour = localHour(now, timeZone);
  if (hour < PUSH_WINDOW_START_HOUR || hour >= PUSH_WINDOW_END_HOUR) return { send: false, reason: "outside_window" };
  if (inQuietHours(now, { ...DEFAULT_REMINDER_PREFS, optedIn: true, timeZone })) return { send: false, reason: "quiet_hours" };
  if (within(input.lastPushAt, PUSH_MIN_GAP_MS, now)) return { send: false, reason: "recently_sent" };

  const today = dateKeyInTimeZone(timeZone, now);
  if (input.lastActivityDate === today) return { send: false, reason: "practised_today" };

  // A streak that lapses tonight is the time-sensitive one.
  if (input.lastActivityDate === previousDay(today) && input.currentStreak >= 1) {
    return { send: true, kind: "streak", streak: input.currentStreak };
  }
  if (input.pendingRetests > 0 && !within(input.lastRetestPushAt, RETEST_PUSH_MIN_GAP_MS, now)) {
    return { send: true, kind: "retest", streak: input.currentStreak };
  }
  return { send: false, reason: "nothing_due" };
}

export interface PushMessage {
  title: string;
  body: string;
  /** Same-origin path the notification opens; carries src=push for attribution. */
  url: string;
}

export function pushMessage(decision: Extract<PushDecision, { send: true }>): PushMessage {
  if (decision.kind === "streak") {
    const days = decision.streak === 1 ? "1-day" : `${decision.streak}-day`;
    return {
      title: `Keep your ${days} streak`,
      body: "Today's motion takes about four minutes.",
      url: "/?src=push",
    };
  }
  return {
    title: "A repair is waiting to be tested",
    body: "It is checked in a later debate, without a cue. Whenever you next debate.",
    url: "/?src=push",
  };
}

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}

const KEY_RE = /^[A-Za-z0-9_-]+={0,2}$/;

/** Validate a PushSubscription.toJSON() body from the browser. */
export function parsePushSubscription(raw: unknown): PushSubscriptionInput | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const { endpoint } = value;
  if (typeof endpoint !== "string" || endpoint.length > 1000) return null;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  // Only real push services: never let a client make the server POST to an
  // arbitrary host (SSRF) via a forged subscription.
  if (!isKnownPushService(url.hostname)) return null;
  const p256dh = value.keys?.p256dh;
  const auth = value.keys?.auth;
  if (typeof p256dh !== "string" || p256dh.length > 200 || !KEY_RE.test(p256dh)) return null;
  if (typeof auth !== "string" || auth.length > 100 || !KEY_RE.test(auth)) return null;
  return { endpoint, p256dh, auth };
}

const PUSH_SERVICE_SUFFIXES = [
  "fcm.googleapis.com",
  "android.googleapis.com",
  "push.services.mozilla.com",
  "push.apple.com",
  "notify.windows.com",
];

export function isKnownPushService(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return PUSH_SERVICE_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}
