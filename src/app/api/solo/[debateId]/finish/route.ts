import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/backend/server";
import { checkRateLimit, checkRateLimitKey } from "@/lib/rateLimit";
import { summarizeSoloDebate } from "@/lib/openrouter";
import { summarizeSoloDebate as anthropicSummarize } from "@/lib/anthropic";
import { withProviderFallback } from "@/lib/aiFallback";
import { isValidSummary } from "@/lib/aiSchema";
import { performanceScoreForTurns, POINTS_PER_LEVEL } from "@/lib/gamification";
import { computeCoachRewards, totalBonusXP } from "@/lib/coachRewards";
import { buildEvaluationResult } from "@/lib/evaluationEnvelope";
import { assessArgumentGraph, mergeAssessmentGraphs } from "@/lib/observableAssessment";
import type { ObservableAssessment } from "@/lib/observableAssessment";
import { minRoundsFor, measurementHonestyFor } from "@/lib/sprint";
import { buildResultSnapshot } from "@/lib/resultSnapshot";
import { snapshotFromAssessment } from "@/lib/coachingGoal";
import { countWeaknessesForSide } from "@/lib/repairEffectiveness";
import { recordProductEventForUser } from "@/lib/productEvents";
import { MAX_ROUNDS, type CoachingRecord, type PersistedSoloResult } from "@/lib/types";
import { mergeSoloAssessmentsByDebate } from "@/lib/soloAssessmentHistory";
import { extractSkillPoint } from "@/lib/skillLedger";
import { pointMeasuresDimension, repairKindToDimension } from "@/lib/repairRetest";
import { buildTrainingSummary } from "@/lib/trainingSummary";
import { normalizeIanaTimeZone } from "@/lib/timeZone";

export async function POST(request: Request, { params }: { params: Promise<{ debateId: string }> }) {
  const ipLimited = await checkRateLimit(request, { name: "solo-finish-ip", limit: 60, windowMs: 60_000 });
  if (ipLimited) return ipLimited;

  const { debateId } = await params;
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = user.id;

  const userLimit = await checkRateLimitKey(user.id, { name: "solo-finish-user", limit: 10, windowMs: 60_000 });
  if (!userLimit.ok) {
    return NextResponse.json(
      { error: "Too many finish attempts. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(userLimit.retryAfterSeconds), "Cache-Control": "no-store" } },
    );
  }

  const body = await request.json().catch(() => null);
  const finishSavedResponse = body?.finishSavedResponse === true;
  const expectedTurnId = typeof body?.expectedTurnId === "string" ? body.expectedTurnId : "";

  const [{ data: debate, error: debateError }, { data: profile }] = await Promise.all([
    db
      .from("solo_debates")
      .select("*")
      .eq("id", debateId)
      .eq("user_id", user.id)
      .single(),
    db.from("profiles").select("timezone").eq("id", user.id).single(),
  ]);
  const timeZone = normalizeIanaTimeZone(profile?.timezone);
  if (debateError || !debate) return NextResponse.json({ error: "Debate not found." }, { status: 404 });

  if (debate.status === "completed") {
    if (debate.result_payload && typeof debate.result_payload === "object") {
      return NextResponse.json(debate.result_payload);
    }
    return NextResponse.json({ error: "Debate already completed." }, { status: 409 });
  }

  const format = debate.format === "sprint" ? "sprint" : "full";
  const minRounds = minRoundsFor(format);

  // Provider failure after an accepted response must not trap a sufficiently
  // complete debate. Commit that exact staged response as the final answered
  // round without creating another opponent turn, then run normal finalization.
  if (finishSavedResponse) {
    if (!expectedTurnId) {
      return NextResponse.json({ error: "expectedTurnId is required to finish a saved response." }, { status: 400 });
    }
    const { data: stagedData, error: stagedError } = await db.rpc("commit_staged_solo_turn_for_finish", {
      p_debate_id: debateId,
      p_user_id: user.id,
      p_turn_id: expectedTurnId,
      p_min_rounds: minRounds,
      p_stale_after_seconds: 300,
    });
    if (stagedError) {
      console.error("Failed to commit staged response for finish:", stagedError);
      return NextResponse.json({ error: "Your saved response is still available, but it could not be committed yet." }, { status: 500 });
    }
    const stagedResult = (stagedData ?? {}) as {
      saved?: boolean;
      reason?: string;
      completedTurn?: { round_number?: number } | null;
    };
    if (!stagedResult.saved) {
      const message =
        stagedResult.reason === "submission-in-progress"
          ? "Opponent generation is still active for this saved response. Try again shortly."
          : stagedResult.reason === "debate-finalizing"
            ? "This debate is already being finalized in another tab."
            : stagedResult.reason === "minimum-rounds-not-met"
              ? `Complete at least ${minRounds} rounds before finishing.`
              : "The saved response could not be used to finish this debate. Refresh and try again.";
      return NextResponse.json({ error: message, code: stagedResult.reason ?? "saved_response_unavailable" }, { status: 409 });
    }
    if (typeof stagedResult.completedTurn?.round_number === "number") {
      await recordProductEventForUser(user.id, "round_completed", {
        format,
        side: debate.side as "for" | "against",
        round: stagedResult.completedTurn.round_number,
        debateId,
      });
    }
  }

  // Claim the finalization barrier before loading the transcript. A turn that
  // is already committing finishes first because both paths lock the debate;
  // new turn work is rejected once this token exists. This prevents a result
  // snapshot from omitting a response accepted concurrently in another tab.
  const finalizationToken = randomUUID();
  const { data: claimed, error: claimError } = await db.rpc("claim_solo_debate_finalization", {
    p_debate_id: debateId,
    p_user_id: user.id,
    p_token: finalizationToken,
    p_stale_after_seconds: 300,
  });
  if (claimError) {
    console.error("Failed to claim debate finalization:", claimError);
    return NextResponse.json({ error: "Failed to finish debate." }, { status: 500 });
  }
  if (!claimed) {
    const { data: stagedTurn } = await db
      .from("solo_debate_turns")
      .select("id")
      .eq("debate_id", debateId)
      .is("user_message", null)
      .not("staged_user_message", "is", null)
      .limit(1)
      .maybeSingle();
    if (stagedTurn) {
      return NextResponse.json(
        { error: "A saved response still needs to finish advancing before this debate can be completed.", code: "submission_pending" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "This debate is already being finalized. Try again shortly." }, { status: 409 });
  }

  async function releaseFinalizationClaim() {
    await db.rpc("release_solo_debate_finalization", {
      p_debate_id: debateId,
      p_user_id: userId,
      p_token: finalizationToken,
    });
  }

  const { data: turns, error: turnsError } = await db
    .from("solo_debate_turns")
    .select("*")
    .eq("debate_id", debateId)
    .order("round_number", { ascending: true });
  if (turnsError || !turns) {
    await releaseFinalizationClaim();
    return NextResponse.json({ error: "Failed to load turns." }, { status: 500 });
  }

  const answered = turns.filter((turn) => turn.user_message);
  if (answered.length < minRounds) {
    await releaseFinalizationClaim();
    return NextResponse.json(
      { error: `Complete at least ${minRounds} rounds before finishing.` },
      { status: 400 },
    );
  }

  const totalScore = answered.reduce((sum, turn) => sum + (turn.turn_score ?? 0), 0);
  const performanceScore = performanceScoreForTurns(answered.map((turn) => turn.turn_score));

  async function refreshFinalizationLease() {
    const { data, error } = await db.rpc("refresh_solo_debate_finalization", {
      p_debate_id: debateId,
      p_user_id: userId,
      p_token: finalizationToken,
    });
    return !error && data === true;
  }

  const { data: topic } = await db.from("daily_topics").select("title").eq("id", debate.topic_id).single();

  const transcript = answered
    .map((turn) => `AI: ${turn.ai_message}\nUser: ${turn.user_message}`)
    .join("\n\n");

  let summary;
  let summarySource: "ai" | "fallback" = "ai";
  try {
    summary = await withProviderFallback(
      () => summarizeSoloDebate({ topicTitle: topic?.title ?? "the debate", transcript }),
      isValidSummary,
      () => anthropicSummarize({ topicTitle: topic?.title ?? "the debate", transcript }),
    );
  } catch (error) {
    console.error("Failed to summarize debate:", error);
    summarySource = "fallback";
    summary = {
      overallFeedback: "Detailed generated feedback was unavailable. Your deterministic assessment and coaching result are still shown below.",
      strengths: [],
      improvements: [],
    };
  }

  if (!(await refreshFinalizationLease())) {
    return NextResponse.json({ error: "Debate finalization was restarted elsewhere. Retry to load the saved result." }, { status: 409 });
  }

  const turnAssessments = answered
    .map((turn) => turn.assessment as ObservableAssessment | null | undefined)
    .filter((assessment): assessment is ObservableAssessment => !!assessment);
  const finalAssessment = turnAssessments.length
    ? assessArgumentGraph(
        mergeAssessmentGraphs(turnAssessments.map((assessment) => assessment.graph)),
        { sideA: "a", sideB: "ai", extractionSource: "deterministic", labelA: "You", labelB: "AI opponent" },
      )
    : null;
  if (finalAssessment) summary = { ...summary, argGraph: finalAssessment.graph, assessment: finalAssessment };

  // Prior completed debates: feeds BOTH coach rewards (per-debate assessments)
  // and repeated-weakness detection (side-scoped weakness counts). One query.
  const { data: priorDebates } = await db
    .from("solo_debates")
    .select("id, completed_at")
    .eq("user_id", user.id)
    .eq("status", "completed")
    .neq("id", debateId)
    .order("completed_at", { ascending: false })
    .limit(5);
  let priorAssessments: ObservableAssessment[] = [];
  let priorDebateKinds: Array<{ completedAt: string; kinds: Record<string, number> }> = [];
  if (priorDebates?.length) {
    const { data: priorTurns } = await db
      .from("solo_debate_turns")
      .select("debate_id, assessment")
      .in("debate_id", priorDebates.map((d) => d.id))
      .not("assessment", "is", null)
      .order("round_number", { ascending: true })
      // Five full debates can contain up to 5 × MAX_ROUNDS assessed turns.
      // The old hard limit of 30 silently truncated longer histories.
      .limit(priorDebates.length * MAX_ROUNDS);

    const mergedByDebate = mergeSoloAssessmentsByDebate(
      (priorTurns ?? []) as Array<{ debate_id: string; assessment: unknown }>,
    );
    // Rewards now compare full prior debates with the full current debate.
    // Previously this array kept only the final turn assessment per debate.
    priorAssessments = priorDebates
      .map((d) => mergedByDebate.get(d.id) ?? null)
      .filter((assessment): assessment is ObservableAssessment => assessment !== null);

    priorDebateKinds = priorDebates
      .map((d) => {
        const merged = mergedByDebate.get(d.id);
        if (!merged) return null;
        return {
          completedAt: d.completed_at ?? new Date().toISOString(),
          kinds: countWeaknessesForSide(merged.graph, "a"),
        };
      })
      .filter((x): x is { completedAt: string; kinds: Record<string, number> } => x !== null)
      .reverse(); // chronological: oldest → newest
  }
  const { data: topicCategory } = await db
    .from("daily_topics").select("category").eq("id", debate.topic_id).single();
  const { data: pastDebates } = await db
    .from("solo_debates")
    .select("topic_id")
    .eq("user_id", user.id).eq("status", "completed").neq("id", debateId);
  const priorTopicIds = [...new Set((pastDebates ?? []).map((row) => row.topic_id))];
  const { data: pastTopics } = priorTopicIds.length
    ? await db.from("daily_topics").select("category").in("id", priorTopicIds)
    : { data: [] };
  const previouslyDebatedCategories = (pastTopics ?? []).map((topic) => topic.category ?? "").filter(Boolean);
  const currentCategory = topicCategory?.category ?? "";
  const rewardEvents = finalAssessment
    ? computeCoachRewards({ assessment: finalAssessment, priorAssessments, previouslyDebatedCategories, currentCategory })
    : [];
  const bonusXP = totalBonusXP(rewardEvents);

  // ── Coaching loop: assess today's goal and persist the snapshot ─────────
  const coaching = (debate.coaching ?? {}) as CoachingRecord;
  const goalDimension = (coaching.dimension ?? null) as import("@/lib/adaptiveCoach").CoachDimension | null;

  // The result story must receive the goal dimension. Without it the
  // user-facing "Today's focus outcome" panel is empty even though the debate
  // was started with a coaching goal.
  const snapshot = buildResultSnapshot(finalAssessment, {
    format,
    summary,
    priorDebates: priorDebateKinds,
    goalDimension,
  });
  let coachingUpdate: CoachingRecord = { ...coaching, snapshot: null, demonstrated: null };
  if (goalDimension && finalAssessment?.features?.a) {
    // One source of truth: buildResultSnapshot delegates to
    // coachingGoal.assessGoalOutcome, and the persisted result reuses it.
    const behaviourSnapshot = snapshotFromAssessment(finalAssessment);
    coachingUpdate = {
      ...coaching,
      snapshot: behaviourSnapshot,
      demonstrated: snapshot.goalOutcome.demonstrated,
      weaknessKind: snapshot.weakness?.kind ?? null,
      recurrenceCount: snapshot.recurrence?.count ?? 0,
    };
  }

  const trainingSummary = buildTrainingSummary(answered);
  const evaluation = buildEvaluationResult({
    scoreStatus: finalAssessment?.status ?? "insufficient_evidence",
    summary,
    observableAssessment: finalAssessment ?? undefined,
  });
  const completedAt = new Date().toISOString();
  let retestCompletion: {
    repairResultId: string | null;
    observable: boolean;
    demonstrated: boolean | null;
  } | null = null;
  if (coaching.repairRetest) {
    const retestDimension = repairKindToDimension(coaching.repairRetest.targetKind);
    const clarityValues = answered
      .map((turn) => {
        const scores = turn.scores as { clarity?: unknown } | null;
        return typeof scores?.clarity === "number" ? scores.clarity : null;
      })
      .filter((value): value is number => value !== null);
    const avgClarity = clarityValues.length
      ? clarityValues.reduce((sum, value) => sum + value, 0) / clarityValues.length
      : null;
    const retestPoint = retestDimension && finalAssessment
      ? extractSkillPoint(debateId, completedAt, finalAssessment, "a", avgClarity)
      : null;
    const observable = !!(
      retestDimension &&
      retestPoint &&
      pointMeasuresDimension(retestPoint, retestDimension)
    );
    retestCompletion = {
      repairResultId: coaching.repairRetest.repairResultId ?? null,
      observable,
      demonstrated: observable ? snapshot.goalOutcome.demonstrated === true : null,
    };
  }
  const resultPayload: PersistedSoloResult = {
    totalScore,
    performanceScore,
    bonusXP,
    rewardEvents,
    summary,
    summarySource,
    assessment: finalAssessment ?? undefined,
    evaluation,
    format,
    honesty: measurementHonestyFor(format),
    snapshot,
    coaching: coachingUpdate,
    trainingSummary,
  };

  if (!(await refreshFinalizationLease())) {
    return NextResponse.json({ error: "Debate finalization was restarted elsewhere. Retry to load the saved result." }, { status: 409 });
  }

  const { data: finalized, error: finalizeError } = await db.rpc("finalize_solo_debate_v2", {
    p_debate_id: debateId,
    p_user_id: user.id,
    p_token: finalizationToken,
    p_total_score: totalScore,
    p_bonus_xp: bonusXP,
    p_points_per_level: POINTS_PER_LEVEL,
    p_completed_at: completedAt,
    p_timezone: timeZone,
    p_coaching: JSON.stringify(coachingUpdate),
    p_result_payload: JSON.stringify(resultPayload),
    p_has_retest: retestCompletion !== null,
    p_repair_result_id: retestCompletion?.repairResultId ?? null,
    p_retest_observable: retestCompletion?.observable ?? false,
    p_retest_demonstrated: retestCompletion?.demonstrated ?? null,
  });
  if (finalizeError || !finalized) {
    console.error("Failed durable debate finalization:", finalizeError);
    await db.rpc("release_solo_debate_finalization", {
      p_debate_id: debateId,
      p_user_id: user.id,
      p_token: finalizationToken,
    });
    return NextResponse.json({ error: "Failed to finish debate. Your debate is still available to retry." }, { status: 500 });
  }

  const eventSide = debate.side as "for" | "against";
  await recordProductEventForUser(user.id, "debate_completed", { format, side: eventSide, debateId });

  if (coaching.repairRetest && retestCompletion) {
    if (retestCompletion.observable) {
      await recordProductEventForUser(user.id, "retest_completed", {
        format,
        side: eventSide,
        reason: coaching.repairRetest.targetKind,
        debateId,
      });
      if (retestCompletion.demonstrated === true) {
        await recordProductEventForUser(user.id, "retest_skill_demonstrated", {
          format,
          side: eventSide,
          reason: coaching.repairRetest.targetKind,
          debateId,
        });
      }
    }
  }

  return NextResponse.json(resultPayload);
}
