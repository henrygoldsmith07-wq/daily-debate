// Server-side ledger assembly: loads a user's completed solo debates and
// their stored per-turn observable assessments, merges each debate into one
// deterministic assessment, and feeds the pure skill-ledger math.

import { createClient } from "@/lib/backend/server";
import {
  buildSkillLedger,
  type SkillLedger,
  type SkillMetricPoint,
} from "./skillLedger";
import {
  buildLedgerPointsFromRows,
  type CompletedLedgerDebateRow,
  type LedgerTurnRow,
} from "./skillLedgerAssembly";

export interface LedgerWithSeries extends SkillLedger {
  points: SkillMetricPoint[];
}

export async function buildLedgerForUser(
  userId: string,
  opts: { includeBaseline?: boolean } = {},
): Promise<LedgerWithSeries> {
  const db = await createClient();
  const { data: debates, error: debatesError } = await db
    .from("solo_debates")
    .select("id, completed_at, topic_id, coaching")
    .eq("user_id", userId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(100);
  if (debatesError) {
    throw new Error(`skill-ledger debates unavailable: ${debatesError.message ?? "read failed"}`);
  }

  // Query newest-first so the bounded window never drops recent coaching and
  // retest evidence, then restore chronological order for trajectory math.
  const completed = [...((debates ?? []) as CompletedLedgerDebateRow[])].reverse();
  const debateIds = completed.map((debate) => debate.id);
  const turnResult = debateIds.length
    ? await db
        .from("solo_debate_turns")
        .select("debate_id, round_number, assessment, scores, training_meta")
        .in("debate_id", debateIds)
    : { data: [], error: null };
  if (turnResult.error) {
    throw new Error(`skill-ledger turns unavailable: ${turnResult.error.message ?? "read failed"}`);
  }
  const turnRows = turnResult.data;
  const points = buildLedgerPointsFromRows(completed, (turnRows ?? []) as LedgerTurnRow[]);

  const ledger = buildSkillLedger(points, opts);
  return { ...ledger, points };
}
