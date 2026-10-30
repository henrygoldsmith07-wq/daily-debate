import { describe, expect, it } from "vitest";
import { decideDispatch, inQuietHours, localHour, DEFAULT_REMINDER_PREFS, type ReminderPrefs } from "./reminderDelivery";

const prefs: ReminderPrefs = { ...DEFAULT_REMINDER_PREFS, optedIn: true, timeZone: "Europe/London" };
const due = [{ kind: "recheck" as const, availableAt: "2026-10-20T09:00:00Z" }];

describe("reminder delivery", () => {
  it("reads local hour with timezone and bad-zone fallback", () => {
    expect(localHour(new Date("2026-07-01T12:00:00Z"), "Europe/London")).toBe(13);
    expect(localHour(new Date("2026-07-01T12:00:00Z"), "Nope/Zone")).toBe(12);
  });
  it("handles overnight quiet hours", () => {
    expect(inQuietHours(new Date("2026-10-30T22:00:00Z"), prefs)).toBe(true);
    expect(inQuietHours(new Date("2026-10-30T03:00:00Z"), prefs)).toBe(true);
    expect(inQuietHours(new Date("2026-10-30T12:00:00Z"), prefs)).toBe(false);
  });
  it("requires opt-in", () => {
    expect(decideDispatch(due, { ...prefs, optedIn: false }, null, new Date("2026-10-30T12:00:00Z"))).toEqual({ send: false, reason: "not_opted_in" });
  });
  it("sends when due, awake and not recently sent", () => {
    const d = decideDispatch(due, prefs, null, new Date("2026-10-30T12:00:00Z"));
    expect(d).toMatchObject({ send: true, kind: "recheck" });
  });
  it("holds during quiet hours and within 24h of the last send", () => {
    expect(decideDispatch(due, prefs, null, new Date("2026-10-30T23:00:00Z"))).toEqual({ send: false, reason: "quiet_hours" });
    expect(decideDispatch(due, prefs, "2026-10-30T09:00:00Z", new Date("2026-10-30T12:00:00Z"))).toEqual({ send: false, reason: "recently_sent" });
  });
  it("reports nothing due", () => {
    expect(decideDispatch([], prefs, null, new Date("2026-10-30T12:00:00Z"))).toEqual({ send: false, reason: "nothing_due" });
  });
});

import { reminderMessage, reminderSentEvent } from "@/lib/reminderDelivery";
describe("reminder message", () => {
  it("retest copy makes no effectiveness claim", () => {
    const m = reminderMessage({ send: true, kind: "retest", daysWaiting: 2 });
    expect(m.subject).toMatch(/retest/i);
    expect(m.body).toMatch(/2 days/);
    expect(m.body).toMatch(/not a score/);
  });
  it("event carries kind and ISO time", () => {
    const e = reminderSentEvent({ send: true, kind: "retest", daysWaiting: 1 }, new Date("2026-10-30T10:00:00Z"));
    expect(e.sentAt).toBe("2026-10-30T10:00:00.000Z");
  });
});

import { summariseReminderOutcomes } from "@/lib/reminderDelivery";

describe("summariseReminderOutcomes", () => {
  const sent = (h: number) => ({ type: "reminder_sent" as const, sentAt: new Date(Date.UTC(2026, 9, 1, h)).toISOString() });
  it("gates small samples", () => {
    expect(summariseReminderOutcomes([sent(1), sent(2)]).status).toBe("insufficient_evidence");
  });
  it("counts each action once, inside the window", () => {
    const evs = [1, 2, 3, 4, 5].map(sent);
    evs.push({ type: "reminder_acted" as never, actedAt: new Date(Date.UTC(2026, 9, 1, 10)).toISOString() } as never);
    evs.push({ type: "reminder_acted" as never, actedAt: new Date(Date.UTC(2026, 9, 9, 10)).toISOString() } as never);
    const r = summariseReminderOutcomes(evs);
    expect(r).toMatchObject({ status: "ok", sent: 5, acted: 1, label: "unvalidated" });
  });
});
