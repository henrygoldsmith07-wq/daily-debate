import { describe, expect, it } from "vitest";
import { addGuestPracticeDay, parseGuestPracticeDays, streakDays, weekDays } from "./weekStreak";
import { DAILY_ACCENT_HUES, dailyAccentHue } from "./dailyAccent";

describe("weekDays", () => {
  it("runs Monday to Sunday around today", () => {
    // 2026-10-28 is a Wednesday.
    const days = weekDays("2026-10-28", ["2026-10-26", "2026-10-28"]);
    expect(days.map((d) => d.key)).toEqual([
      "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01",
    ]);
    expect(days.map((d) => d.practised)).toEqual([true, false, true, false, false, false, false]);
    expect(days.find((d) => d.isToday)?.key).toBe("2026-10-28");
    expect(days.filter((d) => d.isFuture)).toHaveLength(4);
  });

  it("treats Sunday as the end of the week", () => {
    expect(weekDays("2026-11-01", [])[6]).toMatchObject({ key: "2026-11-01", isToday: true });
  });

  it("returns nothing for a malformed day", () => {
    expect(weekDays("not-a-date", [])).toEqual([]);
  });
});

describe("streakDays", () => {
  it("names the consecutive days ending on the last active day", () => {
    expect(streakDays(3, "2026-10-28", "2026-10-28")).toEqual(["2026-10-28", "2026-10-27", "2026-10-26"]);
  });

  it("still counts a streak last extended yesterday", () => {
    expect(streakDays(2, "2026-10-27", "2026-10-28")).toEqual(["2026-10-27", "2026-10-26"]);
  });

  it("drops a lapsed streak instead of drawing stale dots", () => {
    expect(streakDays(5, "2026-10-20", "2026-10-28")).toEqual([]);
  });

  it("caps at a week and ignores zero or missing data", () => {
    expect(streakDays(40, "2026-10-28", "2026-10-28")).toHaveLength(7);
    expect(streakDays(0, "2026-10-28", "2026-10-28")).toEqual([]);
    expect(streakDays(3, null, "2026-10-28")).toEqual([]);
  });
});

describe("guest practice days", () => {
  it("adds a day once and keeps the list sorted", () => {
    const once = addGuestPracticeDay(null, "2026-10-28");
    const twice = addGuestPracticeDay(addGuestPracticeDay(once, "2026-10-26"), "2026-10-28");
    expect(parseGuestPracticeDays(twice)).toEqual(["2026-10-26", "2026-10-28"]);
  });

  it("degrades corrupt storage to an empty week", () => {
    expect(parseGuestPracticeDays("{oops")).toEqual([]);
    expect(parseGuestPracticeDays(JSON.stringify(["2026-10-28", 4, "nope"]))).toEqual(["2026-10-28"]);
  });
});

describe("dailyAccentHue", () => {
  it("is stable per day and changes from one day to the next", () => {
    expect(dailyAccentHue("2026-10-28")).toBe(dailyAccentHue("2026-10-28"));
    expect(dailyAccentHue("2026-10-28")).not.toBe(dailyAccentHue("2026-10-29"));
  });

  it("only ever returns a palette hue", () => {
    for (let day = 1; day <= 28; day += 1) {
      const key = `2026-02-${String(day).padStart(2, "0")}`;
      expect(DAILY_ACCENT_HUES).toContain(dailyAccentHue(key));
    }
    expect(DAILY_ACCENT_HUES).toContain(dailyAccentHue("garbage"));
  });
});
