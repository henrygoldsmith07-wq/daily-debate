import "server-only";

import { createServiceClient } from "@/lib/backend/server";
import { summariseSecondOpinions, type SecondOpinionSummary } from "@/lib/repairSecondOpinion";

const WINDOW = 500;

export function opinionsFromCoaching(rows: readonly { coaching: unknown }[]): { repairReused?: boolean; restatesOriginal?: boolean }[] {
  const out: { repairReused?: boolean; restatesOriginal?: boolean }[] = [];
  for (const row of rows) {
    const c = row.coaching as { retestOutcome?: { secondOpinion?: { repairReused?: unknown; restatesOriginal?: unknown } | null } } | null;
    const so = c?.retestOutcome?.secondOpinion;
    if (!so || typeof so !== "object") continue;
    out.push({ repairReused: so.repairReused === true, restatesOriginal: so.restatesOriginal === true });
  }
  return out;
}

export async function loadSecondOpinionSummary(): Promise<SecondOpinionSummary | null> {
  try {
    const db = createServiceClient();
    const { data, error } = await db
      .from("solo_debates")
      .select("coaching")
      .not("coaching->retestOutcome->secondOpinion", "is", null)
      .order("created_at", { ascending: false })
      .limit(WINDOW);
    if (error) return null;
    return summariseSecondOpinions(opinionsFromCoaching((data ?? []) as { coaching: unknown }[]));
  } catch {
    return null;
  }
}
