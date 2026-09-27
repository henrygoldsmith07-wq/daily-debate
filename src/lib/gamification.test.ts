import { performanceScoreForTurns, describe, it, expect } from "vitest";
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


describe("performanceScoreForTurns", () => {
  it("normalizes debate performance independently of round count", () => {
    expect(performanceScoreForTurns([25, 25, 25, 25, 25])).toBe(50);
    expect(performanceScoreForTurns(Array.from({ length: 12 }, () => 25))).toBe(50);
  });

  it("clamps and handles missing scores", () => {
    expect(performanceScoreForTurns([])).toBe(0);
    expect(performanceScoreForTurns([50])).toBe(100);
    expect(performanceScoreForTurns([60])).toBe(100);
  });
});
