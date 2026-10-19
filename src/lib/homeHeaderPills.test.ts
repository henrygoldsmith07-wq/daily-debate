import { describe, expect, it } from "vitest";
import { homeHeaderPills } from "./homeHeaderPills";

describe("homeHeaderPills", () => {
  it("shows nothing for a brand-new account", () => {
    expect(homeHeaderPills({ current_streak: 0, level: 1, total_points: 0 })).toEqual([]);
  });

  it("shows nothing without a profile", () => {
    expect(homeHeaderPills(null)).toEqual([]);
    expect(homeHeaderPills(undefined)).toEqual([]);
  });

  it("shows level and points once points are earned, even after a streak lapses", () => {
    expect(homeHeaderPills({ current_streak: 0, level: 2, total_points: 140 })).toEqual(["Level 2", "140 pts"]);
  });

  it("shows all three for an active user", () => {
    expect(homeHeaderPills({ current_streak: 3, level: 2, total_points: 140 })).toEqual([
      "🔥 3-day streak",
      "Level 2",
      "140 pts",
    ]);
  });
});
