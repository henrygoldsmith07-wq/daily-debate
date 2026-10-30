import { describe, expect, it } from "vitest";
import { reminderCopy, reminderState } from "./retestReminder";

const now = new Date("2026-10-30T12:00:00Z");
describe("reminderState", () => {
  it("is none with nothing or bad dates", () => {
    expect(reminderState([], now).tone).toBe("none");
    expect(reminderState([{ kind: "retest", availableAt: "nope" }], now).tone).toBe("none");
    expect(reminderState([{ kind: "retest", availableAt: "2026-10-01T00:00:00Z" }], new Date("x")).tone).toBe("none");
  });
  it("does not nudge a retest inside the fresh window", () => {
    expect(reminderState([{ kind: "retest", availableAt: "2026-10-30T02:00:00Z" }], now).tone).toBe("none");
  });
  it("is ready after the window and overdue after two days", () => {
    expect(reminderState([{ kind: "retest", availableAt: "2026-10-29T10:00:00Z" }], now).tone).toBe("ready");
    const s = reminderState([{ kind: "retest", availableAt: "2026-10-26T10:00:00Z" }], now);
    expect(s).toEqual({ tone: "overdue", kind: "retest", daysWaiting: 4 });
    expect(reminderCopy(s)).toContain("4 days");
  });
  it("re-check is ready immediately and the oldest item wins", () => {
    const s = reminderState(
      [{ kind: "retest", availableAt: "2026-10-29T10:00:00Z" }, { kind: "recheck", availableAt: "2026-10-30T11:00:00Z" }],
      now,
    );
    expect(s.kind).toBe("retest");
    expect(reminderCopy(reminderState([{ kind: "recheck", availableAt: "2026-10-30T11:00:00Z" }], now))).toBe("Your 7-day re-check is ready.");
  });
});

import { reminderCopy as _copy, reminderState as _state } from "./retestReminder";
describe("overdue recheck copy", () => {
  it("is overdue after 2 days and says unvalidated", () => {
    const s = _state([{ kind: "recheck", availableAt: "2026-10-20T00:00:00Z" }], new Date("2026-10-23T00:00:00Z"));
    expect(s.tone).toBe("overdue");
    expect(_copy(s)).toContain("3 days");
    expect(_copy(s)).toContain("unvalidated");
  });
});

import { reminderOutcome } from "./retestReminder";
describe("reminderOutcome", () => {
  const n = new Date("2026-10-30T12:00:00Z");
  it("is insufficient_evidence below the sample gate", () => {
    const o = reminderOutcome([{ availableAt: "2026-10-20T00:00:00Z", startedAt: "2026-10-22T05:00:00Z" }], n);
    expect(o.actedShare).toBeNull();
    expect(o.label).toBe("insufficient_evidence");
    expect(o.actedAfterOverdue).toBe(1);
  });
  it("reports a share once gated, ignoring future and bad rows", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      availableAt: "2026-10-20T00:00:00Z",
      startedAt: i < 5 ? "2026-10-22T05:00:00Z" : null,
    }));
    rows.push({ availableAt: "2027-01-01T00:00:00Z", startedAt: null }, { availableAt: "bad", startedAt: null });
    const o = reminderOutcome(rows, n);
    expect(o.overdue).toBe(20);
    expect(o.actedShare).toBe(0.25);
    expect(o.label).toBe("descriptive_unvalidated");
  });
});

import { reminderOutcome as _outcome, REMINDER_MIN_SAMPLE as _MIN } from "./retestReminder";
describe("reminderOutcome gate", () => {
  const n = new Date("2026-10-30T12:00:00Z");
  it("stays insufficient_evidence under the sample gate and counts acted", () => {
    const r = _outcome([{ availableAt: "2026-10-20T00:00:00Z", startedAt: "2026-10-22T10:00:00Z" }], n);
    expect(r).toMatchObject({ overdue: 1, actedAfterOverdue: 1, actedShare: null, label: "insufficient_evidence" });
  });
  it("shows a share once the gate passes", () => {
    const rows = Array.from({ length: _MIN }, (_, i) => ({ availableAt: "2026-10-20T00:00:00Z", startedAt: i < 5 ? "2026-10-22T10:00:00Z" : null }));
    expect(_outcome(rows, n)).toMatchObject({ actedShare: 0.25, label: "descriptive_unvalidated" });
  });
});
