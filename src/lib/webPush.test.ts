import { describe, expect, it } from "vitest";
import { SKILL_DIMENSIONS, SKILL_ORDER } from "./skillTaxonomy";
import { decidePush, isKnownPushService, parsePushSubscription, pushMessage, type PushDecisionInput } from "./webPush";

// 2026-10-30 18:30 in London (UTC+0 after the clocks change) — inside the window.
const EVENING = new Date("2026-10-30T18:30:00Z");

function input(over: Partial<PushDecisionInput> = {}): PushDecisionInput {
  return {
    now: EVENING,
    timeZone: "Europe/London",
    lastActivityDate: "2026-10-29",
    currentStreak: 4,
    pendingRetests: 0,
    lastPushAt: null,
    lastRetestPushAt: null,
    ...over,
  };
}

describe("decidePush", () => {
  it("sends a streak-saver in the evening of a day not yet practised, after practising yesterday", () => {
    expect(decidePush(input())).toEqual({ send: true, kind: "streak", streak: 4 });
  });

  it("only sends inside 17:00-21:00 local time", () => {
    expect(decidePush(input({ now: new Date("2026-10-30T16:59:00Z") }))).toMatchObject({ send: false, reason: "outside_window" });
    expect(decidePush(input({ now: new Date("2026-10-30T21:00:00Z") }))).toMatchObject({ send: false, reason: "outside_window" });
    // 18:30 UTC is 05:30 in Sydney.
    expect(decidePush(input({ timeZone: "Australia/Sydney" }))).toMatchObject({ send: false, reason: "outside_window" });
  });

  it("uses the learner's own date for 'today' and 'yesterday'", () => {
    // 2026-10-30 08:00 UTC = 19:00 on 30 Oct in Sydney (UTC+11).
    const sydney = input({ now: new Date("2026-10-30T08:00:00Z"), timeZone: "Australia/Sydney" });
    expect(decidePush(sydney)).toMatchObject({ send: true, kind: "streak" });
    expect(decidePush({ ...sydney, lastActivityDate: "2026-10-30" })).toMatchObject({ send: false, reason: "practised_today" });
  });

  it("never sends twice in a day (any kind)", () => {
    expect(decidePush(input({ lastPushAt: "2026-10-30T07:00:00Z" }))).toMatchObject({ send: false, reason: "recently_sent" });
    expect(decidePush(input({ lastPushAt: "2026-10-29T18:00:00Z" }))).toMatchObject({ send: true });
  });

  it("stays silent on a day already practised", () => {
    expect(decidePush(input({ lastActivityDate: "2026-10-30", pendingRetests: 2 }))).toMatchObject({ send: false, reason: "practised_today" });
  });

  it("mentions a waiting repair only when no streak is at stake, and at most every three days", () => {
    const lapsed = input({ lastActivityDate: "2026-10-20", currentStreak: 0, pendingRetests: 1 });
    expect(decidePush(lapsed)).toEqual({ send: true, kind: "retest", streak: 0 });
    expect(decidePush({ ...lapsed, lastRetestPushAt: "2026-10-28T19:00:00Z" })).toMatchObject({ send: false, reason: "nothing_due" });
    expect(decidePush({ ...lapsed, lastRetestPushAt: "2026-10-27T17:00:00Z" })).toMatchObject({ send: true, kind: "retest" });
    expect(decidePush({ ...input(), pendingRetests: 1 })).toMatchObject({ kind: "streak" });
  });

  it("has nothing to say to a learner with no streak and no open loop", () => {
    expect(decidePush(input({ lastActivityDate: "2026-10-01", currentStreak: 0 }))).toMatchObject({ send: false, reason: "nothing_due" });
    expect(decidePush(input({ lastActivityDate: null, currentStreak: 0 }))).toMatchObject({ send: false, reason: "nothing_due" });
  });
});

describe("pushMessage", () => {
  it("streak copy names the streak and the four-minute sprint", () => {
    expect(pushMessage({ send: true, kind: "streak", streak: 1 }).title).toBe("Keep your 1-day streak");
    expect(pushMessage({ send: true, kind: "streak", streak: 9 })).toMatchObject({ title: "Keep your 9-day streak", url: "/?src=push" });
  });

  it("retest copy obeys the disclosure rule: no skill named, no day tied to the test", () => {
    const message = pushMessage({ send: true, kind: "retest", streak: 0 });
    const text = `${message.title} ${message.body}`;
    for (const key of SKILL_ORDER) {
      expect(text.toLowerCase()).not.toContain(SKILL_DIMENSIONS[key].label.toLowerCase());
    }
    expect(text).not.toMatch(/\btoday\b|\btomorrow\b|\btonight\b/i);
  });
});

describe("parsePushSubscription", () => {
  const good = {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
    keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" },
  };

  it("accepts a real push-service subscription", () => {
    expect(parsePushSubscription(good)).toEqual({ endpoint: good.endpoint, p256dh: good.keys.p256dh, auth: good.keys.auth });
    expect(parsePushSubscription({ ...good, endpoint: "https://web.push.apple.com/QGuQyavXut" })).not.toBeNull();
  });

  it("refuses endpoints that are not a known push service (no SSRF via forged subscriptions)", () => {
    expect(parsePushSubscription({ ...good, endpoint: "https://evil.example/fcm.googleapis.com" })).toBeNull();
    expect(parsePushSubscription({ ...good, endpoint: "https://fcm.googleapis.com.evil.example/x" })).toBeNull();
    expect(parsePushSubscription({ ...good, endpoint: "http://fcm.googleapis.com/x" })).toBeNull();
    expect(parsePushSubscription({ ...good, endpoint: "https://169.254.169.254/latest" })).toBeNull();
    expect(isKnownPushService("updates.push.services.mozilla.com")).toBe(true);
  });

  it("refuses malformed keys and shapes", () => {
    expect(parsePushSubscription(null)).toBeNull();
    expect(parsePushSubscription({ endpoint: good.endpoint })).toBeNull();
    expect(parsePushSubscription({ ...good, keys: { ...good.keys, auth: "has spaces" } })).toBeNull();
    expect(parsePushSubscription({ ...good, keys: { ...good.keys, p256dh: "x".repeat(201) } })).toBeNull();
  });
});
