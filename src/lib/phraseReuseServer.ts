import "server-only";

import { createServiceClient } from "@/lib/backend/server";
import { summariseReuse, type ReuseSummary } from "@/lib/repairPhraseReuse";

const WINDOW = 500;

/** Pure: one pair per debate that carries a retest comparison. */
export function pairsFromCoaching(rows: readonly { coaching: unknown }[]): { reused: boolean }[] {
  const pairs: { reused: boolean }[] = [];
  for (const row of rows) {
    const c = row.coaching as { retestOutcome?: { comparison?: { reusedPhrases?: unknown } | null } } | null;
    const cmp = c?.retestOutcome?.comparison;
    if (!cmp || typeof cmp !== "object") continue;
    pairs.push({ reused: Array.isArray(cmp.reusedPhrases) && cmp.reusedPhrases.length > 0 });
  }
  return pairs;
}

export async function loadPhraseReuseSummary(): Promise<ReuseSummary | null> {
  try {
    const db = createServiceClient();
    const { data, error } = await db
      .from("solo_debates")
      .select("coaching")
      .not("coaching->retestOutcome->comparison", "is", null)
      .order("created_at", { ascending: false })
      .limit(WINDOW);
    if (error) return null;
    return summariseReuse(pairsFromCoaching((data ?? []) as { coaching: unknown }[]));
  } catch {
    return null;
  }
}
