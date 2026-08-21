import { describe, it, expect } from "vitest";
import { pointsForTurn, levelForPoints, updateStreak } from "./gamification";

describe("gamification", () => {
  it("pointsForTurn sums 5 factors", () => {
    expect(pointsForTurn({ depth: 8, evidence: 7, logic: 6, rebuttal: 5, clarity: 9 })).toBe(35);
  });
  it("levelForPoints increments every 500", () => {
    expect(levelForPoints(0)).toBe(1);
    expect(levelForPoints(499)).toBe(1);
    expect(levelForPoints(500)).toBe(2);
    expect(levelForPoints(1200)).toBe(3);
  });
  it("updateStreak: same day is idempotent, consecutive increments, gap resets", () => {
    expect(updateStreak("2026-01-10", "2026-01-10", 3, 3).current_streak).toBe(3);
    expect(updateStreak("2026-01-11", "2026-01-10", 3, 3).current_streak).toBe(4);
    expect(updateStreak("2026-01-12", "2026-01-10", 3, 3).current_streak).toBe(1);
    expect(updateStreak("2026-01-10", null, 0, 0).current_streak).toBe(1);
  });
});
