import { describe, expect, it } from "vitest";
import { practiceCalendar, practisedDayCount } from "./practiceCalendar";

describe("practiceCalendar", () => {
  // 2026-11-06 is a Friday.
  const TODAY = "2026-11-06";

  it("lays out 12 Monday-first weeks ending with this week", () => {
    const grid = practiceCalendar([], "UTC", TODAY);
    expect(grid).toHaveLength(12);
    expect(grid.every((week) => week.length === 7)).toBe(true);
    expect(grid[11][0].key).toBe("2026-11-02");
    expect(grid[0][0].key).toBe("2026-08-17");
    expect(grid[11].filter((day) => day.isFuture).map((day) => day.key)).toEqual(["2026-11-07", "2026-11-08"]);
  });

  it("counts finished debates by the learner's local day, capped at level 3", () => {
    const grid = practiceCalendar(
      [
        "2026-11-05T23:30:00Z", // 6 Nov in Berlin
        "2026-11-06T08:00:00Z",
        "2026-11-04T10:00:00Z",
        "2026-11-04T11:00:00Z",
        "2026-11-04T12:00:00Z",
        "2026-11-04T13:00:00Z",
        "not a date",
        null,
      ],
      "Europe/Berlin",
      TODAY,
    );
    const week = grid[11];
    expect(week[4]).toMatchObject({ key: "2026-11-06", count: 2, level: 2 });
    expect(week[2]).toMatchObject({ key: "2026-11-04", count: 4, level: 3 });
    expect(week[3]).toMatchObject({ count: 0, level: 0 });
    expect(practisedDayCount(grid)).toBe(2);
  });

  it("returns nothing for a malformed day", () => {
    expect(practiceCalendar([], "UTC", "nope")).toEqual([]);
  });
});
