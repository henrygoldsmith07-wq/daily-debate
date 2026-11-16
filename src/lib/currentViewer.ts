import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/backend/server";
import { streakStatus, type StreakStatus } from "@/lib/streakFreeze";
import { dateKeyInTimeZone } from "@/lib/timeZone";

export type ProfileSummary = {
  total_points: number;
  level: number;
  current_streak: number;
  longest_streak: number;
  /** The profile's last practice day (user's time zone), which the week row needs. */
  last_activity_date: string | null;
  timezone: string;
  timezone_initialized_at: string | null;
  /** Most recent day a streak freeze covered (048). */
  streak_freeze_used_on: string | null;
  /**
   * The streak as it stands today in the learner's timezone. The stored
   * current_streak only changes when they practise, so a lapsed streak would
   * otherwise keep showing; a missed day a freeze will cover still counts.
   */
  streak: StreakStatus;
};

/** Request-scoped viewer lookup shared by pages and AppShell. */
export const getCurrentUser = cache(async () => {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  return user;
});

/** Request-scoped profile summary shared by pages and AppShell. */
export const getProfileSummary = cache(async (userId: string): Promise<ProfileSummary | null> => {
  const db = await createClient();
  const { data } = await db
    .from("profiles")
    .select("total_points, level, current_streak, longest_streak, last_activity_date, timezone, timezone_initialized_at, streak_freeze_used_on")
    .eq("id", userId)
    .single();
  if (!data) return null;
  const row = data as Omit<ProfileSummary, "streak">;
  return {
    ...row,
    streak: streakStatus({
      currentStreak: row.current_streak,
      lastActivityDate: row.last_activity_date,
      freezeUsedOn: row.streak_freeze_used_on ?? null,
      today: dateKeyInTimeZone(row.timezone || "UTC"),
    }),
  };
});
