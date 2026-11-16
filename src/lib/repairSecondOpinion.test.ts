import { describe, expect, it } from "vitest";
import { overlapWithOriginal, secondOpinionFor } from "./repairSecondOpinion";

const base = { skillLabel: "Evidence", retestTurns: ["I think policy matters a lot here."] };

describe("secondOpinionFor", () => {
  it("returns null unless the skill was not observed", () => {
    expect(secondOpinionFor({ ...base, outcome: "skill-observed", before: "a b c", after: "d e f" })).toBeNull();
    expect(secondOpinionFor({ ...base, outcome: "not-enough-evidence", before: "a b c", after: "d e f" })).toBeNull();
  });
  it("returns null with missing text", () => {
    expect(secondOpinionFor({ ...base, outcome: "skill-not-observed", before: "", after: "x" })).toBeNull();
  });
  it("flags a repair that restates the original", () => {
    const r = secondOpinionFor({ ...base, outcome: "skill-not-observed", before: "Cities should ban cars because it is better", after: "Cities should ban cars because better" });
    expect(r?.restatesOriginal).toBe(true);
    expect(r?.label).toBe("unvalidated");
  });
  it("flags a repair not reused in the retest", () => {
    const r = secondOpinionFor({ ...base, outcome: "skill-not-observed", before: "Cars are bad", after: "Cite the 2019 audit showing costs fell sharply" });
    expect(r).toMatchObject({ restatesOriginal: false, repairReused: false });
  });
  it("handles a reused-but-unobserved repair", () => {
    const r = secondOpinionFor({ ...base, outcome: "skill-not-observed", before: "Cars are bad", after: "Cite the 2019 audit showing costs fell", retestTurns: ["the 2019 audit showing costs fell, I say"] });
    expect(r?.repairReused).toBe(true);
    expect(r?.suggestion).toMatch(/concrete example/);
  });
});

describe("overlapWithOriginal", () => {
  it("is 0 for empty repair", () => expect(overlapWithOriginal("abc def", "")).toBe(0));
});
