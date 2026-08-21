import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { levelForPoints, updateStreak } from "@/lib/gamification";
import { isSuspiciousLength } from "@/lib/moderation";
import type { InputMode, PvpVerdict } from "@/lib/types";

async function awardPoints(userId: string, points: number) {
  const service = createServiceClient();
  const { data: profile } = await service.from("profiles").select("*").eq("id", userId).single();
  if (!profile) return;
  const today = new Date().toISOString().slice(0, 10);
  const streak = updateStreak(today, profile.last_activity_date, profile.current_streak, profile.longest_streak);
  const newTotalPoints = profile.total_points + points;
  await service
    .from("profiles")
    .update({
      total_points: newTotalPoints,
      level: levelForPoints(newTotalPoints),
      current_streak: streak.current_streak,
      longest_streak: streak.longest_streak,
      last_activity_date: streak.last_activity_date,
    })
    .eq("id", userId);
}

export async function POST(request: Request, { params }: { params: Promise<{ matchId: string }> }) {
  const limited = await checkRateLimit(request, { name: "pvp-turn", limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  const { matchId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const inputMode: InputMode = body?.inputMode === "voice" ? "voice" : "text";
  const idempotencyKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim().slice(0, 80) : null;
  if (!message) return NextResponse.json({ error: "message is required." }, { status: 400 });
  if (isSuspiciousLength(message)) {
    return NextResponse.json({ error: "Response is too long. Keep it under 6,000 characters." }, { status: 400 });
  }

  // Moderation: flag but do not distort scoring — block only high-severity (harassment/malicious/unsafe)
  const { moderateContent } = await import("@/lib/moderation");
  const moderation = moderateContent(message);
  if (moderation.blocked) {
    return NextResponse.json({ error: `Message blocked: ${moderation.flags.map((f) => f.note).join(" ")}`, moderation: moderation.flags }, { status: 400 });
  }

  const { data: match, error: matchError } = await supabase
    .from("pvp_matches")
    .select("*")
    .eq("id", matchId)
    .single();
  if (matchError || !match) return NextResponse.json({ error: "Match not found." }, { status: 404 });
  if (match.status !== "active") return NextResponse.json({ error: "Match already completed." }, { status: 409 });
  if (match.player_a !== user.id && match.player_b !== user.id) {
    return NextResponse.json({ error: "Not a participant in this match." }, { status: 403 });
  }
  // Scoring-once guard: if verdict already present, do not re-judge
  if (match.judge_verdict) {
    return NextResponse.json({ error: "Match already has a verdict (scoring once only).", verdict: match.judge_verdict }, { status: 409 });
  }
  if (match.current_turn_player !== user.id) {
    return NextResponse.json({ error: "Not your turn." }, { status: 409 });
  }

  // Idempotency / duplicate event: if same round+player already has this exact message, return existing without re-scoring
  const { data: existingTurns } = await supabase.from("pvp_turns").select("*").eq("match_id", matchId).order("created_at", { ascending: true });
  const isDuplicate = existingTurns?.some((t) => t.player_id === user.id && t.round_number === match.current_round && t.message === message);
  if (idempotencyKey && isDuplicate) {
    const dup = existingTurns!.find((t) => t.player_id === user.id && t.round_number === match.current_round && t.message === message);
    return NextResponse.json({ turn: dup, matchComplete: false, duplicate: true });
  }
  // Late submission: round mismatch already checked; timer expiry is best-effort (client sends startedAt optional)
  if (typeof body?.turnDeadline === "string") {
    const deadline = new Date(body.turnDeadline).getTime();
    if (!isNaN(deadline) && Date.now() > deadline) {
      return NextResponse.json({ error: "Turn deadline exceeded (late submission)." }, { status: 400 });
    }
  }

  const { data: turn, error: turnError } = await supabase
    .from("pvp_turns")
    .insert({ match_id: matchId, player_id: user.id, round_number: match.current_round, message, input_mode: inputMode })
    .select("*")
    .single();
  if (turnError || !turn) {
    // Race: simultaneous submission — the loser gets a turn conflict due to DB ordering
    const msg = String(turnError?.message ?? "");
    if (msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("unique")) {
      return NextResponse.json({ error: "Simultaneous submission — turn already taken." }, { status: 409 });
    }
    console.error("Failed to save PvP turn:", turnError);
    return NextResponse.json({ error: "Failed to save your response." }, { status: 500 });
  }

  const isPlayerA = user.id === match.player_a;
  const roundJustCompleted = !isPlayerA;
  const nextRound = roundJustCompleted ? match.current_round + 1 : match.current_round;
  const nextTurnPlayer = isPlayerA ? match.player_b : match.player_a;
  const matchComplete = roundJustCompleted && nextRound > match.round_limit;

  if (!matchComplete) {
    // Use optimistic concurrency: only advance if still on expected round (prevents simultaneous submission race)
    const { error: advError } = await supabase
      .from("pvp_matches")
      .update({ current_round: nextRound, current_turn_player: nextTurnPlayer })
      .eq("id", matchId)
      .eq("current_round", match.current_round)
      .eq("current_turn_player", user.id);
    if (advError) console.error("Advancing turn (concurrency) failed:", advError);
    return NextResponse.json({ turn, matchComplete: false });
  }

  const service = createServiceClient();
  const { data: topic } = await service.from("daily_topics").select("*").eq("id", match.topic_id).single();
  const { data: allTurns } = await service
    .from("pvp_turns")
    .select("*")
    .eq("match_id", matchId)
    .order("round_number", { ascending: true })
    .order("created_at", { ascending: true });

  const transcript = (allTurns ?? [])
    .map((t) => `${t.player_id === match.player_a ? "Player A" : "Player B"} (round ${t.round_number}): ${t.message}`)
    .join("\n");

  let verdict: PvpVerdict;
  try {
    // Route every judged match through the ensemble harness: it runs Gemini and
    // Anthropic in parallel (whichever keys are present), falls back to a single
    // judge when only one key is set, and always yields uncertainty fields
    // (confidence, score CI, winner posterior, "too close to call").
    if (!process.env.GEMINI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
      throw new Error("No judge configured (set GEMINI_API_KEY or ANTHROPIC_API_KEY).");
    }
    const { liveEnsembleJudge, verdictFromEnsemble } = await import("@/lib/ensembleJudge");
    const ensemble = await liveEnsembleJudge({
      topicTitle: topic?.title ?? "the topic",
      topicPrompt: topic?.prompt ?? "",
      playerASide: match.player_a_side as "for" | "against",
      transcript,
    });
    verdict = verdictFromEnsemble(ensemble);
  } catch (error) {
    console.error("Failed to judge PvP match:", error);
    verdict = {
      winner: "tie" as const,
      playerAScore: 0,
      playerBScore: 0,
      rationale: "Judging failed; no score was assigned.",
      isTie: true,
      tieReason: "The judge could not complete — this result carries no confidence.",
      scoreStatus: "insufficient_evidence",
    } as PvpVerdict;
  }

  const winnerId = verdict.winner === "a" ? match.player_a : verdict.winner === "b" ? match.player_b : null;

  // Scoring once only: only write verdict if still active (concurrency guard)
  const { data: updated } = await service
    .from("pvp_matches")
    .update({
      status: "completed",
      current_round: nextRound,
      current_turn_player: null,
      winner_id: winnerId,
      judge_verdict: verdict,
      completed_at: new Date().toISOString(),
    })
    .eq("id", matchId)
    .eq("status", "active")
    .select("*")
    .maybeSingle();
  // If another request already completed scoring, return existing result for consistency
  if (!updated) {
    const { data: existing } = await service.from("pvp_matches").select("*").eq("id", matchId).single();
    return NextResponse.json({ turn, matchComplete: true, verdict: (existing?.judge_verdict as PvpVerdict | null) ?? verdict, alreadyScored: true });
  }

  if (verdict.scoreStatus !== "insufficient_evidence") {
    await Promise.all([awardPoints(match.player_a, verdict.playerAScore), awardPoints(match.player_b, verdict.playerBScore)]);
  }

  return NextResponse.json({ turn, matchComplete: true, verdict });
}

