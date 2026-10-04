import { describe, expect, it } from "vitest";
import { buildMilestones, MILESTONE_CONSISTENCY_DEBATES, type MilestoneInputs } from "./milestones";
import type { RepairRecord } from "./retest";

function repair(over: Partial<RepairRecord> = {}): RepairRecord {
  return {
    id: "r1",
    user_id: "u1",
    debate_id: "d1",
    target_kind: "rebuttal",
    source_text: "s",
    rewrite_text: "w",
    score: 80,
    succeeded: true,
    created_at: "2026-06-01T00:00:00Z",
    retest_debate_id: null,
    ...over,
  };
}

function obs(met: number, opportunities: number) {
  return Array.from({ length: opportunities }, (_, i) => ({
    debateId: `d${i}`,
    completedAt: `2026-06-0${i + 1}T00:00:00Z`,
    opportunities: 1,
    met: i < met ? 1 : 0,
  }));
}

describe("buildMilestones", () => {
  it("marks nothing achieved with an empty history", () => {
    const milestones = buildMilestones({ repairs: [], observationsByKind: {}, completedLoops: 0 });
    expect(milestones.every((m) => !m.achieved)).toBe(true);
    expect(milestones.find((m) => m.id === "first-repair")?.remaining).toMatch(/repair one flagged move/i);
  });

  it("achieves first repair and first retest only from real rows", () => {
    const inputs: MilestoneInputs = {
      repairs: [repair({ retest_debate_id: "d9", retest_outcome: "skill-observed", retest_completed_at: "2026-06-10T00:00:00Z" })],
      observationsByKind: {},
      completedLoops: 1,
    };
    const milestones = buildMilestones(inputs);
    expect(milestones.find((m) => m.id === "first-repair")?.achieved).toBe(true);
    expect(milestones.find((m) => m.id === "first-retest")?.achieved).toBe(true);
  });

  it("does not grant the retest milestone on skill-not-observed", () => {
    const inputs: MilestoneInputs = {
      repairs: [repair({ retest_debate_id: "d9", retest_outcome: "skill-not-observed", retest_completed_at: "2026-06-10T00:00:00Z" })],
      observationsByKind: {},
      completedLoops: 1,
    };
    const milestones = buildMilestones(inputs);
    expect(milestones.find((m) => m.id === "first-retest")?.achieved).toBe(false);
    expect(milestones.find((m) => m.id === "first-retest")?.remaining).toMatch(/training list/i);
  });

  it("requires repeated observed behaviour for the consistency milestone", () => {
    const partial: MilestoneInputs = {
      repairs: [],
      observationsByKind: { rebuttal: obs(2, 3) },
      completedLoops: 0,
    };
    expect(buildMilestones(partial).find((m) => m.id === "consistency")?.achieved).toBe(false);

    const full: MilestoneInputs = {
      repairs: [],
      observationsByKind: { rebuttal: obs(3, 3) },
      completedLoops: 0,
    };
    const milestone = buildMilestones(full).find((m) => m.id === "consistency");
    expect(milestone?.achieved).toBe(true);
    expect(milestone?.title).toContain("3 eligible debates");
  });

  it("never grants the consistency milestone below the minimum sample", () => {
    const inputs: MilestoneInputs = {
      repairs: [],
      observationsByKind: { rebuttal: obs(2, 2) },
      completedLoops: 0,
    };
    expect(buildMilestones(inputs).find((m) => m.id === "consistency")?.achieved).toBe(false);
    expect(MILESTONE_CONSISTENCY_DEBATES).toBe(3);
  });

  it("counts completed loops toward the ten-loop milestone", () => {
    expect(buildMilestones({ repairs: [], observationsByKind: {}, completedLoops: 10 }).find((m) => m.id === "loop-10")?.achieved).toBe(true);
    const nine = buildMilestones({ repairs: [], observationsByKind: {}, completedLoops: 9 }).find((m) => m.id === "loop-10");
    expect(nine?.achieved).toBe(false);
    expect(nine?.remaining).toBe("1 more full loops to go.");
  });
});
