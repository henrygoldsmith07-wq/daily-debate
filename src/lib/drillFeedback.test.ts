import { describe, expect, it } from "vitest";
import { DRILL_FEEDBACK_COPY, drillSignalsFromAttempt, normaliseDrillSignals } from "./drillFeedback";
import { scoreAttempt } from "./adaptiveCoach";

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

describe("recomputing a stored drill attempt", () => {
  const attempt =
    "Because the cost falls most for low-income households, a subsidy would narrow the gap. The OECD reports that transfer payments cut child poverty by about a third.";

  it("reproduces exactly the signals the attempt route returned", () => {
    // The dashboard re-renders the feedback from the stored attempt after the
    // submit-triggered refresh. If the recomputation drifted from the live
    // response, the learner would see one set of observations and then a
    // different one.
    expect(drillSignalsFromAttempt("evidence", attempt)).toEqual(
      normaliseDrillSignals(scoreAttempt("evidence", attempt).signals),
    );
  });

  it("is deterministic", () => {
    expect(drillSignalsFromAttempt("evidence", attempt)).toEqual(
      drillSignalsFromAttempt("evidence", attempt),
    );
  });

  it("returns nothing for a missing, blank or unusable attempt", () => {
    expect(drillSignalsFromAttempt("evidence", null)).toEqual([]);
    expect(drillSignalsFromAttempt("evidence", "   ")).toEqual([]);
    expect(drillSignalsFromAttempt("evidence", undefined)).toEqual([]);
  });

  it("refuses a dimension the coach does not teach", () => {
    // An unknown dimension must not be scored: the rubric is keyed by
    // dimension, so a typo could otherwise produce a fabricated observation.
    expect(drillSignalsFromAttempt("not-a-dimension", attempt)).toEqual([]);
    expect(drillSignalsFromAttempt(null, attempt)).toEqual([]);
  });
});
