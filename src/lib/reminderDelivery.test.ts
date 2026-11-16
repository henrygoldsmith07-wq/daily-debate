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

import { prefsFromEvents } from "@/lib/reminderDelivery";
import { isClientProductEventName } from "@/lib/clientProductEvents";
import { isProductEventName } from "@/lib/productEvents";

describe("prefsFromEvents (M18 slice 4)", () => {
  it("defaults to not opted in", () => {
    expect(prefsFromEvents([]).optedIn).toBe(false);
  });
  it("latest opt event wins regardless of order", () => {
    const ev = [
      { name: "reminder_opted_out", createdAt: "2026-10-02T00:00:00Z" },
      { name: "reminder_opted_in", createdAt: "2026-10-01T00:00:00Z" },
    ];
    expect(prefsFromEvents(ev).optedIn).toBe(false);
    expect(prefsFromEvents([...ev].reverse()).optedIn).toBe(false);
    expect(prefsFromEvents([ev[1]]).optedIn).toBe(true);
  });
  it("ignores unrelated and invalid events", () => {
    expect(prefsFromEvents([{ name: "reminder_opted_in", createdAt: "nope" }, { name: "daily_viewed", createdAt: "2026-10-01T00:00:00Z" }]).optedIn).toBe(false);
  });
  it("registers reminder event names", () => {
    expect(isProductEventName("reminder_sent")).toBe(true);
    expect(isClientProductEventName("reminder_acted")).toBe(true);
    expect(isClientProductEventName("reminder_sent")).toBe(false);
  });
});

describe("summariseSentActedPerUser", () => {
  it("does not credit one user's action to another user's reminder", async () => {
    const { summariseSentActedPerUser } = await import("./reminderDelivery");
    const rows = [1, 2, 3, 4, 5].map((h) => ({ userId: `u${h}`, event: { type: "reminder_sent" as const, sentAt: new Date(Date.UTC(2026, 9, 1, h)).toISOString() } }));
    rows.push({ userId: "u1", event: { type: "reminder_acted" as never, actedAt: new Date(Date.UTC(2026, 9, 1, 6)).toISOString() } as never });
    const s = summariseSentActedPerUser(rows as never);
    expect(s).toMatchObject({ status: "ok", sent: 5, acted: 1 });
    expect(summariseSentActedPerUser(rows.slice(0, 3) as never).status).toBe("insufficient_evidence");
  });
});
