import { randomUUID } from "node:crypto";
import type { BackendClient } from "@/lib/backend/client";
import { debateOpening } from "@/lib/openrouter";
import { debateOpening as anthropicOpening } from "@/lib/anthropic";
import { withProviderFallback } from "@/lib/aiFallback";
import { isValidOpening } from "@/lib/aiSchema";
import { isSpendCapError, retryAfterSecondsToReset } from "@/lib/spendCap";
import type {
  CoachingContextDegradationReason,
  CoachingRecord,
  DebateSide,
  SoloDebate,
  SoloDebateTurn,
} from "@/lib/types";
import type { RepairKind } from "@/lib/argumentRepair";
import type { DebateFormat } from "@/lib/sprint";
import {
  DEFAULT_DIFFICULTY,
  DEFAULT_PERSONA,
  openingDirective,
  type OpponentDifficulty,
  type OpponentPersonaId,
} from "@/lib/opponentPersona";
import {
  assignChallengeSide,
  normaliseSoloPerformance,
  type ChallengeRule,
  type SideHistoryItem,
} from "@/lib/challengeMe";
import { pickFocusDimension } from "@/lib/coachingGoal";
import { loadCoachingContext } from "@/lib/coachingContextServer";

export type SoloStartSideChoice = DebateSide | "challenge";

export type SoloStartPayload = {
  debate: SoloDebate;
  turn: SoloDebateTurn;
  side: DebateSide;
  sideReason: string | null;
  format: SoloDebate["format"];
  persona: OpponentPersonaId;
  difficulty: OpponentDifficulty;
  replayed: boolean;
};

export type SoloStartServiceResult =
  | { ok: true; data: SoloStartPayload }
  | { ok: false; status: 404 | 409 | 500 | 502 | 503; error: string; code?: string; retryAfterSeconds?: number };

type ExistingStart = {
  debate: SoloDebate;
  turn: SoloDebateTurn;
};

export function isSoloStartSideChoice(value: unknown): value is SoloStartSideChoice {
  return value === "challenge" || value === "for" || value === "against";
}

function failure(
  status: 404 | 409 | 500 | 502 | 503,
  error: string,
  code?: string,
  retryAfterSeconds?: number,
): SoloStartServiceResult {
  return { ok: false, status, error, ...(code ? { code } : {}), ...(retryAfterSeconds ? { retryAfterSeconds } : {}) };
}

function existingPayload(existing: ExistingStart): SoloStartPayload {
  const coaching = (existing.debate.coaching ?? {}) as CoachingRecord;
  return {
    debate: existing.debate,
    turn: existing.turn,
    side: existing.debate.side,
    sideReason: coaching.sideReason ?? null,
    format: existing.debate.format,
    persona:
      existing.debate.persona != null
        ? (existing.debate.persona as OpponentPersonaId)
        : DEFAULT_PERSONA,
    difficulty:
      existing.debate.difficulty != null
        ? (existing.debate.difficulty as OpponentDifficulty)
        : DEFAULT_DIFFICULTY,
    replayed: true,
  };
}

export async function startSoloDebate(params: {
  db: BackendClient;
  userId: string;
  topicId: string;
  sideChoice: SoloStartSideChoice;
  format: DebateFormat;
  persona: OpponentPersonaId;
  difficulty: OpponentDifficulty;
}): Promise<SoloStartServiceResult> {
  const { db, userId, topicId, sideChoice, format, persona, difficulty } = params;

  const { data: topic, error: topicError } = await db
    .from("daily_topics")
    .select("*")
    .eq("id", topicId)
    .single();
  if (topicError || !topic) return failure(404, "Topic not found.");

  async function loadExistingStart(): Promise<ExistingStart | null> {
    const { data: existingDebate } = await db
      .from("solo_debates")
      .select("*")
      .eq("user_id", userId)
      .eq("topic_id", topicId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!existingDebate) return null;

    const { data: firstTurn } = await db
      .from("solo_debate_turns")
      .select("*")
      .eq("debate_id", existingDebate.id)
      .eq("round_number", 1)
      .maybeSingle();
    if (!firstTurn) return null;

    return {
      debate: existingDebate as unknown as SoloDebate,
      turn: firstTurn as unknown as SoloDebateTurn,
    };
  }

  // Lost HTTP responses and ordinary retries return the canonical durable start
  // without another provider call.
  const alreadyStarted = await loadExistingStart();
  if (alreadyStarted) return { ok: true, data: existingPayload(alreadyStarted) };

  // Only the claim owner is allowed to call the opening model. Concurrent tabs
  // therefore cannot create duplicate active debates OR duplicate provider work.
  const startToken = randomUUID();
  const { data: claimData, error: claimError } = await db.rpc("claim_solo_debate_start", {
    p_user_id: userId,
    p_topic_id: topicId,
    p_token: startToken,
    p_stale_after_seconds: 300,
  });
  if (claimError) {
    console.error("Failed to claim solo debate start:", claimError);
    return failure(500, "Failed to start debate.");
  }

  const claim = (claimData ?? {}) as { claimed?: boolean; reason?: string; debateId?: string };
  if (!claim.claimed) {
    const winner = await loadExistingStart();
    if (winner) return { ok: true, data: existingPayload(winner) };
    return failure(
      409,
      "This debate is already starting in another tab. Try again in a moment.",
      claim.reason ?? "start-in-progress",
    );
  }

  async function releaseStartClaim() {
    await db.rpc("release_solo_debate_start", {
      p_user_id: userId,
      p_topic_id: topicId,
      p_token: startToken,
    });
  }

  try {
    let side: DebateSide;
    let sideReason: string | null = null;
    let sideRule: ChallengeRule | null = null;

    if (sideChoice === "challenge") {
      const { data: historyRows, error: historyError } = await db
        .from("solo_debates")
        .select("id, side, total_score, performance_score")
        .eq("user_id", userId)
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(8);
      let historyUnavailable = historyError !== null;
      if (historyError) {
        console.warn("Challenge Me history unavailable; using a random side.");
      }

      const legacyIds = (historyRows ?? [])
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
          for (const row of answeredTurns ?? []) {
            answeredByDebate.set(row.debate_id, (answeredByDebate.get(row.debate_id) ?? 0) + 1);
          }
        }
      }

      const history: SideHistoryItem[] = [...(historyRows ?? [])]
        .reverse()
        .map((row) => ({
          side: row.side as DebateSide,
          performanceScore:
            typeof row.performance_score === "number"
              ? row.performance_score
              : normaliseSoloPerformance(
                  typeof row.total_score === "number" ? row.total_score : null,
                  answeredByDebate.get(row.id) ?? 0,
                ),
        }));

      const assignment = assignChallengeSide(history, { historyUnavailable });
      side = assignment.side;
      sideReason = assignment.reason;
      sideRule = assignment.rule;
    } else {
      side = sideChoice;
    }

    let coachingDimension: string | null = null;
    const degradationReasons: CoachingContextDegradationReason[] = [];
    let repairRetest:
      | { repairResultId: string; repairDebateId: string; targetKind: RepairKind; attemptedAt: string }
      | null = null;

    const context = await loadCoachingContext(userId, {
      currentTopicId: topicId,
      reconcileLegacyRetests: true,
    });
    degradationReasons.push(...context.degradationReasons);

    if (context.ledger) {
      const pendingRetest = context.selectedRetest;
      coachingDimension = pickFocusDimension(
        context.ledger.points,
        context.drillOutcomes,
        pendingRetest?.dimension ?? null,
      );

      if (pendingRetest) {
        const anchor = context.repairAnchors.find(
          (candidate) => candidate.repairResultId === pendingRetest.repairResultId,
        );
        if (anchor) {
          repairRetest = {
            repairResultId: pendingRetest.repairResultId,
            repairDebateId: pendingRetest.debateId,
            targetKind: pendingRetest.targetKind,
            attemptedAt: pendingRetest.attemptedAt,
          };
        } else {
          if (!degradationReasons.includes("repair-retest-unavailable")) {
            degradationReasons.push("repair-retest-unavailable");
          }
          coachingDimension = pickFocusDimension(context.ledger.points, context.drillOutcomes, null);
        }
      }
    }

    const coaching: CoachingRecord = {
      dimension: coachingDimension,
      sideReason,
      repairRetest,
      degradationReasons: degradationReasons.length ? degradationReasons : null,
    };

    const aiSide: DebateSide = side === "for" ? "against" : "for";
    let aiMessage: string;
    try {
      aiMessage = await withProviderFallback(
        () =>
          debateOpening({
            topicTitle: topic.title,
            topicPrompt: topic.prompt,
            aiSide,
            directive: openingDirective(persona, difficulty, format),
          }),
        isValidOpening,
        () =>
          anthropicOpening({
            topicTitle: topic.title,
            topicPrompt: topic.prompt,
            aiSide,
            directive: openingDirective(persona, difficulty, format),
          }),
      );
    } catch (error) {
      console.error("Failed to generate opening:", error);
      await releaseStartClaim();
      // Daily spend cap: explicit and retryable — no debate was created.
      if (isSpendCapError(error)) {
        return failure(503, `${error.message} Try again after the daily reset.`, "spend_cap_reached", retryAfterSecondsToReset());
      }
      return failure(502, "Failed to generate AI opening.");
    }

    const { data: completedData, error: completeError } = await db.rpc("complete_solo_debate_start", {
      p_user_id: userId,
      p_topic_id: topicId,
      p_token: startToken,
      p_side: side,
      p_format: format,
      p_persona: persona,
      p_difficulty: difficulty,
      p_coaching: JSON.stringify(coaching),
      p_ai_message: aiMessage,
      p_side_rule: sideRule,
      p_repair_result_id: repairRetest?.repairResultId ?? null,
      p_repair_debate_id: repairRetest?.repairDebateId ?? null,
      p_target_kind: repairRetest?.targetKind ?? null,
    });

    if (completeError) {
      console.error("Failed atomic solo debate start:", completeError);
      await releaseStartClaim();
      return failure(500, "Failed to start debate.");
    }

    const completed = (completedData ?? {}) as {
      ok?: boolean;
      reason?: string;
      debate?: SoloDebate;
      turn?: SoloDebateTurn;
      retestAssigned?: boolean;
    };

    if (!completed.ok || !completed.debate || !completed.turn) {
      await releaseStartClaim();
      const winner = await loadExistingStart();
      if (winner) return { ok: true, data: existingPayload(winner) };
      return failure(
        409,
        "Failed to establish the debate start. Try again.",
        completed.reason ?? "start-commit-failed",
      );
    }

    const persistedCoaching = (completed.debate.coaching ?? {}) as CoachingRecord;
    return {
      ok: true,
      data: {
        debate: completed.debate,
        turn: completed.turn,
        side: completed.debate.side,
        sideReason: persistedCoaching.sideReason ?? null,
        format: completed.debate.format,
        persona:
          completed.debate.persona != null
            ? (completed.debate.persona as OpponentPersonaId)
            : persona,
        difficulty:
          completed.debate.difficulty != null
            ? (completed.debate.difficulty as OpponentDifficulty)
            : difficulty,
        replayed: completed.reason === "existing-debate",
      },
    };
  } catch (error) {
    console.error("Unexpected solo debate start failure:", error);
    await releaseStartClaim();
    return failure(500, "Failed to start debate.");
  }
}
