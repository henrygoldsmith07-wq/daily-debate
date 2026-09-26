import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/backend/server";
import { checkRateLimit } from "@/lib/rateLimit";
import {
  buildCoachProfile,
  DIMENSION_LABELS,
  selectFocus,
  todaysDrill,
  type CoachDim,
} from "@/lib/adaptiveCoach";
import { loadCoachingContext } from "@/lib/coachingContextServer";
import { getTodayTopic } from "@/lib/dailyTopic";
import { getCurrentUser } from "@/lib/currentViewer";

// Today's training focus: the lowest skill dimension adjusted by movement
// (improving dimensions are deprioritised; dimensions whose previous drill
// produced negative movement are skipped). Idempotent per day — the same
// assignment row is returned on repeat calls so the coach stays deliberate.

export async function GET(request: Request) {
  const limited = await checkRateLimit(request, { name: "coach-today", limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const topic = await getTodayTopic();
  const context = await loadCoachingContext(user.id, { currentTopicId: topic.id });
  if (!context.ledger) {
    return NextResponse.json(
      {
        error: "Coaching context is temporarily unavailable.",
        coachingStatus: context.status,
        degradationReasons: context.degradationReasons,
      },
      { status: 503 },
    );
  }
  const ledger = context.ledger;
  const outcomes = context.drillOutcomes;
  const service = createServiceClient();
  const pendingRetest = context.selectedRetest;

  const { dims, slopes } = buildCoachProfile(ledger.points);
  let focus: CoachDim | null;
  let reason: string;
  if (pendingRetest) {
    focus =
      dims.find((d) => d.key === pendingRetest.dimension) ?? {
        key: pendingRetest.dimension,
        label: DIMENSION_LABELS[pendingRetest.dimension],
        score: null,
        hasData: false,
      };
    reason = "deliberate retest after your repair";
  } else {
    const selected = selectFocus(dims, slopes, outcomes);
    focus = selected.focus;
    reason = selected.reason;
  }

  if (!focus) {
    return NextResponse.json({
      profile: dims,
      assignment: null,
      reason,
      retest: null,
      coachingStatus: context.status,
      degradationReasons: context.degradationReasons,
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const drill = todaysDrill(focus.key, new Date().toISOString());

  // Idempotent per (user, day), with one exception: an OPEN generic drill may
  // be repurposed when a new repair creates a deliberate retest. An attempted
  // drill is historical practice and is never rewritten.
  const beforeScore = focus.score;
  const { data: existing } = await service
    .from("drill_assignments")
    .select("*")
    .eq("user_id", user.id)
    .eq("assigned_date", today)
    .maybeSingle();

  let assignment;
  if (
    existing &&
    pendingRetest &&
    existing.status === "open" &&
    existing.dimension !== focus.key
  ) {
    const { data: retargeted, error } = await service
      .from("drill_assignments")
      .update({
        dimension: focus.key,
        minutes: drill.minutes,
        title: drill.title,
        prompt: drill.prompt,
        before_score: beforeScore,
      })
      .eq("id", existing.id)
      .eq("user_id", user.id)
      .eq("status", "open")
      .select("*")
      .single();
    if (error || !retargeted) {
      console.error("Failed to retarget open drill for repair retest:", error);
      assignment = existing;
    } else {
      assignment = retargeted;
    }
  } else if (existing) {
    assignment = existing;
  } else {
    const { data: created, error } = await service
      .from("drill_assignments")
      .insert({
        user_id: user.id,
        dimension: focus.key,
        minutes: drill.minutes,
        title: drill.title,
        prompt: drill.prompt,
        assigned_date: today,
        before_score: beforeScore,
      })
      .select("*")
      .single();
    if (error) {
      console.error("Failed to create drill assignment:", error);
      return NextResponse.json({ error: "Failed to create training assignment." }, { status: 500 });
    }
    assignment = created;
  }

  return NextResponse.json({
    profile: dims,
    focusReason: reason,
    assignment,
    retest: pendingRetest
      ? {
          dimension: pendingRetest.dimension,
          label: DIMENSION_LABELS[pendingRetest.dimension],
          repairDebateId: pendingRetest.debateId,
          attemptedAt: pendingRetest.attemptedAt,
        }
      : null,
    debatesAnalysed: ledger.debates,
    coachingStatus: context.status,
    degradationReasons: context.degradationReasons,
  });
}
