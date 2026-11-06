import { describe, expect, it } from "vitest";
import { retestTurnEvidence, summariseEvidence } from "./retestEvidence";

describe("retestTurnEvidence", () => {
  const before = "Everyone knows that remote work is simply better for productivity";
  it("flags the turn where the weak wording persisted", () => {
    const ev = retestTurnEvidence(before, [
      "Studies from Stanford show a 13% gain.",
      "Everyone knows remote work is simply better for productivity.",
    ]);
    expect(ev?.turn).toBe(2);
    expect(ev?.persisted).toBe(true);
  });
  it("reports not persisted when wording changed", () => {
    const ev = retestTurnEvidence(before, ["A Stanford trial measured output across 500 staff over two years."]);
    expect(ev?.persisted).toBe(false);
  });
  it("returns null with no usable input", () => {
    expect(retestTurnEvidence("too short", ["x"])).toBeNull();
    expect(retestTurnEvidence(before, [])).toBeNull();
  });
});

describe("summariseEvidence", () => {
  it("gates small samples", () => {
    expect(summariseEvidence([{ persisted: true }]).label).toBe("insufficient_evidence");
    const s = summariseEvidence(Array.from({ length: 5 }, (_, i) => ({ persisted: i < 2 })));
    expect(s).toMatchObject({ label: "unvalidated", rate: 0.4 });
  });
});
