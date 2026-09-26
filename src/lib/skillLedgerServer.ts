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
  const { data: debates } = await db
    .from("solo_debates")
    .select("id, completed_at, topic_id")
    .eq("user_id", userId)
    .eq("status", "completed")
    .order("completed_at", { ascending: true })
    .limit(100);

  const completed = (debates ?? []) as CompletedLedgerDebateRow[];
  const debateIds = completed.map((debate) => debate.id);
  const { data: turnRows } = debateIds.length
    ? await db
        .from("solo_debate_turns")
        .select("debate_id, round_number, assessment, scores")
        .in("debate_id", debateIds)
    : { data: [] };
  const points = buildLedgerPointsFromRows(completed, (turnRows ?? []) as LedgerTurnRow[]);

  const ledger = buildSkillLedger(points, opts);
  return { ...ledger, points };
}
