import { describe, expect, it } from "vitest";
import { nextDueRecheck, recheckCopy, recheckStatus } from "./spacedRecheck";

const done = "2026-10-01T10:00:00.000Z";
const at = (d: number) => new Date(Date.parse(done) + d * 86_400_000);
const observed = { retest_outcome: "skill-observed" as const, retest_completed_at: done };

describe("spaced recheck", () => {
  it("only schedules from a stored skill-observed verdict", () => {
    for (const o of ["skill-not-observed", "no-valid-opportunity", "not-enough-evidence", null] as const) {
      expect(recheckStatus({ retest_outcome: o, retest_completed_at: done }, at(8)).state).toBe("not-scheduled");
    }
  });
  it("waits 7 days, then is due, then expires at 14", () => {
    expect(recheckStatus(observed, at(3))).toMatchObject({ state: "waiting", daysUntilDue: 4 });
    expect(recheckStatus(observed, at(7)).state).toBe("due");
    expect(recheckStatus(observed, at(14)).state).toBe("expired");
  });
  it("is not scheduled once a re-check exists or timestamp is bad", () => {
    expect(recheckStatus({ ...observed, recheck_debate_id: "d1" }, at(8)).state).toBe("not-scheduled");
    expect(recheckStatus({ ...observed, retest_completed_at: "nope" }, at(8)).state).toBe("not-scheduled");
  });
  it("picks the oldest due re-check", () => {
    const older = { ...observed, retest_completed_at: "2026-09-28T10:00:00.000Z", id: "a" };
    expect(nextDueRecheck([{ ...observed, id: "b" }, older], at(9))?.id).toBe("a");
    expect(nextDueRecheck([{ ...observed, id: "b" }], at(2))).toBeNull();
  });
  it("copy is labelled unvalidated and singular-aware", () => {
    expect(recheckCopy(recheckStatus(observed, at(8)))).toContain("unvalidated");
    expect(recheckCopy(recheckStatus(observed, at(6.5)))).toBe("Re-check unlocks in 1 day.");
  });
});

import { recheckFunnel, RECHECK_MIN_SAMPLE } from "./spacedRecheck";
describe("recheckFunnel", () => {
  const now = new Date("2026-11-01T00:00:00Z");
  const mk = (daysAgo: number) => ({
    retest_outcome: "skill-observed" as const,
    retest_completed_at: new Date(now.getTime() - daysAgo * 86_400_000).toISOString(),
  });
  it("gates small samples", () => {
    const f = recheckFunnel([mk(1), mk(8), mk(20)], now);
    expect(f).toMatchObject({ eligible: 3, waiting: 1, due: 1, expired: 1, evidence: "insufficient_evidence", expiredShare: null });
  });
  it("reports share at the sample gate", () => {
    const f = recheckFunnel(Array.from({ length: RECHECK_MIN_SAMPLE }, (_, i) => mk(i % 2 ? 20 : 1)), now);
    expect(f.evidence).toBe("reported");
    expect(f.expiredShare).toBe(0.5);
  });
});
