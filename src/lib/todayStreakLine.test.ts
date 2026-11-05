import { describe, expect, it } from "vitest";
import { formatCountdown, motionDebatersLine, msUntilNextMotion, todayStreakLine, weekStatsLine } from "./todayStreakLine";
import type { StreakStatus } from "./streakFreeze";

describe("msUntilNextMotion", () => {
  it("counts down to 00:00 UTC, when the shared motion rolls over", () => {
    expect(msUntilNextMotion(new Date("2026-11-05T16:48:00Z"))).toBe((7 * 60 + 12) * 60_000);
    expect(msUntilNextMotion(new Date("2026-11-05T00:00:00Z"))).toBe(86_400_000);
    expect(msUntilNextMotion(new Date("2026-11-05T23:59:30Z"))).toBe(30_000);
    expect(msUntilNextMotion(new Date(Number.NaN))).toBe(0);
  });
});

describe("formatCountdown", () => {
  it("reads in hours and minutes", () => {
    expect(formatCountdown((7 * 60 + 12) * 60_000 + 59_000)).toBe("7h 12m");
    expect(formatCountdown(45 * 60_000)).toBe("45m");
    expect(formatCountdown(59_000)).toBe("under a minute");
    expect(formatCountdown(-5)).toBe("under a minute");
  });
});

const due = (streak: number): StreakStatus => ({ state: "due_today", streak, frozenDay: null });
const none: StreakStatus = { state: "none", streak: 0 };

describe("todayStreakLine", () => {
  it("calls out a streak that ends tonight, only in the evening", () => {
    expect(todayStreakLine({ status: due(5), longestStreak: 5, hasPractised: true, localHour: 18 })).toEqual({
      kind: "at_risk",
      text: "Your 5-day streak ends at midnight. Today's motion takes about four minutes.",
    });
    expect(todayStreakLine({ status: due(5), longestStreak: 5, hasPractised: true, localHour: 17 })).toBeNull();
  });

  it("leaves practised days and held freezes to their own lines", () => {
    const practised: StreakStatus = { state: "practised_today", streak: 3, frozenDay: null };
    const holding: StreakStatus = { state: "freeze_holding", streak: 3, frozenDay: "2026-11-04" };
    expect(todayStreakLine({ status: practised, longestStreak: 3, hasPractised: true, localHour: 20 })).toBeNull();
    expect(todayStreakLine({ status: holding, longestStreak: 3, hasPractised: true, localHour: 20 })).toBeNull();
  });

  it("welcomes a learner back after a lapse, naming the best streak", () => {
    expect(todayStreakLine({ status: none, longestStreak: 12, hasPractised: true, localHour: 9 })).toEqual({
      kind: "welcome_back",
      text: "Welcome back. Your best streak is 12 days; today starts a new one.",
    });
    expect(todayStreakLine({ status: none, longestStreak: 1, hasPractised: true, localHour: 9 })).toBeNull();
    expect(todayStreakLine({ status: none, longestStreak: 0, hasPractised: false, localHour: 9 })).toBeNull();
  });
});

describe("weekStatsLine", () => {
  it("shows the best streak and debates finished once there is something to count", () => {
    expect(weekStatsLine(12, 23)).toBe("Best streak 12 days · 23 debates");
    expect(weekStatsLine(1, 1)).toBe("1 debate");
    expect(weekStatsLine(0, 0)).toBeNull();
  });
});

describe("motionDebatersLine", () => {
  it("shows a real count only once it means company", () => {
    expect(motionDebatersLine(1420)).toBe("1,420 people have debated today's motion");
    expect(motionDebatersLine(10)).toBe("10 people have debated today's motion");
    expect(motionDebatersLine(9)).toBeNull();
    expect(motionDebatersLine(null)).toBeNull();
  });
});
