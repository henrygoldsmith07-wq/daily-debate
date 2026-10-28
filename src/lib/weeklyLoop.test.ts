import { describe, expect, it } from "vitest";
import { buildWeeklyLoop, MIN_RETESTS_FOR_RATE, WEEK_MS } from "./weeklyLoop";

const now = Date.parse("2026-10-28T12:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();
const DAY = 86_400_000;

describe("buildWeeklyLoop", () => {
  it("counts only the last 7 days and ignores bad/future timestamps", () => {
    const w = buildWeeklyLoop({
      debates: [
        { completedAt: ago(DAY) }, { completedAt: ago(WEEK_MS + 1) },
        { completedAt: null }, { completedAt: "nope" }, { completedAt: new Date(now + DAY).toISOString() },
      ],
      repairs: [{ createdAt: ago(2 * DAY), succeeded: true }, { createdAt: ago(3 * DAY), succeeded: false }, { createdAt: ago(9 * DAY), succeeded: true }],
      retests: [],
    }, now);
    expect(w.debates).toBe(1);
    expect(w.repairAttempts).toBe(2);
    expect(w.repairsSucceeded).toBe(1);
  });

  it("gates the demonstrated rate on all-time observable retests", () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ completedAt: ago((i + 1) * DAY * 3), observable: true, demonstrated: i % 2 === 0 }));
    const low = buildWeeklyLoop({ debates: [], repairs: [], retests: mk(MIN_RETESTS_FOR_RATE - 1) }, now);
    expect(low.rateState).toBe("insufficient_evidence");
    expect(low.demonstratedRate).toBeNull();
    const ok = buildWeeklyLoop({ debates: [], repairs: [], retests: mk(MIN_RETESTS_FOR_RATE) }, now);
    expect(ok.rateState).toBe("ok");
    expect(ok.demonstratedRate).toBeCloseTo(3 / 5);
  });

  it("unobservable retests never count toward the rate", () => {
    const w = buildWeeklyLoop({ debates: [], repairs: [], retests: Array.from({ length: 8 }, () => ({ completedAt: ago(DAY), observable: false, demonstrated: null })) }, now);
    expect(w.retestsCompleted).toBe(8);
    expect(w.retestsObservable).toBe(0);
    expect(w.rateState).toBe("insufficient_evidence");
  });

  it("picks the next action from what is missing", () => {
    expect(buildWeeklyLoop({ debates: [], repairs: [], retests: [] }, now).next.kind).toBe("debate");
    expect(buildWeeklyLoop({ debates: [{ completedAt: ago(DAY) }], repairs: [], retests: [] }, now).next.kind).toBe("repair");
    expect(buildWeeklyLoop({ debates: [{ completedAt: ago(DAY) }], repairs: [{ createdAt: ago(DAY), succeeded: false }], retests: [] }, now).next.kind).toBe("keep_going");
  });

  it("leads with a pending retest over other next actions", () => {
    const w = buildWeeklyLoop({ debates: [], repairs: [], retests: [], pendingRetests: 1 }, now);
    expect(w.next.kind).toBe("retest");
    expect(buildWeeklyLoop({ debates: [], repairs: [], retests: [] }, now).next.kind).toBe("debate");
  });

  it("counts the previous 7 days separately from this week", () => {
    const w = buildWeeklyLoop({
      debates: [{ completedAt: ago(DAY) }, { completedAt: ago(8 * DAY) }, { completedAt: ago(13 * DAY) }, { completedAt: ago(15 * DAY) }],
      repairs: [], retests: [],
    }, now);
    expect(w.debates).toBe(1);
    expect(w.previousDebates).toBe(2);
  });
});
