import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { summarizeSoloDebate } from "@/lib/gemini";
import { levelForPoints, updateStreak } from "@/lib/gamification";
import { MIN_ROUNDS } from "@/lib/types";
import { assessArgumentGraph, mergeAssessmentGraphs } from "@/lib/observableAssessment";
import type { ObservableAssessment } from "@/lib/observableAssessment";

export async function POST(request: Request, { params }: { params: Promise<{ debateId: string }> }) {
  const limited = await checkRateLimit(request, { name: "solo-finish", limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  const { debateId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: debate, error: debateError } = await supabase
    .from("solo_debates")
    .select("*")
    .eq("id", debateId)
    .eq("user_id", user.id)
    .single();
  if (debateError || !debate) return NextResponse.json({ error: "Debate not found." }, { status: 404 });
  if (debate.status === "completed") return NextResponse.json({ error: "Debate already completed." }, { status: 409 });

  const { data: turns, error: turnsError } = await supabase
    .from("solo_debate_turns")
    .select("*")
    .eq("debate_id", debateId)
    .order("round_number", { ascending: true });
  if (turnsError || !turns) return NextResponse.json({ error: "Failed to load turns." }, { status: 500 });

  const answered = turns.filter((turn) => turn.user_message);
  if (answered.length < MIN_ROUNDS) {
    return NextResponse.json(
      { error: `Complete at least ${MIN_ROUNDS} rounds before finishing.` },
      { status: 400 },
    );
  }

  const totalScore = answered.reduce((sum, turn) => sum + (turn.turn_score ?? 0), 0);

  const { data: topic } = await supabase.from("daily_topics").select("title").eq("id", debate.topic_id).single();

  const transcript = answered
    .map((turn) => `AI: ${turn.ai_message}\nUser: ${turn.user_message}`)
    .join("\n\n");

  let summary;
  try {
    summary = await summarizeSoloDebate({ topicTitle: topic?.title ?? "the debate", transcript });
  } catch (error) {
    console.error("Failed to summarize debate:", error);
    summary = { overallFeedback: "Great work completing the debate.", strengths: [], improvements: [] };
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

  await supabase
    .from("solo_debates")
    .update({ status: "completed", total_score: totalScore, completed_at: new Date().toISOString() })
    .eq("id", debateId);

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (profile) {
    const today = new Date().toISOString().slice(0, 10);
    const streak = updateStreak(today, profile.last_activity_date, profile.current_streak, profile.longest_streak);
    const newTotalPoints = profile.total_points + totalScore;
    await supabase
      .from("profiles")
      .update({
        total_points: newTotalPoints,
        level: levelForPoints(newTotalPoints),
        current_streak: streak.current_streak,
        longest_streak: streak.longest_streak,
        last_activity_date: streak.last_activity_date,
      })
      .eq("id", user.id);
  }

  return NextResponse.json({ totalScore, summary, assessment: finalAssessment });
}

