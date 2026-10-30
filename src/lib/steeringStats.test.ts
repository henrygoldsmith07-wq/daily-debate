import { describe, expect, it } from "vitest";
import { summariseSteering } from "./steeringStats";

describe("summariseSteering", () => {
  it("counts steering kinds and ignores debates without a focus", () => {
    const rows = [
      { dimension: "logic", steering: "re_repair" },
      { dimension: "impact", steering: "moved_on" },
      { dimension: "clarity", steering: null },
      { dimension: null, steering: "moved_on" },
    ];
    const s = summariseSteering(rows, 3);
    expect(s).toMatchObject({ total: 3, reRepair: 1, movedOn: 1, unsteered: 1 });
    expect(s.steeredShare).toBeCloseTo(2 / 3);
  });
  it("withholds the share below the sample gate", () => {
    const s = summariseSteering([{ dimension: "logic", steering: "re_repair" }]);
    expect(s.steeredShare).toBeNull();
    expect(s.note).toContain("insufficient_evidence");
  });
});
