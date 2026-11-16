import { describe, expect, it } from "vitest";
import { addGuestPracticeDay, parseGuestPracticeDays, weekDays } from "./weekStreak";
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

  it("marks a frozen day only when it was not practised", () => {
    const days = weekDays("2026-10-28", ["2026-10-26", "2026-10-28"], ["2026-10-27", "2026-10-28"]);
    expect(days.map((d) => d.frozen)).toEqual([false, true, false, false, false, false, false]);
  });

  it("returns nothing for a malformed day", () => {
    expect(weekDays("not-a-date", [])).toEqual([]);
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
