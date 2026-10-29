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

import { pickRecheckMotion } from "./spacedRecheck";
describe("pickRecheckMotion", () => {
  const pool = ["Cities should ban cars", "Homework should end", "Zoos should close"];
  it("never reuses a prior motion, case-insensitively", () => {
    const m = pickRecheckMotion(pool, ["cities should ban cars", "Homework should end"], "r1");
    expect(m).toBe("Zoos should close");
  });
  it("is deterministic per seed and null when nothing is fresh", () => {
    expect(pickRecheckMotion(pool, [], "r1")).toBe(pickRecheckMotion(pool, [], "r1"));
    expect(pickRecheckMotion(pool, pool, "r1")).toBeNull();
  });
});

import { planRecheck } from "./spacedRecheck";
describe("planRecheck", () => {
  const now = new Date("2026-11-20T00:00:00Z");
  const r = { id: "a", retest_outcome: "skill-observed", retest_completed_at: "2026-11-10T00:00:00Z" } as never;
  it("plans a fresh motion for a due repair", () => {
    const p = planRecheck([r], ["X", "Y"], { a: ["X"] }, now);
    expect(p).toMatchObject({ repairId: "a", motion: "Y" });
  });
  it("returns null with no fresh motion or nothing due", () => {
    expect(planRecheck([r], ["X"], { a: ["x"] }, now)).toBeNull();
    expect(planRecheck([r], ["X"], {}, new Date("2026-11-11T00:00:00Z"))).toBeNull();
  });
});

import { durableGainOutcome, summariseDurableGain } from "./spacedRecheck";
describe("durable gain", () => {
  it("classifies only stored verdicts", () => {
    expect(durableGainOutcome("skill-observed")).toBe("durable");
    expect(durableGainOutcome("weakness-recurred")).toBe("not-durable");
    expect(durableGainOutcome(null)).toBe("inconclusive");
  });
  it("gates the share below the sample minimum", () => {
    const few = summariseDurableGain(["skill-observed", "weakness-recurred", null]);
    expect(few).toMatchObject({ durable: 1, notDurable: 1, inconclusive: 1, evidence: "insufficient_evidence", durableShare: null });
    const many = summariseDurableGain([...Array(15).fill("skill-observed"), ...Array(5).fill("weakness-recurred")]);
    expect(many.durableShare).toBe(0.75);
  });
});
