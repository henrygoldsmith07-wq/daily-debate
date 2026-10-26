import { describe, expect, it } from "vitest";
import { historyLoopFor, historyLoopMap } from "./historyLoop";

const repair = (over: Record<string, unknown>) => ({
  debate_id: "d1",
  succeeded: true,
  retest_debate_id: null,
  retest_outcome: null,
  ...over,
}) as Parameters<typeof historyLoopFor>[1][number];

describe("historyLoopFor", () => {
  it("marks a debate whose weakness was repaired", () => {
    expect(historyLoopFor("d1", [repair({})])).toEqual({ repair: "repaired", retest: null });
  });
  it("distinguishes an unsuccessful repair attempt", () => {
    expect(historyLoopFor("d1", [repair({ succeeded: false })]).repair).toBe("attempted");
  });
  it("any successful repair on the debate wins over a failed one", () => {
    expect(historyLoopFor("d1", [repair({ succeeded: false }), repair({})]).repair).toBe("repaired");
  });
  it("shows a stored retest verdict on the debate that carried it, with shared wording", () => {
    const rows = [repair({ retest_debate_id: "d2", retest_outcome: "skill-not-observed" })];
    expect(historyLoopFor("d2", rows)).toEqual({
      repair: null,
      retest: { outcome: "skill-not-observed", label: "Skill not observed this time" },
    });
  });
  it("never reveals a pending retest (assignment without a verdict)", () => {
    const rows = [repair({ retest_debate_id: "d2", retest_outcome: null })];
    expect(historyLoopFor("d2", rows)).toEqual({ repair: null, retest: null });
  });
  it("is empty for unrelated debates", () => {
    expect(historyLoopFor("d9", [repair({})])).toEqual({ repair: null, retest: null });
  });
});

describe("historyLoopMap", () => {
  it("only contains debates with loop state", () => {
    const m = historyLoopMap(["d1", "d2", "d3"], [repair({ retest_debate_id: "d2", retest_outcome: "skill-observed" })]);
    expect([...m.keys()].sort()).toEqual(["d1", "d2"]);
  });
});
