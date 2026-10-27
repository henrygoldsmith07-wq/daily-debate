import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/backend/server";

export type ProfileSummary = {
  total_points: number;
  level: number;
  current_streak: number;
  /** The profile's last practice day (user's time zone), which the week row needs. */
  last_activity_date: string | null;
  timezone: string;
  timezone_initialized_at: string | null;
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
    .select("total_points, level, current_streak, last_activity_date, timezone, timezone_initialized_at")
    .eq("id", userId)
    .single();
  return data;
});
