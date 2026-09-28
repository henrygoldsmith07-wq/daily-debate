import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/backend/server";
import { checkRateLimit, checkRateLimitKey } from "@/lib/rateLimit";
import { debateTurn } from "@/lib/openrouter";
import { debateTurn as anthropicTurn } from "@/lib/anthropic";
import { withProviderFallback } from "@/lib/aiFallback";
import { isValidDebateTurn } from "@/lib/aiSchema";
import { assessTurn } from "@/lib/observableAssessment";
import { isSuspiciousLength, moderateContent, repeatScore } from "@/lib/moderation";
import {
  type InputMode,
  type SoloDebateTurn,
  type TurnScores,
  type TurnTrainingMeta,
} from "@/lib/types";
import { roundCapFor } from "@/lib/sprint";
import { checkModeConstraints, isDebateModeId, resolveMode, type DebateModeId } from "@/lib/debateModes";
import { analyseSpeechTurn, parseTurnTiming, scoreSpeechQuality } from "@/lib/speechAnalysis";
import {
  classifyArgumentBatchDetailed,
  recordRoutingTelemetry,
  routeClassifiedArguments,
  routingSummary,
} from "@/lib/argumentRouting";
import type { ArgumentRoute } from "@/lib/argumentTaxonomy";

interface StagedSubmission {
  userMessage: string;
  inputMode: InputMode;
  scores: TurnScores;
  turnScore: number;
  assessment: unknown;
  trainingMeta: TurnTrainingMeta;
  modeId: DebateModeId;
  submittedAt: string | null;
}

interface ClaimSubmissionResult {
  claimed?: boolean;
  reason?: string;
  resumed?: boolean;
  elapsedSeconds?: number | null;
  staged?: Partial<StagedSubmission>;
}

interface FinalizeSubmissionResult {
  saved?: boolean;
  reason?: string;
  completedTurn?: SoloDebateTurn | null;
  nextTurn?: SoloDebateTurn | null;
}

function stagedResponsePayload(staged: Partial<StagedSubmission> | undefined) {
  return {
    submissionSaved: true,
    stagedMessage: typeof staged?.userMessage === "string" ? staged.userMessage : undefined,
    stagedMode: isDebateModeId(staged?.modeId) ? staged.modeId : undefined,
    trainingMeta: staged?.trainingMeta && typeof staged.trainingMeta === "object"
      ? staged.trainingMeta
      : undefined,
  };
}

export async function POST(request: Request, { params }: { params: Promise<{ debateId: string }> }) {
  // Secondary network-abuse ceiling. Authenticated users get their own tighter
  // bucket below so people sharing school/home/work NATs do not throttle each other.
  const ipLimited = await checkRateLimit(request, { name: "solo-turn-ip", limit: 120, windowMs: 60_000 });
  if (ipLimited) return ipLimited;

  const { debateId } = await params;
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userLimit = await checkRateLimitKey(user.id, { name: "solo-turn-user", limit: 30, windowMs: 60_000 });
  if (!userLimit.ok) {
    return NextResponse.json(
      { error: "Too many turn submissions. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(userLimit.retryAfterSeconds), "Cache-Control": "no-store" } },
    );
  }

  const body = await request.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const expectedTurnId = typeof body?.expectedTurnId === "string" ? body.expectedTurnId : "";
  const inputMode: InputMode = body?.inputMode === "voice" ? "voice" : "text";
  const modeId = body?.modeId === undefined || body?.modeId === null || body?.modeId === ""
    ? "text"
    : isDebateModeId(body.modeId)
      ? body.modeId
      : null;
  if (!modeId) return NextResponse.json({ error: "Unknown debate mode." }, { status: 400 });
  const mode = resolveMode(modeId);
  const clientElapsedSeconds = typeof body?.elapsedSeconds === "number" && Number.isFinite(body.elapsedSeconds)
    ? Math.max(0, Math.min(60 * 60, Math.round(body.elapsedSeconds)))
    : null;
  const speechTiming = inputMode === "voice" ? parseTurnTiming(body?.timing) : null;

  if (!message) return NextResponse.json({ error: "message is required." }, { status: 400 });
  if (!expectedTurnId) {
    return NextResponse.json({ error: "expectedTurnId is required." }, { status: 400 });
  }
  if (isSuspiciousLength(message)) {
    return NextResponse.json({ error: "Response is too long. Keep it under 6,000 characters." }, { status: 400 });
  }

  const mod = moderateContent(message);
  if (mod.blocked) {
    return NextResponse.json(
      { error: `Message blocked: ${mod.flags.map((f) => f.note).join(" ")}`, moderation: mod.flags },
      { status: 400 },
    );
  }

  const { data: debate, error: debateError } = await db
    .from("solo_debates")
    .select("*")
    .eq("id", debateId)
    .eq("user_id", user.id)
    .single();
  if (debateError || !debate) return NextResponse.json({ error: "Debate not found." }, { status: 404 });
  if (debate.status !== "active") return NextResponse.json({ error: "Debate already completed." }, { status: 409 });

  const { data: topic, error: topicError } = await db
    .from("daily_topics")
    .select("*")
    .eq("id", debate.topic_id)
    .single();
  if (topicError || !topic) return NextResponse.json({ error: "Topic not found." }, { status: 404 });

  const { data: turns, error: turnsError } = await db
    .from("solo_debate_turns")
    .select("*")
    .eq("debate_id", debateId)
    .order("round_number", { ascending: true });
  if (turnsError || !turns || turns.length === 0) {
    return NextResponse.json({ error: "Debate has no turns." }, { status: 500 });
  }

  const debateFormat = debate.format === "sprint" ? "sprint" : "full";
  const roundCap = roundCapFor(debateFormat);
  const expectedTurn = turns.find((turn) => turn.id === expectedTurnId) ?? null;
  const pendingTurn = turns[turns.length - 1];

  // Lost-response retry: if this exact answer already committed for the exact
  // turn the client intended, replay the committed state instead of returning
  // a generic conflict or attaching the draft to a newer round.
  if (expectedTurn?.user_message) {
    if (expectedTurn.user_message === message) {
      const nextTurn =
        turns.find((turn) => turn.round_number === expectedTurn.round_number + 1) ?? null;
      return NextResponse.json({
        completedTurn: expectedTurn,
        nextTurn,
        roundCount: debate.round_count,
        debateComplete: expectedTurn.round_number >= roundCap,
        replayed: true,
      });
    }
    return NextResponse.json(
      {
        error: "This round was already answered in another tab. Refresh before continuing.",
        code: "stale_turn",
        currentTurnId: pendingTurn?.id ?? null,
      },
      { status: 409 },
    );
  }

  if (!expectedTurn || !pendingTurn || pendingTurn.id !== expectedTurnId) {
    return NextResponse.json(
      {
        error: "This debate advanced in another tab. Your draft was not submitted; refresh before continuing.",
        code: "stale_turn",
        currentTurnId: pendingTurn?.id ?? null,
      },
      { status: 409 },
    );
  }

  if (pendingTurn.user_message) {
    return NextResponse.json({ error: "Latest round already answered.", code: "stale_turn" }, { status: 409 });
  }

  const isFinalRound = pendingTurn.round_number >= roundCap;

  const answered = turns.filter((turn) => turn.user_message);
  const prevUserMessage = answered[answered.length - 1]?.user_message ?? null;
  if (prevUserMessage && repeatScore([prevUserMessage, message]) === 1) {
    return NextResponse.json({ error: "That response repeats your previous turn — make a new argument." }, { status: 400 });
  }

  // Everything below this point that can be computed locally is prepared
  // before the submission claim. No external provider is called until the
  // user's response is durably staged.
  const observable = assessTurn({
    userMessage: message,
    opponentMessage: pendingTurn.ai_message,
    round: pendingTurn.round_number,
  });
  const scores = observable.scores;
  const turnScore = observable.turnScore;
  const wordCount = message.trim().split(/\s+/).filter(Boolean).length;
  // Timed elapsedSeconds is overwritten inside PostgreSQL using the DB clock.
  // Supplying 0 here avoids inventing a "timing unavailable" warning before
  // the authoritative elapsed value exists.
  const provisionalElapsed = mode.hardTimeLimitSecs === null ? clientElapsedSeconds : 0;
  const modeWarnings = checkModeConstraints(mode, wordCount, provisionalElapsed, inputMode);
  if (inputMode === "voice" && !speechTiming) {
    modeWarnings.push("Speech timing was unavailable, so pace and filler analysis were not recorded.");
  }
  const speechAnalysis = speechTiming
    ? analyseSpeechTurn(message, speechTiming, prevUserMessage ?? undefined)
    : null;
  const speechQuality = speechAnalysis ? scoreSpeechQuality(speechAnalysis) : null;
  const candidateTrainingMeta: TurnTrainingMeta = {
    modeId,
    elapsedSeconds: provisionalElapsed,
    modeWarnings,
    speechTiming,
    speechAnalysis,
    speechQuality,
  };

  const submissionToken = randomUUID();
  const { data: claimData, error: claimError } = await db.rpc("claim_solo_turn_submission", {
    p_debate_id: debateId,
    p_user_id: user.id,
    p_turn_id: pendingTurn.id,
    p_token: submissionToken,
    p_mode: modeId,
    p_require_window: mode.hardTimeLimitSecs !== null,
    p_user_message: message,
    p_input_mode: inputMode,
    p_scores: JSON.stringify(scores),
    p_turn_score: turnScore,
    p_assessment: JSON.stringify(observable.assessment),
    p_training_meta: JSON.stringify(candidateTrainingMeta),
    p_elapsed_seconds: clientElapsedSeconds,
    p_stale_after_seconds: 300,
  });
  if (claimError) {
    console.error("Failed to stage solo submission:", claimError);
    return NextResponse.json({ error: "Failed to save your response. Please retry." }, { status: 500 });
  }

  const claim = (claimData ?? {}) as ClaimSubmissionResult;
  if (!claim.claimed) {
    if (claim.reason === "timing-window-invalid") {
      return NextResponse.json(
        { error: `${mode.label} time limit expired. Switch modes to continue this round.` },
        { status: 422 },
      );
    }
    if (claim.reason === "debate-finalizing") {
      return NextResponse.json(
        { error: "This debate is being finished in another tab. Your response was not submitted.", code: "debate_finalizing" },
        { status: 409 },
      );
    }
    if (claim.reason === "stale-turn") {
      return NextResponse.json(
        { error: "This debate advanced before your response could be claimed. Refresh before continuing.", code: "stale_turn" },
        { status: 409 },
      );
    }
    if (claim.reason === "submission-in-progress") {
      return NextResponse.json(
        {
          error: "Your response is already saved and the opponent reply is being generated.",
          ...stagedResponsePayload(claim.staged),
        },
        { status: 409 },
      );
    }
    if (claim.reason === "submission-already-staged") {
      return NextResponse.json(
        {
          error: "A response is already saved for this round. The saved response has been restored so you can retry opponent generation.",
          ...stagedResponsePayload(claim.staged),
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Latest round already answered or debate no longer active." }, { status: 409 });
  }

  const staged = claim.staged;
  const effectiveMessage = typeof staged?.userMessage === "string" ? staged.userMessage : message;
  const effectiveModeId = isDebateModeId(staged?.modeId) ? staged.modeId : modeId;
  const effectiveTrainingMeta =
    staged?.trainingMeta && typeof staged.trainingMeta === "object"
      ? staged.trainingMeta as TurnTrainingMeta
      : { ...candidateTrainingMeta, elapsedSeconds: claim.elapsedSeconds ?? candidateTrainingMeta.elapsedSeconds };

  let feedback: string | null = null;
  let nextAiMessage: string | null = null;

  if (!isFinalRound) {
    const history = turns.slice(0, -1).flatMap((turn) => [
      { role: "ai" as const, text: turn.ai_message },
      ...(turn.user_message ? [{ role: "user" as const, text: turn.user_message }] : []),
    ]);
    history.push({ role: "ai", text: pendingTurn.ai_message });

    let argumentRoute: ArgumentRoute | undefined;
    try {
      const classified = await classifyArgumentBatchDetailed([effectiveMessage], {
        topicTitle: topic.title,
        topicPrompt: topic.prompt,
        tier: "fast",
      });
      const plan = routeClassifiedArguments(
        [{ id: `solo-${pendingTurn.id}`, text: effectiveMessage, owner: "a", round: pendingTurn.round_number }],
        classified.classifications,
        classified.batchCount,
      );
      recordRoutingTelemetry(routingSummary(plan, 0));
      if (plan.route === "response-generation" || plan.route === "lightweight") argumentRoute = plan.route;
    } catch {
      console.warn("Structural argument routing unavailable; continuing with the normal response path.");
    }

    try {
      const result = await withProviderFallback(
        () =>
          debateTurn({
            topicTitle: topic.title,
            topicPrompt: topic.prompt,
            userSide: debate.side as "for" | "against",
            history,
            latestUserMessage: effectiveMessage,
            argumentRoute,
          }),
        isValidDebateTurn,
        () =>
          anthropicTurn({
            topicTitle: topic.title,
            topicPrompt: topic.prompt,
            userSide: debate.side as "for" | "against",
            history,
            latestUserMessage: effectiveMessage,
            argumentRoute,
          }),
      );
      feedback = result.feedback;
      nextAiMessage = result.aiMessage;
    } catch (error) {
      console.error("Failed to generate the next debate turn:", error);
      await db.rpc("release_solo_turn_submission", {
        p_debate_id: debateId,
        p_user_id: user.id,
        p_turn_id: pendingTurn.id,
        p_token: submissionToken,
      });
      return NextResponse.json(
        {
          error: "Your response was saved, but the opponent is temporarily unavailable. Retry to continue from the saved response.",
          ...stagedResponsePayload({
            ...staged,
            userMessage: effectiveMessage,
            modeId: effectiveModeId,
            trainingMeta: effectiveTrainingMeta,
          }),
        },
        { status: 502 },
      );
    }
  }

  const nextRoundNumber = isFinalRound ? null : pendingTurn.round_number + 1;
  const { data: finalizeData, error: finalizeError } = await db.rpc("finalize_solo_turn_submission", {
    p_debate_id: debateId,
    p_user_id: user.id,
    p_turn_id: pendingTurn.id,
    p_token: submissionToken,
    p_feedback: feedback,
    p_next_round_number: nextRoundNumber,
    p_next_ai_message: nextAiMessage,
  });

  if (finalizeError) {
    console.error("Failed to finalize staged solo submission:", finalizeError);
    await db.rpc("release_solo_turn_submission", {
      p_debate_id: debateId,
      p_user_id: user.id,
      p_turn_id: pendingTurn.id,
      p_token: submissionToken,
    });
    return NextResponse.json(
      {
        error: "Your response is saved, but the round could not advance. Retry to continue from the saved response.",
        ...stagedResponsePayload({
          ...staged,
          userMessage: effectiveMessage,
          modeId: effectiveModeId,
          trainingMeta: effectiveTrainingMeta,
        }),
      },
      { status: 500 },
    );
  }

  const finalized = (finalizeData ?? {}) as FinalizeSubmissionResult;
  if (!finalized.saved || !finalized.completedTurn) {
    await db.rpc("release_solo_turn_submission", {
      p_debate_id: debateId,
      p_user_id: user.id,
      p_turn_id: pendingTurn.id,
      p_token: submissionToken,
    });
    return NextResponse.json(
      {
        error: "Your response is saved, but another request took over opponent generation. Retry to load the completed round.",
        ...stagedResponsePayload({
          ...staged,
          userMessage: effectiveMessage,
          modeId: effectiveModeId,
          trainingMeta: effectiveTrainingMeta,
        }),
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    completedTurn: finalized.completedTurn,
    nextTurn: finalized.nextTurn ?? null,
    roundCount: nextRoundNumber ?? pendingTurn.round_number,
    debateComplete: isFinalRound,
  });
}
