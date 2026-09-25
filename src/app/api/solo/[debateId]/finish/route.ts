import { NextResponse } from "next/server";
import { createClient } from "@/lib/backend/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { summarizeSoloDebate } from "@/lib/openrouter";
import { summarizeSoloDebate as anthropicSummarize } from "@/lib/anthropic";
import { withProviderFallback } from "@/lib/aiFallback";
import { isValidSummary } from "@/lib/aiSchema";
import { levelForPoints, updateStreak, POINTS_PER_LEVEL } from "@/lib/gamification";
import { computeCoachRewards, totalBonusXP } from "@/lib/coachRewards";
import { buildEvaluationResult } from "@/lib/evaluationEnvelope";
import { assessArgumentGraph, mergeAssessmentGraphs } from "@/lib/observableAssessment";
import type { ObservableAssessment } from "@/lib/observableAssessment";
import { minRoundsFor, measurementHonestyFor } from "@/lib/sprint";
import { buildResultSnapshot } from "@/lib/resultSnapshot";
import { snapshotFromAssessment } from "@/lib/coachingGoal";
import { countWeaknessesForSide } from "@/lib/repairEffectiveness";
import { recordProductEvent } from "@/lib/productEvents";
import { MAX_ROUNDS, type CoachingRecord } from "@/lib/types";
import { mergeSoloAssessmentsByDebate } from "@/lib/soloAssessmentHistory";

export async function POST(request: Request, { params }: { params: Promise<{ debateId: string }> }) {
  const limited = await checkRateLimit(request, { name: "solo-finish", limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  const { debateId } = await params;
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: debate, error: debateError } = await db
    .from("solo_debates")
    .select("*")
    .eq("id", debateId)
    .eq("user_id", user.id)
    .single();
  if (debateError || !debate) return NextResponse.json({ error: "Debate not found." }, { status: 404 });
  if (debate.status === "completed") return NextResponse.json({ error: "Debate already completed." }, { status: 409 });

  const format = debate.format === "sprint" ? "sprint" : "full";
  const minRounds = minRoundsFor(format);

  const { data: turns, error: turnsError } = await db
    .from("solo_debate_turns")
    .select("*")
    .eq("debate_id", debateId)
    .order("round_number", { ascending: true });
  if (turnsError || !turns) return NextResponse.json({ error: "Failed to load turns." }, { status: 500 });

  const answered = turns.filter((turn) => turn.user_message);
  if (answered.length < minRounds) {
    return NextResponse.json(
      { error: `Complete at least ${minRounds} rounds before finishing.` },
      { status: 400 },
    );
  }

  const totalScore = answered.reduce((sum, turn) => sum + (turn.turn_score ?? 0), 0);

  // Claim completion atomically before any model call or point award. Two
  // concurrent finishes must not both summarize (double cost) or both award
  // profile points (double credit).
  const { data: completedDebate, error: completeError } = await db
    .from("solo_debates")
    .update({ status: "completed", total_score: totalScore, completed_at: new Date().toISOString() })
    .eq("id", debateId)
    .eq("status", "active")
    .select("id");
  if (completeError) {
    console.error("Failed to complete debate:", completeError);
    return NextResponse.json({ error: "Failed to finish debate." }, { status: 500 });
  }
  if (!completedDebate || completedDebate.length === 0) {
    return NextResponse.json({ error: "Debate already completed." }, { status: 409 });
  }

  const { data: topic } = await db.from("daily_topics").select("title").eq("id", debate.topic_id).single();

  const transcript = answered
    .map((turn) => `AI: ${turn.ai_message}\nUser: ${turn.user_message}`)
    .join("\n\n");

  let summary;
  try {
    summary = await withProviderFallback(
      () => summarizeSoloDebate({ topicTitle: topic?.title ?? "the debate", transcript }),
      isValidSummary,
      () => anthropicSummarize({ topicTitle: topic?.title ?? "the debate", transcript }),
    );
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

  // Award points atomically through increment_total_points (defined in the
  // owned-backend base migration); streak fields are idempotent per day.
  const { data: profile } = await db.from("profiles").select("total_points, last_activity_date, current_streak, longest_streak").eq("id", user.id).single();
  if (profile) {
    const today = new Date().toISOString().slice(0, 10);
    const streak = updateStreak(today, profile.last_activity_date, profile.current_streak, profile.longest_streak);

    let awarded = false;
    try {
      const { data: newTotal } = await db.rpc("increment_total_points", {
        p_user_id: user.id,
        p_points: totalScore + bonusXP,
        p_points_per_level: POINTS_PER_LEVEL,
      });
      awarded = typeof newTotal === "number";
    } catch {
      // RPC not deployed yet — fall through to read-modify-write.
    }

    if (!awarded) {
      const newTotalPoints = profile.total_points + totalScore + bonusXP;
      await db.from("profiles").update({ total_points: newTotalPoints, level: levelForPoints(newTotalPoints) }).eq("id", user.id);
    }
    await db
      .from("profiles")
      .update({
        current_streak: streak.current_streak,
        longest_streak: streak.longest_streak,
        last_activity_date: streak.last_activity_date,
      })
      .eq("id", user.id);
  }

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
    await db.from("solo_debates").update({ coaching: coachingUpdate }).eq("id", debateId);
  }

  void recordProductEvent("debate_completed", { format, side: debate.side, debateId });

  const evaluation = buildEvaluationResult({
    scoreStatus: finalAssessment?.status ?? "insufficient_evidence",
    summary,
    observableAssessment: finalAssessment ?? undefined,
  });
  return NextResponse.json({
    totalScore,
    bonusXP,
    rewardEvents,
    summary,
    assessment: finalAssessment,
    evaluation,
    format,
    honesty: measurementHonestyFor(format),
    snapshot,
    coaching: coachingUpdate,
  });
}
