import type { BackendClient } from "@/lib/backend/client";
import type { DebateSide } from "@/lib/types";
import {
  assignChallengeSide,
  challengeSeed,
  normaliseSoloPerformance,
  seededChallengeRandom,
  type ChallengeAssignment,
  type SideHistoryItem,
} from "@/lib/challengeMe";

/**
 * Resolve the signed-in "Challenge me" side for (user, motion).
 *
 * ONE function serves both the home screen's pre-start reveal and the start
 * route, so the side the learner is shown is the side the debate opens on:
 * same history query, same heuristic, same seeded coin flip. (The only way
 * they can differ is if a debate completes between the two reads — then the
 * start honestly uses the newer history.)
 */
export async function loadChallengeAssignment(params: {
  db: BackendClient;
  userId: string;
  topicId: string;
}): Promise<ChallengeAssignment> {
  const { db, userId, topicId } = params;
  const { data: historyRows, error: historyError } = await db
    .from("solo_debates")
    .select("id, side, total_score, performance_score")
    .eq("user_id", userId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(8);
  let historyUnavailable = historyError !== null && historyError !== undefined;
  if (historyUnavailable) {
    console.warn("Challenge Me history unavailable; using a random side.");
  }

  const rows = (historyRows ?? []) as Array<{
    id: string;
    side: string;
    total_score: number | null;
    performance_score: number | null;
  }>;

  const legacyIds = rows
    .filter((row) => typeof row.performance_score !== "number")
    .map((row) => row.id);
  const answeredByDebate = new Map<string, number>();

  if (legacyIds.length) {
    const { data: answeredTurns, error: answeredTurnsError } = await db
      .from("solo_debate_turns")
      .select("debate_id, id")
      .in("debate_id", legacyIds)
      .not("user_message", "is", null);
    if (answeredTurnsError) {
      historyUnavailable = true;
      console.warn("Challenge Me legacy turn history unavailable; using a random side.");
    } else {
      for (const row of (answeredTurns ?? []) as Array<{ debate_id: string }>) {
        answeredByDebate.set(row.debate_id, (answeredByDebate.get(row.debate_id) ?? 0) + 1);
      }
    }
  }

  const history: SideHistoryItem[] = [...rows].reverse().map((row) => ({
    side: row.side as DebateSide,
    performanceScore:
      typeof row.performance_score === "number"
        ? row.performance_score
        : normaliseSoloPerformance(
            typeof row.total_score === "number" ? row.total_score : null,
            answeredByDebate.get(row.id) ?? 0,
          ),
  }));

  return assignChallengeSide(history, {
    historyUnavailable,
    random: seededChallengeRandom(challengeSeed(userId, topicId)),
  });
}
