import { describe, it, expect, afterEach } from "vitest";
import { performanceScoreForTurns, pointsForTurn, levelForPoints, updateStreak } from "./gamification";

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

describe("updateStreak host-timezone independence", () => {
  const original = process.env.TZ;
  afterEach(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  it.each(["America/Los_Angeles", "Pacific/Auckland", "UTC"])(
    "continues a streak across a month and DST boundary in %s",
    (tz) => {
      process.env.TZ = tz;
      expect(updateStreak("2026-11-01", "2026-10-31", 4, 4).current_streak).toBe(5);
      expect(updateStreak("2026-03-29", "2026-03-28", 2, 2).current_streak).toBe(3);
      expect(updateStreak("2026-10-26", "2026-10-24", 4, 9).current_streak).toBe(1);
    },
  );

  it("restarts at 1 for an unparseable today instead of throwing", () => {
    expect(updateStreak("not-a-date", "2026-10-25", 3, 3).current_streak).toBe(1);
  });
});
