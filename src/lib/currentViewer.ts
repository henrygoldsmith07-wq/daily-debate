import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/backend/server";

export type ProfileSummary = {
  total_points: number;
  level: number;
  current_streak: number;
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
    .select("total_points, level, current_streak")
    .eq("id", userId)
    .single();
  return data;
});
