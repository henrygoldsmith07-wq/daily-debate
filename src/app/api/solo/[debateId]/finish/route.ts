import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/backend/server";
import { checkRateLimit, checkRateLimitKey } from "@/lib/rateLimit";
import { summarizeSoloDebate } from "@/lib/openrouter";
import { performanceScoreForTurns, POINTS_PER_LEVEL } from "@/lib/gamification";
import { computeCoachRewards, totalBonusXP } from "@/lib/coachRewards";
import { buildEvaluationResult } from "@/lib/evaluationEnvelope";
import { assessArgumentGraph, mergeAssessmentGraphs } from "@/lib/observableAssessment";
import type { ObservableAssessment } from "@/lib/observableAssessment";
import { minRoundsFor, measurementHonestyFor, resolveDebateFormat } from "@/lib/sprint";
import { buildResultSnapshot } from "@/lib/resultSnapshot";
import { snapshotFromAssessment } from "@/lib/coachingGoal";
import { type CoachingRecord, type PersistedSoloResult } from "@/lib/types";
import { loadSoloFinalizationContext } from "@/lib/solo/finalizationContext";
import { repairKindToDimension } from "@/lib/repairRetest";
import { retestAssignmentFor, retestOutcomeFor, RETEST_OUTCOME_DETAIL, RETEST_OUTCOME_LABELS, retestComparisonFor, type RetestOutcome } from "@/lib/retest";
import { reusedRepairPhrases } from "@/lib/repairPhraseReuse";
import { retestTurnEvidence } from "@/lib/retestEvidence";
import { secondOpinionFor } from "@/lib/repairSecondOpinion";
import { retestAssignmentStillOpen } from "@/lib/repairRetestServer";
import { countWeaknessesForSide, debateOpportunities } from "@/lib/repairEffectiveness";
import { isRepairKind, type RepairKind } from "@/lib/argumentRepair";
import { REPAIR_KIND_LABELS } from "@/lib/repairResume";
import { buildTrainingSummary } from "@/lib/trainingSummary";

type RouteContext = { params: Promise<{ debateId: string }> };

/**
 * Any exception after the finalization claim is taken (a throwing context load,
 * snapshot builder, or RPC) used to leave the claim held for the five-minute
 * stale window, so the learner's immediate retry hit "already being finalized".
 * Release our exact token and answer a retryable 500 instead.
 */
export async function POST(request: Request, context: RouteContext) {
  const claim: { release: (() => Promise<void>) | null } = { release: null };
  try {
    return await finishSoloDebate(request, context, claim);
  } catch (error) {
    console.error("Unexpected failure while finishing debate:", error);
    try {
      await claim.release?.();
    } catch (releaseError) {
      console.error("Failed to release finalization claim after error:", releaseError);
    }
    return NextResponse.json(
      { error: "Failed to finish debate. Your debate is still available to retry." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

async function finishSoloDebate(
  request: Request,
  { params }: RouteContext,
  claim: { release: (() => Promise<void>) | null },
) {
  const ipLimited = await checkRateLimit(request, { name: "solo-finish-ip", limit: 60, windowMs: 60_000, failClosed: true });
  if (ipLimited) return ipLimited;

  const { debateId } = await params;
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = user.id;

  const userLimit = await checkRateLimitKey(user.id, { name: "solo-finish-user", limit: 10, windowMs: 60_000, failClosed: true });
  if (!userLimit.ok) {
    return NextResponse.json(
      { error: "Too many finish attempts. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(userLimit.retryAfterSeconds), "Cache-Control": "no-store" } },
    );
  }

  const body = await request.json().catch(() => null);
  const finishSavedResponse = body?.finishSavedResponse === true;
  const expectedTurnId = typeof body?.expectedTurnId === "string" ? body.expectedTurnId : "";

  const { data: debate, error: debateError } = await db
    .from("solo_debates")
    .select("*")
    .eq("id", debateId)
    .eq("user_id", user.id)
    .single();
  if (debateError || !debate) return NextResponse.json({ error: "Debate not found." }, { status: 404 });

  if (debate.status === "completed") {
    if (debate.result_payload && typeof debate.result_payload === "object") {
      return NextResponse.json(debate.result_payload);
    }
    return NextResponse.json({ error: "Debate already completed." }, { status: 409 });
  }

  const format = resolveDebateFormat(debate.format);
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
    }  }

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
  claim.release = releaseFinalizationClaim;

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

  async function refreshFinalizationLease(): Promise<"refreshed" | "lost" | "error"> {
    const { data, error } = await db.rpc("refresh_solo_debate_finalization", {
      p_debate_id: debateId,
      p_user_id: userId,
      p_token: finalizationToken,
    });
    if (error) {
      // A transient DB/network error does not prove ownership was lost. Release
      // only our exact token so the user can retry immediately instead of
      // waiting for the five-minute stale-lease timeout.
      await releaseFinalizationClaim();
      return "error";
    }
    return data === true ? "refreshed" : "lost";
  }

  async function requireFreshFinalizationLease() {
    const state = await refreshFinalizationLease();
    if (state === "refreshed") return null;
    if (state === "error") {
      return NextResponse.json(
        { error: "Finalization could not refresh its database lease. Your debate is safe to retry." },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: "Debate finalization was restarted elsewhere. Retry to load the saved result." },
      { status: 409 },
    );
  }

  const finalizationContext = await loadSoloFinalizationContext({
    db,
    userId,
    debateId,
    topicId: debate.topic_id,
  });
  if (!finalizationContext.ok) {
    console.error(
      `Finalization context unavailable at ${finalizationContext.stage}:`,
      finalizationContext.message,
    );
    await releaseFinalizationClaim();
    return NextResponse.json(
      {
        error: "Finalization context is temporarily unavailable. Your debate is safe to retry.",
        code: "finalization_context_unavailable",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const { topic, priorAssessments, priorDebateKinds } = finalizationContext;

  const transcript = answered
    .map((turn) => `AI: ${turn.ai_message}\nUser: ${turn.user_message}`)
    .join("\n\n");

  let summary;
  let summarySource: "ai" | "fallback" = "ai";
  try {
    summary = await summarizeSoloDebate({ topicTitle: topic.title, transcript });
  } catch (error) {
    console.error("Failed to summarize debate:", error);
    summarySource = "fallback";
    summary = {
      overallFeedback: "Detailed generated feedback was unavailable. Your deterministic assessment and coaching result are still shown below.",
      strengths: [],
      improvements: [],
    };
  }

  {
    const leaseError = await requireFreshFinalizationLease();
    if (leaseError) return leaseError;
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

  const currentCategory = topic.category ?? "";
  const rewardEvents = finalAssessment
    ? computeCoachRewards({
        assessment: finalAssessment,
        priorAssessments,
        previouslyDebatedCategories: [],
        currentCategory,
        // Novelty is resolved atomically by finalize_solo_debate_v4 so a
        // history scan or concurrent Finish cannot double-award this bonus.
        includeUnfamiliarTopic: false,
      })
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
    goalSource: coaching.focusSource ?? null,
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
    /** The canonical four-valued verdict, kept for the result card. */
    outcome: RetestOutcome | null;
  } | null = null;
  const retestTargetKind = coaching.repairRetest?.targetKind ?? null;
  if (coaching.repairRetest) {
    const targetKind = retestTargetKind as string;
    const retestDimension = repairKindToDimension(targetKind);

    // THE VERDICT IS BEHAVIOURAL, NOT GOAL-COMPLIANCE.
    //
    // It used to be `snapshot.goalOutcome.demonstrated` — "did this debate
    // comply with the goal line we had just displayed?" That was wrong twice
    // over: it measured compliance with a prompt (so it could not answer the
    // question the product actually asks — does the repair transfer?), and
    // `assessGoalOutcome` only judges three of the six repair kinds, so for
    // logic, impact, clarity and steelmanning the retest could NEVER be
    // demonstrated and every one of them recorded "not enough evidence".
    //
    // The canonical detector is used instead: `retestOutcomeFor` reads the
    // same weakness counters and the same opportunity test every other layer
    // uses (repairEffectiveness / opportunity.ts), so there is one definition
    // of "the weakness was still there" and one definition of "the debate
    // gave a real chance to show the skill". The old local test — whether the
    // skill point carried a non-null value for the dimension — is dropped: it
    // was a second definition of the same question, and it could only ever
    // withhold a verdict, never produce one.
    //
    // The four outcomes map onto the existing repair_retests columns without
    // a migration: `skillJourneyServer.outcomeFromAssignment` decodes
    // (observable, demonstrated) back into exactly these four states.
    const graph = finalAssessment?.graph ?? null;
    const outcome: RetestOutcome | null =
      graph && retestDimension && isRepairKind(targetKind)
        ? retestOutcomeFor(
            { target_kind: targetKind },
            {
              debateId,
              userId: user.id,
              completedAt,
              kinds: countWeaknessesForSide(graph, "a"),
              opps: debateOpportunities(graph, "a"),
            },
            graph,
            "a",
            // Only the sprint sample is too small to judge the skill; every
            // other format keeps the behaviour it had before this change.
            { format: format === "sprint" ? "sprint" : "full" },
          )
        : null;

    const assignment = retestAssignmentFor(outcome, {
      // A sprint is too short to judge the skill, so it records no verdict and
      // the repair stays pending — the test waits for a full debate.
      format: format === "sprint" ? "sprint" : "full",
    });

    // Does THIS debate still own the open assignment? The roll-forward in
    // complete_solo_debate_start closes a repair's previous assignment when a
    // newer debate takes over the repair, and the guarded finalizer then
    // refuses to write this debate's verdict to the closed row. When that has
    // happened, the result card must not reveal a verdict either: the
    // measurement belongs to the newer debate now, and showing one here would
    // be a claim the durable state does not back.
    let assignmentStillOpen = true;
    try {
      assignmentStillOpen = await retestAssignmentStillOpen({
        userId: user.id,
        assignedDebateId: debateId,
        repairResultId: coaching.repairRetest.repairResultId ?? null,
      });
    } catch (error) {
      // Fail CLOSED on the reveal, not on the debate: a state read failure must
      // not destroy a completed debate, but it must not show an unverified
      // verdict either.
      console.error("Retest assignment state unavailable during finalization:", error);
      assignmentStillOpen = false;
    }

    retestCompletion = {
      repairResultId: coaching.repairRetest.repairResultId ?? null,
      observable: assignment.observable,
      // A sprint retest observes the skill but cannot judge it — the sample is
      // too small — so it records no demonstrated verdict rather than a
      // pass/fail the evidence cannot support. "no-valid-opportunity" and a
      // missing assessment both record no verdict at all.
      demonstrated: assignment.demonstrated,
      outcome: assignmentStillOpen ? outcome : null,
    };
  }
  // M9 spaced re-check: same canonical detector and the same sprint rule as
  // the first retest (a sprint records no verdict, so the re-check stays open
  // for a later full debate). The verdict lives on coaching.recheck, which is
  // also how the re-check is linked to this debate — no migration.
  if (coaching.recheck && !coaching.repairRetest) {
    const recheckKind = coaching.recheck.targetKind as string;
    const graph = finalAssessment?.graph ?? null;
    const recheckOutcome: RetestOutcome | null =
      graph && isRepairKind(recheckKind) && repairKindToDimension(recheckKind)
        ? retestOutcomeFor(
            { target_kind: recheckKind },
            {
              debateId,
              userId: user.id,
              completedAt,
              kinds: countWeaknessesForSide(graph, "a"),
              opps: debateOpportunities(graph, "a"),
            },
            graph,
            "a",
            { format: format === "sprint" ? "sprint" : "full" },
          )
        : null;
    coachingUpdate = {
      ...coachingUpdate,
      recheck: { ...coaching.recheck, outcome: format === "sprint" ? null : recheckOutcome },
    };
  }
  // The retest verdict travels with the coaching record so the result card
  // can REVEAL it — the skill under test is named for the first time after the
  // debate it was measured in (retestDisclosure.ts).
  if (retestCompletion?.outcome) {
    coachingUpdate = {
      ...coachingUpdate,
      retestOutcome: {
        outcome: retestCompletion.outcome,
        label: RETEST_OUTCOME_LABELS[retestCompletion.outcome],
        detail: RETEST_OUTCOME_DETAIL[retestCompletion.outcome],
        skillLabel: REPAIR_KIND_LABELS[retestTargetKind as RepairKind] ?? "your repair",
      },
    };
  }
  if (retestCompletion?.outcome && retestCompletion.repairResultId && coachingUpdate?.retestOutcome) {
    // Best-effort: the verdict stands without the quote, so a lookup failure
    // must never block finishing the debate.
    try {
      const { data: repairRow } = await db
        .from("repair_results")
        .select("source_text, rewrite_text")
        .eq("id", retestCompletion.repairResultId)
        .eq("user_id", user.id)
        .maybeSingle();
      coachingUpdate = {
        ...coachingUpdate,
        retestOutcome: {
          ...coachingUpdate.retestOutcome,
          secondOpinion: (() => {
            const base = retestComparisonFor(repairRow);
            if (!base) return null;
            const so = secondOpinionFor({
              outcome: String(coachingUpdate.retestOutcome?.outcome ?? ""),
              before: base.before,
              after: base.after,
              retestTurns: answered.map((turn) => String(turn.user_message)),
              skillLabel: String(coachingUpdate.retestOutcome?.skillLabel ?? "this skill"),
            });
            return so ? { label: so.label, suggestion: so.suggestion, repairReused: so.repairReused, restatesOriginal: so.restatesOriginal } : null;
          })(),
          comparison: (() => {
            const base = retestComparisonFor(repairRow);
            if (!base) return base;
            // Descriptive lexical overlap only (M14); shown as unvalidated.
            const reused = reusedRepairPhrases(
              repairRow?.rewrite_text ?? "",
              answered.map((turn) => String(turn.user_message)),
            );
            const evidence = retestTurnEvidence(base.before, answered.map((turn) => String(turn.user_message)));
            return {
              ...base,
              ...(reused.length ? { reusedPhrases: reused } : {}),
              ...(evidence ? { evidence } : {}),
            };
          })(),
        },
      };
    } catch (err) {
      console.error("Retest comparison lookup failed:", err);
    }
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

  {
    const leaseError = await requireFreshFinalizationLease();
    if (leaseError) return leaseError;
  }

  const { data: finalized, error: finalizeError } = await db.rpc("finalize_solo_debate_v4", {
    p_debate_id: debateId,
    p_user_id: user.id,
    p_token: finalizationToken,
    p_total_score: totalScore,
    p_bonus_xp: bonusXP,
    p_points_per_level: POINTS_PER_LEVEL,
    p_completed_at: completedAt,
    p_coaching: JSON.stringify(coachingUpdate),
    p_result_payload: JSON.stringify(resultPayload),
    p_has_retest: retestCompletion !== null,
    p_repair_result_id: retestCompletion?.repairResultId ?? null,
    p_retest_observable: retestCompletion?.observable ?? false,
    p_retest_demonstrated: retestCompletion?.demonstrated ?? null,
    p_current_category: currentCategory,
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

  // v4 may atomically add the unfamiliar-topic reward. Return the persisted
  // payload rather than the pre-transaction draft so the first response and
  // every replay expose exactly the same XP/reward state.
  const { data: durableDebate, error: durableResultError } = await db
    .from("solo_debates")
    .select("result_payload")
    .eq("id", debateId)
    .eq("user_id", user.id)
    .single();
  if (durableResultError || !durableDebate?.result_payload || typeof durableDebate.result_payload !== "object") {
    console.error("Debate finalized but durable result reload failed:", durableResultError);
    return NextResponse.json(
      { error: "Debate finished, but the result could not be reloaded. Refresh to view it." },
      { status: 503 },
    );
  }

  return NextResponse.json(durableDebate.result_payload as PersistedSoloResult);
}
