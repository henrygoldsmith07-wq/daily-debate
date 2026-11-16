import { describe, expect, it } from "vitest";
import { reusedRepairPhrases, summariseReuse } from "./repairPhraseReuse";

describe("reusedRepairPhrases", () => {
  it("finds a repair phrase reused in a retest turn", () => {
    const hits = reusedRepairPhrases("Cite the 2019 city audit showing costs fell.", ["As the 2019 city audit showing costs fell proves, ..."]);
    expect(hits).toContain("the 2019 city");
  });
  it("returns nothing when no phrase overlaps or inputs are empty", () => {
    expect(reusedRepairPhrases("alpha beta gamma delta", ["one two three four"])).toEqual([]);
    expect(reusedRepairPhrases("", ["x y z"])).toEqual([]);
  });
  it("ignores all-stopword trigrams", () => {
    expect(reusedRepairPhrases("it is the", ["it is the"])).toEqual([]);
  });
  it("caps results", () => {
    const t = "one two three four five six seven eight";
    expect(reusedRepairPhrases(t, [t], 2)).toHaveLength(2);
  });
});

describe("summariseReuse", () => {
  it("is insufficient_evidence below the sample gate", () => {
    expect(summariseReuse([{ reused: true }])).toMatchObject({ label: "insufficient_evidence", rate: null });
  });
  it("reports an unvalidated rate at the gate", () => {
    const r = summariseReuse([true, true, false, false, false].map((reused) => ({ reused })));
    expect(r).toMatchObject({ label: "unvalidated", rate: 0.4 });
  });
});
