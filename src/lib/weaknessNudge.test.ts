import { describe, expect, it } from "vitest";
import type { ChainEntry } from "./loopChain";
import { nudgeCopy, pickWeaknessNudge } from "./weaknessNudge";

const e = (targetKind: ChainEntry["targetKind"], stage: ChainEntry["stage"], day: number): ChainEntry => ({
  repairId: `${targetKind}${day}`, targetKind, stage, repairedAt: `2026-10-${10 + day}T10:00:00Z`,
  retestAssignments: 1, completedAt: null, recurrence: "insufficient_evidence",
});

describe("pickWeaknessNudge", () => {
  it("returns null with no unresolved weakness", () => {
    expect(pickWeaknessNudge([])).toBeNull();
    expect(pickWeaknessNudge([e("logic", "retest_demonstrated", 1)])).toBeNull();
  });
  it("picks the skill with most unresolved evidence", () => {
    const n = pickWeaknessNudge([
      e("logic", "retest_not_demonstrated", 1), e("evidence", "retest_not_demonstrated", 2),
      e("evidence", "repair_not_landed", 3),
    ]);
    expect(n).toEqual({ kind: "evidence", unresolved: 2, evidence: "repeated" });
  });
  it("labels a single observation insufficient_evidence", () => {
    const n = pickWeaknessNudge([e("impact", "repair_not_landed", 1)])!;
    expect(n.evidence).toBe("insufficient_evidence");
    expect(nudgeCopy(n).detail).toContain("insufficient evidence");
  });
  it("drops a skill once the latest outcome passed", () => {
    expect(pickWeaknessNudge([e("logic", "retest_not_demonstrated", 1), e("logic", "retest_demonstrated", 2)])).toBeNull();
  });
});
