import "server-only";

import { createServiceClient } from "@/lib/backend/server";
import { buildWeeklyLoop, WEEK_MS, type WeeklyLoop } from "./weeklyLoop";

/** Weekly loop summary for one user; bounded reads. */
export async function loadWeeklyLoop(userId: string): Promise<WeeklyLoop> {
  const service = createServiceClient();
  const since = new Date(Date.now() - WEEK_MS).toISOString();
  const [debates, repairs, retests] = await Promise.all([
    service.from("solo_debates").select("completed_at").eq("user_id", userId).eq("status", "completed").gte("completed_at", since).limit(200),
    service.from("repair_results").select("created_at, succeeded").eq("user_id", userId).gte("created_at", since).limit(200),
    service.from("repair_retests").select("completed_at, observable, demonstrated").eq("user_id", userId).not("completed_at", "is", null).order("completed_at", { ascending: false }).limit(200),
  ]);
  for (const r of [debates, repairs, retests]) if (r.error) throw new Error(r.error.message ?? "weekly loop unavailable");
  return buildWeeklyLoop({
    debates: (debates.data ?? []).map((d) => ({ completedAt: d.completed_at })),
    repairs: (repairs.data ?? []).map((r) => ({ createdAt: r.created_at, succeeded: r.succeeded })),
    retests: (retests.data ?? []).map((r) => ({ completedAt: r.completed_at, observable: r.observable, demonstrated: r.demonstrated })),
  });
}
