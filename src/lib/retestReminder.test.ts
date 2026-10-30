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
