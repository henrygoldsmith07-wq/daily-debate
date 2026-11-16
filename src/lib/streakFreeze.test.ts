import { describe, expect, it } from "vitest";
import {
  STREAK_FREEZE_COOLDOWN_DAYS,
  freezeAvailableFor,
  streakFreezeNote,
  streakPractisedDays,
  streakStatus,
} from "./streakFreeze";

const TODAY = "2026-10-28";
const status = (currentStreak: number, lastActivityDate: string | null, freezeUsedOn: string | null = null) =>
  streakStatus({ currentStreak, lastActivityDate, freezeUsedOn, today: TODAY });

describe("freezeAvailableFor", () => {
  it("allows one freeze per seven days, matching migration 048", () => {
    expect(STREAK_FREEZE_COOLDOWN_DAYS).toBe(7);
    expect(freezeAvailableFor("2026-10-27", null)).toBe(true);
    expect(freezeAvailableFor("2026-10-27", "2026-10-20")).toBe(true);
    expect(freezeAvailableFor("2026-10-27", "2026-10-21")).toBe(false);
    expect(freezeAvailableFor("not-a-day", null)).toBe(false);
  });
});

describe("streakStatus", () => {
  it("keeps a streak practised today or yesterday", () => {
    expect(status(3, TODAY)).toEqual({ state: "practised_today", streak: 3, frozenDay: null });
    expect(status(2, "2026-10-27")).toEqual({ state: "due_today", streak: 2, frozenDay: null });
  });

  it("holds a streak over one missed day while a freeze is available", () => {
    expect(status(5, "2026-10-26")).toEqual({ state: "freeze_holding", streak: 5, frozenDay: "2026-10-27" });
    expect(status(5, "2026-10-26", "2026-10-22")).toEqual({ state: "none", streak: 0 });
  });

  it("drops a streak after two missed days, or with no streak", () => {
    expect(status(5, "2026-10-25")).toEqual({ state: "none", streak: 0 });
    expect(status(0, TODAY)).toEqual({ state: "none", streak: 0 });
    expect(status(3, null)).toEqual({ state: "none", streak: 0 });
    expect(status(3, "2026-10-29")).toEqual({ state: "none", streak: 0 });
  });

  it("reports a freeze used inside the visible streak", () => {
    expect(status(6, TODAY, "2026-10-27")).toEqual({ state: "practised_today", streak: 6, frozenDay: "2026-10-27" });
    expect(status(9, TODAY, "2026-10-18")).toEqual({ state: "practised_today", streak: 9, frozenDay: null });
  });
});

describe("streakPractisedDays", () => {
  it("names consecutive days ending on the last practised day, capped at a week", () => {
    expect(streakPractisedDays(status(3, TODAY), TODAY)).toEqual(["2026-10-28", "2026-10-27", "2026-10-26"]);
    expect(streakPractisedDays(status(40, TODAY), TODAY)).toHaveLength(7);
    expect(streakPractisedDays(status(5, "2026-10-20"), "2026-10-20")).toEqual([]);
  });

  it("skips the frozen day, which was kept rather than practised", () => {
    expect(streakPractisedDays(status(3, TODAY, "2026-10-27"), TODAY)).toEqual(["2026-10-28", "2026-10-26", "2026-10-25"]);
    expect(streakPractisedDays(status(2, "2026-10-26"), "2026-10-26")).toEqual(["2026-10-26", "2026-10-25"]);
  });
});

describe("streakFreezeNote", () => {
  it("says what to do while a freeze is holding, and what happened after", () => {
    expect(streakFreezeNote(status(5, "2026-10-26"), TODAY)).toBe(
      "A streak freeze is covering yesterday. Debate today to keep your 5-day streak.",
    );
    expect(streakFreezeNote(status(6, TODAY, "2026-10-27"), TODAY)).toBe(
      "A streak freeze covered yesterday, so your streak carried on.",
    );
    expect(streakFreezeNote(status(6, TODAY, "2026-10-24"), TODAY)).toBeNull();
    expect(streakFreezeNote(status(2, "2026-10-27"), TODAY)).toBeNull();
  });
});
