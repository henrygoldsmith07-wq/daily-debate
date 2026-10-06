import { describe, expect, it } from "vitest";
import { DRILL_FEEDBACK_COPY, normaliseDrillSignals } from "./drillFeedback";

describe("drill feedback presentation", () => {
  it("describes drill feedback as formative rather than an ability score", () => {
    expect(DRILL_FEEDBACK_COPY.heading).toBe("Practice checked");
    expect(DRILL_FEEDBACK_COPY.note).toMatch(/formative practice/i);
    expect(DRILL_FEEDBACK_COPY.note).toMatch(/not an ability score/i);

    const learnerCopy = Object.values(DRILL_FEEDBACK_COPY).join(" ");
    expect(learnerCopy).not.toMatch(/\b\d{1,3}\s*\/\s*100\b/);
    expect(learnerCopy).not.toMatch(/attempt scored/i);
  });

  it("keeps only bounded unique learner-facing observations", () => {
    const signals = normaliseDrillSignals([
      " explicit weighing ",
      "explicit weighing",
      "",
      42,
      "cites a real institution",
      "x".repeat(121),
      "engages the opposing move",
    ]);

    expect(signals).toEqual([
      "explicit weighing",
      "cites a real institution",
      "engages the opposing move",
    ]);
  });

  it("caps unexpected API output", () => {
    const signals = normaliseDrillSignals(
      Array.from({ length: 20 }, (_, index) => `signal ${index}`),
    );
    expect(signals).toHaveLength(8);
  });
});
