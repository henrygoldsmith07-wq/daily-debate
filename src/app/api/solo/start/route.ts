import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/backend/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { debateOpening } from "@/lib/openrouter";
import { debateOpening as anthropicOpening } from "@/lib/anthropic";
import { withProviderFallback } from "@/lib/aiFallback";
import { isValidOpening } from "@/lib/aiSchema";
import type {
  CoachingContextDegradationReason,
  CoachingRecord,
  DebateSide,
  SoloDebate,
  SoloDebateTurn,
} from "@/lib/types";
import type { RepairKind } from "@/lib/argumentRepair";
import { resolveDebateFormat, type DebateFormat } from "@/lib/sprint";
import {
  assignChallengeSide,
  normaliseSoloPerformance,
  type ChallengeRule,
  type SideHistoryItem,
} from "@/lib/challengeMe";
import { pickFocusDimension } from "@/lib/coachingGoal";
import { loadCoachingContext } from "@/lib/coachingContextServer";

type ExistingStart = {
  debate: SoloDebate;
  turn: SoloDebateTurn;
};

export async function POST(request: Request) {
  const limited = await checkRateLimit(request, { name: "solo-start", limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const topicId = typeof body?.topicId === "string" ? body.topicId : null;
  const sideChoice = body?.side;
  const format: DebateFormat = resolveDebateFormat(body?.format);
  if (!topicId) {
    return NextResponse.json({ error: "topicId is required." }, { status: 400 });
  }
  if (sideChoice !== "challenge" && sideChoice !== "for" && sideChoice !== "against") {
    return NextResponse.json({ error: "side must be 'for', 'against', or 'challenge'." }, { status: 400 });
  }

  const { data: topic, error: topicError } = await db
    .from("daily_topics")
    .select("*")
    .eq("id", topicId)
    .single();
  if (topicError || !topic) return NextResponse.json({ error: "Topic not found." }, { status: 404 });

  async function loadExistingStart(): Promise<ExistingStart | null> {
    const { data: existingDebate } = await db
      .from("solo_debates")
      .select("*")
      .eq("user_id", user.id)
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

  function existingResponse(existing: ExistingStart) {
    const coaching = (existing.debate.coaching ?? {}) as CoachingRecord;
    return NextResponse.json({
      debate: existing.debate,
      turn: existing.turn,
      side: existing.debate.side,
      sideReason: coaching.sideReason ?? null,
      format: existing.debate.format,
      replayed: true,
    });
  }

  // Lost HTTP responses and ordinary retries return the canonical durable start
  // without another provider call.
  const alreadyStarted = await loadExistingStart();
  if (alreadyStarted) return existingResponse(alreadyStarted);

  // Only the claim owner is allowed to call the opening model. Concurrent tabs
  // therefore cannot create duplicate active debates OR duplicate provider work.
  const startToken = randomUUID();
  const { data: claimData, error: claimError } = await db.rpc("claim_solo_debate_start", {
    p_user_id: user.id,
    p_topic_id: topicId,
    p_token: startToken,
    p_stale_after_seconds: 300,
  });
  if (claimError) {
    console.error("Failed to claim solo debate start:", claimError);
    return NextResponse.json({ error: "Failed to start debate." }, { status: 500 });
  }
  const claim = (claimData ?? {}) as { claimed?: boolean; reason?: string; debateId?: string };
  if (!claim.claimed) {
    const winner = await loadExistingStart();
    if (winner) return existingResponse(winner);
    return NextResponse.json(
      {
        error: "This debate is already starting in another tab. Try again in a moment.",
        code: claim.reason ?? "start-in-progress",
      },
      { status: 409 },
    );
  }

  async function releaseStartClaim() {
    await db.rpc("release_solo_debate_start", {
      p_user_id: user.id,
      p_topic_id: topicId,
      p_token: startToken,
    });
  }

  try {
    // Side resolution happens only for the winning claim. Challenge Me uses
    // compact performance directly and falls back to turn counts only for
    // legacy rows that predate migration 031.
    let side: DebateSide;
    let sideReason: string | null = null;
    let sideRule: ChallengeRule | null = null;
    if (sideChoice === "challenge") {
      const { data: historyRows } = await db
        .from("solo_debates")
        .select("id, side, total_score, performance_score")
        .eq("user_id", user.id)
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(8);

      const legacyIds = (historyRows ?? [])
        .filter((row) => typeof row.performance_score !== "number")
        .map((row) => row.id);
      const answeredByDebate = new Map<string, number>();
      if (legacyIds.length) {
        const { data: answeredTurns } = await db
          .from("solo_debate_turns")
          .select("debate_id, id")
          .in("debate_id", legacyIds)
          .not("user_message", "is", null);
        for (const row of answeredTurns ?? []) {
          answeredByDebate.set(row.debate_id, (answeredByDebate.get(row.debate_id) ?? 0) + 1);
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
      const assignment = assignChallengeSide(history);
      side = assignment.side;
      sideReason = assignment.reason;
      sideRule = assignment.rule;
    } else {
      side = sideChoice;
    }

    // Resolve the coaching/retest plan before the external provider call. No
    // durable debate state exists yet, so any failure remains safely retryable.
    let coachingDimension: string | null = null;
    const degradationReasons: CoachingContextDegradationReason[] = [];
    let repairRetest:
      | { repairResultId: string; repairDebateId: string; targetKind: RepairKind; attemptedAt: string }
      | null = null;
    const context = await loadCoachingContext(user.id, { currentTopicId: topicId });
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
        () => debateOpening({ topicTitle: topic.title, topicPrompt: topic.prompt, aiSide }),
        isValidOpening,
        () => anthropicOpening({ topicTitle: topic.title, topicPrompt: topic.prompt, aiSide }),
      );
    } catch (error) {
      console.error("Failed to generate opening:", error);
      await releaseStartClaim();
      return NextResponse.json({ error: "Failed to generate AI opening." }, { status: 502 });
    }

    // Debate + opening turn + optional repair retest + start analytics commit in
    // one database transaction. No partial durable start state is observable.
    const { data: completedData, error: completeError } = await db.rpc("complete_solo_debate_start", {
      p_user_id: user.id,
      p_topic_id: topicId,
      p_token: startToken,
      p_side: side,
      p_format: format,
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
      return NextResponse.json({ error: "Failed to start debate." }, { status: 500 });
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
      if (winner) return existingResponse(winner);
      return NextResponse.json(
        { error: "Failed to establish the debate start. Try again.", code: completed.reason ?? "start-commit-failed" },
        { status: 409 },
      );
    }

    const persistedCoaching = (completed.debate.coaching ?? {}) as CoachingRecord;
    return NextResponse.json({
      debate: completed.debate,
      turn: completed.turn,
      side: completed.debate.side,
      sideReason: persistedCoaching.sideReason ?? null,
      format: completed.debate.format,
      replayed: completed.reason === "existing-debate",
    });
  } catch (error) {
    console.error("Unexpected solo debate start failure:", error);
    await releaseStartClaim();
    return NextResponse.json({ error: "Failed to start debate." }, { status: 500 });
  }
}
