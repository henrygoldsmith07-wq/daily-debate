import { describe, expect, it } from "vitest";
import { pickPriority, type PriorityInput } from "./dailyFocus";

const base: PriorityInput = {
  unresolvedRepair: null,
  dueRetest: null,
  activeDrill: null,
  debateAvailable: true,
};

const retest = {
  repairId: "r1",
  kind: "rebuttal",
  repairedTopicId: "t1",
  repairedTopicTitle: "Old motion",
  repairedAt: "2026-06-01T00:00:00Z",
};

describe("pickPriority", () => {
  it("returns today's debate when nothing is unfinished", () => {
    const action = pickPriority(base);
    expect(action?.kind).toBe("debate");
  });

  it("returns null when there is nothing at all to do", () => {
    expect(pickPriority({ ...base, debateAvailable: false })).toBeNull();
  });

  it("puts an unresolved repair first", () => {
    const action = pickPriority({
      ...base,
      unresolvedRepair: { debateId: "d5", kind: "evidence" },
      dueRetest: retest,
      activeDrill: { id: "dr1", title: "Drill", dimension: "rebuttal" },
    });
    expect(action?.kind).toBe("repair");
    expect(action?.href).toBe("/debate/d5");
    expect(action?.title).toMatch(/evidence repair/i);
  });

  it("puts a due retest above drills and today's debate", () => {
    const action = pickPriority({
      ...base,
      dueRetest: retest,
      activeDrill: { id: "dr1", title: "Drill", dimension: "rebuttal" },
    });
    expect(action?.kind).toBe("retest");
    expect(action?.title).toMatch(/retest: rebuttal is due/i);
    expect(action?.detail).toMatch(/different motion/i);
  });

  it("puts an active drill above today's debate", () => {
    const action = pickPriority({
      ...base,
      activeDrill: { id: "dr1", title: "Answer the strongest argument", dimension: "rebuttal" },
    });
    expect(action?.kind).toBe("drill");
    expect(action?.title).toContain("Answer the strongest argument");
  });

  it("never produces two competing cards — exactly one action or none", () => {
    const action = pickPriority({
      ...base,
      unresolvedRepair: { debateId: "d5", kind: "logic" },
      dueRetest: retest,
      activeDrill: { id: "dr1", title: "Drill", dimension: "logic" },
      debateAvailable: true,
    });
    expect(action).not.toBeNull();
    expect(["repair", "retest", "drill", "debate"]).toContain(action!.kind);
  });
});
