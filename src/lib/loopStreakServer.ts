import "server-only";

import { createServiceClient } from "@/lib/backend/server";
import { buildLoopStreak, type LoopStreak } from "./loopStreak";

export async function loadLoopStreak(userId: string, timeZone: string): Promise<LoopStreak> {
  const service = createServiceClient();
  const [repairs, retests] = await Promise.all([
    service.from("repair_results").select("created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(400),
    service.from("repair_retests").select("completed_at").eq("user_id", userId).not("completed_at", "is", null).order("completed_at", { ascending: false }).limit(400),
  ]);
  for (const r of [repairs, retests]) if (r.error) throw new Error(r.error.message ?? "loop streak unavailable");
  return buildLoopStreak(
    [...(repairs.data ?? []).map((r) => r.created_at as string), ...(retests.data ?? []).map((r) => r.completed_at as string)],
    timeZone,
  );
}
