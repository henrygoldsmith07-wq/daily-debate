import { describe, expect, it } from "vitest";
import { pickPriority, type PriorityInputs } from "./dailyFocus";

const base: PriorityInputs = {
  unfinishedRepair: null,
  dueRetest: null,
  openDrill: null,
  debateAvailable: true,
};

const repair = { debateId: "d5", label: "Evidence", nextCue: "name a specific source" };
const retest = { label: "Rebuttal" };
const drill = { title: "Answer the strongest argument" };

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
      unfinishedRepair: repair,
      dueRetest: retest,
      openDrill: drill,
    });
    expect(action?.kind).toBe("repair");
    expect(action?.href).toBe("/debate/d5");
    expect(action?.title).toMatch(/evidence rewrite/i);
    expect(action?.detail).toContain("name a specific source");
  });

  it("puts a due retest above drills and today's debate", () => {
    const action = pickPriority({
      ...base,
      dueRetest: retest,
      openDrill: drill,
    });
    expect(action?.kind).toBe("retest");
    expect(action?.title).toMatch(/retest: rebuttal is due/i);
    expect(action?.detail).toMatch(/different motion/i);
    expect(action?.href).toBe("/");
  });

  it("puts an active drill above today's debate", () => {
    const action = pickPriority({ ...base, openDrill: drill });
    expect(action?.kind).toBe("drill");
    expect(action?.title).toContain("Answer the strongest argument");
  });

  it("falls back to a plain detail line when the repair has no cue", () => {
    const action = pickPriority({ ...base, unfinishedRepair: { ...repair, nextCue: null } });
    expect(action?.detail).not.toContain("Next cue");
    expect(action?.detail).toMatch(/most valuable part/i);
  });

  it("produces exactly one action or none — never competing cards", () => {
    const action = pickPriority({
      ...base,
      unfinishedRepair: repair,
      dueRetest: retest,
      openDrill: drill,
      debateAvailable: true,
    });
    expect(action).not.toBeNull();
    expect(["repair", "retest", "drill", "debate"]).toContain(action!.kind);
  });
});
