import { NextResponse } from "next/server";
import { createClient } from "@/lib/backend/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { debateOpening } from "@/lib/openrouter";
import { debateOpening as anthropicOpening } from "@/lib/anthropic";
import { withProviderFallback } from "@/lib/aiFallback";
import { isValidOpening } from "@/lib/aiSchema";
import type { DebateSide } from "@/lib/types";
import { resolveDebateFormat, type DebateFormat } from "@/lib/sprint";
import { assignChallengeSide, type SideHistoryItem } from "@/lib/challengeMe";
import { pickFocusDimension } from "@/lib/coachingGoal";
import { buildLedgerForUser } from "@/lib/skillLedgerServer";
import { recordProductEvent } from "@/lib/productEvents";

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
  const format: DebateFormat = resolveDebateFormat(body?.format);
  if (!topicId) {
    return NextResponse.json({ error: "topicId is required." }, { status: 400 });
  }

  const { data: topic, error: topicError } = await db
    .from("daily_topics")
    .select("*")
    .eq("id", topicId)
    .single();
  if (topicError || !topic) return NextResponse.json({ error: "Topic not found." }, { status: 404 });

  // Side resolution: explicit pick, or "Challenge me" — an explainable choice
  // from the user's own history (never presented as optimised, just reasoned).
  let side: DebateSide;
  let sideReason: string | null = null;
  if (body?.side === "challenge") {
    const { data: historyRows } = await db
      .from("solo_debates")
      .select("side, total_score")
      .eq("user_id", user.id)
      .eq("status", "completed")
      .order("completed_at", { ascending: true })
      .limit(20);
    const history: SideHistoryItem[] = (historyRows ?? []).map((row) => ({
      side: row.side as DebateSide,
      totalScore: typeof row.total_score === "number" ? row.total_score : null,
    }));
    const assignment = assignChallengeSide(history);
    side = assignment.side;
    sideReason = assignment.reason;
    void recordProductEvent("challenge_me_selected", { format, side, reason: assignment.rule });
  } else if (body?.side === "for" || body?.side === "against") {
    side = body.side;
  } else {
    return NextResponse.json({ error: "side must be 'for', 'against', or 'challenge'." }, { status: 400 });
  }

  // The daily goal travels with the debate: whichever dimension the coach
  // focuses on today is what the finish step will assess.
  let coachingDimension: string | null = null;
  try {
    const ledger = await buildLedgerForUser(user.id);
    coachingDimension = pickFocusDimension(ledger.points);
  } catch {
    coachingDimension = null;
  }

  const { data: debate, error: debateError } = await db
    .from("solo_debates")
    .insert({
      user_id: user.id,
      topic_id: topicId,
      side,
      round_count: 1,
      format,
      coaching: { dimension: coachingDimension, sideReason },
    })
    .select("*")
    .single();
  if (debateError || !debate) {
    console.error("Failed to create solo debate:", debateError);
    return NextResponse.json({ error: "Failed to start debate." }, { status: 500 });
  }

  void recordProductEvent(format === "sprint" ? "sprint_started" : "full_debate_started", {
    format,
    side,
    reason: sideReason,
    debateId: debate.id,
  });

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
    // Compensating delete: an active debate with zero turns is a dead end —
    // the dashboard would keep linking it and every turn submit would fail.
    await db.from("solo_debates").delete().eq("id", debate.id);
    return NextResponse.json({ error: "Failed to generate AI opening." }, { status: 502 });
  }

  const { data: turn, error: turnError } = await db
    .from("solo_debate_turns")
    .insert({ debate_id: debate.id, round_number: 1, ai_message: aiMessage })
    .select("*")
    .single();
  if (turnError || !turn) {
    console.error("Failed to create opening turn:", turnError);
    await db.from("solo_debates").delete().eq("id", debate.id);
    return NextResponse.json({ error: "Failed to start debate." }, { status: 500 });
  }

  return NextResponse.json({ debate, turn, side, sideReason, format });
}
