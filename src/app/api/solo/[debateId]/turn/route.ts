import { NextResponse } from "next/server";
import { createClient } from "@/lib/backend/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { debateTurn } from "@/lib/openrouter";
import { debateTurn as anthropicTurn } from "@/lib/anthropic";
import { withProviderFallback } from "@/lib/aiFallback";
import { isValidDebateTurn } from "@/lib/aiSchema";
import { assessTurn } from "@/lib/observableAssessment";
import { isSuspiciousLength, moderateContent, repeatScore } from "@/lib/moderation";
import { type InputMode, type SoloDebateTurn, type TurnTrainingMeta } from "@/lib/types";
import { roundCapFor } from "@/lib/sprint";
import { recordProductEventForUser } from "@/lib/productEvents";
import { checkModeConstraints, hardTimeLimitError, isDebateModeId, resolveMode } from "@/lib/debateModes";
import { analyseSpeechTurn, parseTurnTiming, scoreSpeechQuality } from "@/lib/speechAnalysis";
import {
  classifyArgumentBatchDetailed,
  recordRoutingTelemetry,
  routeClassifiedArguments,
  routingSummary,
} from "@/lib/argumentRouting";
import type { ArgumentRoute } from "@/lib/argumentTaxonomy";

type AdvanceResult = {
  saved?: boolean;
  reason?: string;
  nextTurn?: SoloDebateTurn | null;
};

export async function POST(request: Request, { params }: { params: Promise<{ debateId: string }> }) {
  const limited = await checkRateLimit(request, { name: "solo-turn", limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  const { debateId } = await params;
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  // Timestamp only after the request body is present. Starting an HTTP request
  // before expiry and delaying the body must not extend a timed response window.
  const receivedAtMs = Date.now();
  const receivedAt = new Date(receivedAtMs).toISOString();
  const message = typeof body?.message === "string" ? body.message.trim() : "";
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
  if (isSuspiciousLength(message)) {
    return NextResponse.json({ error: "Response is too long. Keep it under 6,000 characters." }, { status: 400 });
  }

  const mod = moderateContent(message);
  if (mod.blocked) {
    return NextResponse.json({ error: `Message blocked: ${mod.flags.map((f) => f.note).join(" ")}`, moderation: mod.flags }, { status: 400 });
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

  const pendingTurn = turns[turns.length - 1];
  if (pendingTurn.user_message) {
    return NextResponse.json({ error: "Latest round already answered." }, { status: 409 });
  }

  const debateFormat = debate.format === "sprint" ? "sprint" : "full";
  const roundCap = roundCapFor(debateFormat);
  const isFinalRound = pendingTurn.round_number >= roundCap;

  let elapsedSeconds = clientElapsedSeconds;
  if (mode.hardTimeLimitSecs !== null) {
    const startedAtMs = pendingTurn.response_window_started_at
      ? Date.parse(pendingTurn.response_window_started_at)
      : Number.NaN;
    const expiresAtMs = pendingTurn.response_window_expires_at
      ? Date.parse(pendingTurn.response_window_expires_at)
      : Number.NaN;

    if (
      pendingTurn.response_mode !== modeId ||
      !Number.isFinite(startedAtMs) ||
      !Number.isFinite(expiresAtMs)
    ) {
      return NextResponse.json(
        { error: `Start the ${mode.label} response timer before submitting.` },
        { status: 422 },
      );
    }
    if (receivedAtMs < startedAtMs || receivedAtMs > expiresAtMs) {
      return NextResponse.json(
        { error: `${mode.label} time limit expired. Switch modes to continue this round.` },
        { status: 422 },
      );
    }
    elapsedSeconds = Math.max(0, Math.round((receivedAtMs - startedAtMs) / 1000));
  }

  const timingError = hardTimeLimitError(mode, elapsedSeconds);
  if (timingError) return NextResponse.json({ error: timingError }, { status: 422 });

  const answered = turns.filter((t) => t.user_message);
  const prevUserMessage = answered[answered.length - 1]?.user_message ?? null;
  if (prevUserMessage && repeatScore([prevUserMessage, message]) === 1) {
    return NextResponse.json({ error: "That response repeats your previous turn — make a new argument." }, { status: 400 });
  }

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
      const classified = await classifyArgumentBatchDetailed([message], {
        topicTitle: topic.title,
        topicPrompt: topic.prompt,
        tier: "fast",
      });
      const plan = routeClassifiedArguments(
        [{ id: `solo-${pendingTurn.id}`, text: message, owner: "a", round: pendingTurn.round_number }],
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
            latestUserMessage: message,
            argumentRoute,
          }),
        isValidDebateTurn,
        () =>
          anthropicTurn({
            topicTitle: topic.title,
            topicPrompt: topic.prompt,
            userSide: debate.side as "for" | "against",
            history,
            latestUserMessage: message,
            argumentRoute,
          }),
      );
      feedback = result.feedback;
      nextAiMessage = result.aiMessage;
    } catch (error) {
      console.error("Failed to generate the next debate turn:", error);
      return NextResponse.json(
        { error: "The opponent is temporarily unavailable. Your draft has not been submitted; retry when ready." },
        { status: 502 },
      );
    }
  }

  const observable = assessTurn({
    userMessage: message,
    opponentMessage: pendingTurn.ai_message,
    round: pendingTurn.round_number,
  });
  const scores = observable.scores;
  const turnScore = observable.turnScore;
  const wordCount = message.trim().split(/\s+/).filter(Boolean).length;
  const modeWarnings = checkModeConstraints(mode, wordCount, elapsedSeconds, inputMode);
  if (inputMode === "voice" && !speechTiming) {
    modeWarnings.push("Speech timing was unavailable, so pace and filler analysis were not recorded.");
  }
  const speechAnalysis = speechTiming
    ? analyseSpeechTurn(message, speechTiming, prevUserMessage ?? undefined)
    : null;
  const speechQuality = speechAnalysis ? scoreSpeechQuality(speechAnalysis) : null;
  const trainingMeta: TurnTrainingMeta = {
    modeId,
    elapsedSeconds,
    modeWarnings,
    speechTiming,
    speechAnalysis,
    speechQuality,
  };

  const nextRoundNumber = isFinalRound ? null : pendingTurn.round_number + 1;
  const { data: advanceData, error: advanceError } = await db.rpc("advance_solo_debate_turn", {
    p_debate_id: debateId,
    p_user_id: user.id,
    p_turn_id: pendingTurn.id,
    p_received_at: receivedAt,
    p_mode: modeId,
    p_require_window: mode.hardTimeLimitSecs !== null,
    p_user_message: message,
    p_input_mode: inputMode,
    p_scores: JSON.stringify(scores),
    p_turn_score: turnScore,
    p_feedback: feedback,
    p_assessment: JSON.stringify(observable.assessment),
    p_training_meta: JSON.stringify(trainingMeta),
    p_next_round_number: nextRoundNumber,
    p_next_ai_message: nextAiMessage,
  });
  if (advanceError) {
    console.error("Failed to advance solo debate atomically:", advanceError);
    return NextResponse.json({ error: "Failed to save your response. Nothing was changed; please retry." }, { status: 500 });
  }

  const advanced = (advanceData ?? {}) as AdvanceResult;
  if (!advanced.saved) {
    if (advanced.reason === "timing-window-invalid") {
      return NextResponse.json(
        { error: `${mode.label} time limit expired. Switch modes to continue this round.` },
        { status: 422 },
      );
    }
    return NextResponse.json({ error: "Latest round already answered or debate no longer active." }, { status: 409 });
  }

  await recordProductEventForUser(user.id, "round_completed", {
    format: debateFormat,
    side: debate.side as "for" | "against",
    round: pendingTurn.round_number,
    debateId,
  });

  const nextTurn = (advanced.nextTurn ?? null) as SoloDebateTurn | null;
  return NextResponse.json({
    completedTurn: {
      ...pendingTurn,
      user_message: message,
      input_mode: inputMode,
      scores,
      turn_score: turnScore,
      feedback,
      assessment: observable.assessment,
      training_meta: trainingMeta,
    },
    nextTurn,
    roundCount: nextRoundNumber ?? pendingTurn.round_number,
    debateComplete: isFinalRound,
  });
}
