import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { debateTurn } from "@/lib/gemini";
import { assessTurn } from "@/lib/observableAssessment";
import type { InputMode } from "@/lib/types";

export async function POST(request: Request, { params }: { params: Promise<{ debateId: string }> }) {
  const limited = await checkRateLimit(request, { name: "solo-turn", limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  const { debateId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const inputMode: InputMode = body?.inputMode === "voice" ? "voice" : "text";
  if (!message) return NextResponse.json({ error: "message is required." }, { status: 400 });

  // Moderation: block high-severity only; do not alter scoring
  const { moderateContent } = await import("@/lib/moderation");
  const mod = moderateContent(message);
  if (mod.blocked) {
    return NextResponse.json({ error: `Message blocked: ${mod.flags.map((f) => f.note).join(" ")}`, moderation: mod.flags }, { status: 400 });
  }

  const { data: debate, error: debateError } = await supabase
    .from("solo_debates")
    .select("*")
    .eq("id", debateId)
    .eq("user_id", user.id)
    .single();
  if (debateError || !debate) return NextResponse.json({ error: "Debate not found." }, { status: 404 });
  if (debate.status !== "active") return NextResponse.json({ error: "Debate already completed." }, { status: 409 });

  const { data: topic, error: topicError } = await supabase
    .from("daily_topics")
    .select("*")
    .eq("id", debate.topic_id)
    .single();
  if (topicError || !topic) return NextResponse.json({ error: "Topic not found." }, { status: 404 });

  const { data: turns, error: turnsError } = await supabase
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

  const history = turns.slice(0, -1).flatMap((turn) => [
    { role: "ai" as const, text: turn.ai_message },
    ...(turn.user_message ? [{ role: "user" as const, text: turn.user_message }] : []),
  ]);
  history.push({ role: "ai", text: pendingTurn.ai_message });

  let result;
  try {
    result = await debateTurn({
      topicTitle: topic.title,
      topicPrompt: topic.prompt,
      userSide: debate.side as "for" | "against",
      history,
      latestUserMessage: message,
    });
  } catch (error) {
    console.error("Failed to score debate turn:", error);
    return NextResponse.json({ error: "Failed to evaluate your response." }, { status: 502 });
  }

  // The model only supplies feedback and the next challenge. Scores are
  // recomputed from a deterministic turn graph so verbosity cannot buy points
  // and no model-authored 0–10 number is persisted as ground truth.
  const observable = assessTurn({
    userMessage: message,
    opponentMessage: pendingTurn.ai_message,
    round: pendingTurn.round_number,
  });
  const scores = observable.scores;
  const turnScore = observable.turnScore;

  const { error: updateError } = await supabase
    .from("solo_debate_turns")
    .update({
      user_message: message,
      input_mode: inputMode,
      scores,
      turn_score: turnScore,
      feedback: result.feedback,
      assessment: observable.assessment,
    })
    .eq("id", pendingTurn.id);
  if (updateError) {
    console.error("Failed to save turn result:", updateError);
    return NextResponse.json({ error: "Failed to save your response." }, { status: 500 });
  }

  const nextRoundNumber = pendingTurn.round_number + 1;
  const { data: nextTurn, error: nextTurnError } = await supabase
    .from("solo_debate_turns")
    .insert({ debate_id: debateId, round_number: nextRoundNumber, ai_message: result.aiMessage })
    .select("*")
    .single();
  if (nextTurnError || !nextTurn) {
    console.error("Failed to create next turn:", nextTurnError);
    return NextResponse.json({ error: "Failed to continue debate." }, { status: 500 });
  }

  await supabase.from("solo_debates").update({ round_count: nextRoundNumber }).eq("id", debateId);

  return NextResponse.json({
    completedTurn: { ...pendingTurn, user_message: message, scores, turn_score: turnScore, feedback: result.feedback, assessment: observable.assessment },
    nextTurn,
    roundCount: nextRoundNumber,
  });
}

