import { describe, expect, it } from "vitest";
import { isMotionPosition, MIN_POSITIONS_TO_SHOW, oppositePosition, positionTallyView } from "./positionTally";

describe("positionTallyView", () => {
  it("stays silent below the minimum, so a quiet day cannot identify anyone", () => {
    expect(positionTallyView({ for: MIN_POSITIONS_TO_SHOW - 1, against: 0 })).toBeNull();
    expect(positionTallyView(null)).toBeNull();
  });

  it("shows rounded shares that always add up to 100", () => {
    expect(positionTallyView({ for: 2, against: 1 + MIN_POSITIONS_TO_SHOW })).toMatchObject({ total: 13 });
    for (const [f, a] of [[1, 2], [5, 7], [33, 67], [1, 9]] as const) {
      const view = positionTallyView({ for: f * 10, against: a * 10 });
      expect(view && view.forShare + view.againstShare).toBe(100);
    }
  });

  it("ignores negative or fractional counts", () => {
    expect(positionTallyView({ for: -5, against: 10.9 })).toEqual({ total: 10, forShare: 0, againstShare: 100 });
  });
});

describe("positions", () => {
  it("accepts only for and against", () => {
    expect(isMotionPosition("for")).toBe(true);
    expect(isMotionPosition("against")).toBe(true);
    expect(isMotionPosition("challenge")).toBe(false);
    expect(isMotionPosition(null)).toBe(false);
  });

  it("knows each side's opposite", () => {
    expect(oppositePosition("for")).toBe("against");
    expect(oppositePosition("against")).toBe("for");
  });
});
