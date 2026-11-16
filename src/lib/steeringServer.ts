import "server-only";

import { createServiceClient } from "./backend/server";
import { summariseSteering, type SteeringRow, type SteeringSummary } from "./steeringStats";

const WINDOW_DAYS = 30;
const MAX_ROWS = 2000;

/** Focus-steering counts from solo_debates.coaching over the last 30 days; null when unreadable. */
export async function loadSteeringSummary(): Promise<(SteeringSummary & { windowDays: number; truncated: boolean }) | null> {
  try {
    const service = createServiceClient();
    const { data, error } = await service
      .from("solo_debates")
      .select("coaching")
      .gte("created_at", new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS + 1);
    if (error) return null;
    const rows = (data ?? []) as Array<{ coaching: SteeringRow | null }>;
    const truncated = rows.length > MAX_ROWS;
    const mapped = rows.slice(0, MAX_ROWS).map((r) => ({
      dimension: r.coaching?.dimension ?? null,
      steering: r.coaching?.steering ?? null,
    }));
    return { ...summariseSteering(mapped), windowDays: WINDOW_DAYS, truncated };
  } catch {
    return null;
  }
}
