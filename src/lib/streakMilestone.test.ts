import { describe, expect, it } from "vitest";
import { streakMilestone } from "./streakMilestone";

describe("streakMilestone", () => {
  it("marks only the milestone lengths", () => {
    expect(streakMilestone(7)).toEqual({ days: 7, title: "7-day streak", detail: "A full week of debates in a row." });
    expect(streakMilestone(30)).toMatchObject({ title: "30-day streak", detail: "30 days of debates in a row." });
    expect(streakMilestone(365)).toMatchObject({ detail: "A year of debates in a row." });
    for (const n of [0, 1, 6, 8, 31, 99]) expect(streakMilestone(n)).toBeNull();
    expect(streakMilestone(undefined)).toBeNull();
    expect(streakMilestone(null)).toBeNull();
  });
});
