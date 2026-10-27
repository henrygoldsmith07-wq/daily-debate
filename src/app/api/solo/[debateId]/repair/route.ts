import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/backend/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { assessArgumentGraph, mergeAssessmentGraphs } from "@/lib/observableAssessment";
import type { ObservableAssessment } from "@/lib/observableAssessment";
import { pickRepairTarget, scoreRepair, type RepairTarget } from "@/lib/argumentRepair";
import { recordProductEventForUser } from "@/lib/productEvents";
import { REPAIR_KIND_TO_DIMENSION } from "@/lib/repairRetest";
import { dateKeyInTimeZone, normalizeIanaTimeZone } from "@/lib/timeZone";

const REPAIR_SUCCESS_THRESHOLD = 60;

/** Merge the debate's per-turn graphs into the final assessment. */
async function finalAssessmentFor(db: Awaited<ReturnType<typeof createClient>>, debateId: string) {
  const { data: turns } = await db
    .from("solo_debate_turns")
    .select("assessment")
    .eq("debate_id", debateId)
    .not("assessment", "is", null)
    .order("round_number", { ascending: true });
  const assessments = ((turns ?? []) as Array<{ assessment: unknown }>)
    .map((t) => t.assessment as ObservableAssessment)
    .filter((a) => !!a?.graph);
  if (!assessments.length) return null;
  return assessArgumentGraph(
    mergeAssessmentGraphs(assessments.map((a) => a.graph)),
    { sideA: "a", sideB: "ai", extractionSource: "deterministic", labelA: "You", labelB: "AI opponent" },
  );
}

/** GET: the one repair target for this debate (server-picked, consequential). */
export async function GET(request: Request, { params }: { params: Promise<{ debateId: string }> }) {
  const limited = await checkRateLimit(request, { name: "repair-get", limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const { debateId } = await params;
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: debate } = await db
    .from("solo_debates")
    .select("id, status")
    .eq("id", debateId)
    .eq("user_id", user.id)
    .single();
  if (!debate) return NextResponse.json({ error: "Debate not found." }, { status: 404 });
  if (debate.status !== "completed") {
    return NextResponse.json({ error: "Finish the debate before repairing it." }, { status: 409 });
  }

  const assessment = await finalAssessmentFor(db, debateId);
  const target = assessment ? pickRepairTarget(assessment.graph) : null;
  if (!target) return NextResponse.json({ target: null });
  return NextResponse.json({ target });
}

/**
 * POST: score the rewrite server-side, persist the repair outcome, and feed it
 * into the coaching system. The debate's own score is never changed — the
 * repair is deliberate practice, not a re-judgement.
 */
export async function POST(request: Request, { params }: { params: Promise<{ debateId: string }> }) {
  const limited = await checkRateLimit(request, { name: "repair-post", limit: 20, windowMs: 60_000, failClosed: true });
  if (limited) return limited;

  const { debateId } = await params;
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const rewrite = typeof body?.rewrite === "string" ? body.rewrite.trim() : "";
  if (!rewrite) return NextResponse.json({ error: "rewrite is required." }, { status: 400 });
  if (rewrite.length > 2000) {
    return NextResponse.json({ error: "Keep the rewrite under 2,000 characters." }, { status: 400 });
  }

  const { data: debate } = await db
    .from("solo_debates")
    .select("id, status")
    .eq("id", debateId)
    .eq("user_id", user.id)
    .single();
  if (!debate) return NextResponse.json({ error: "Debate not found." }, { status: 404 });
  if (debate.status !== "completed") {
    return NextResponse.json({ error: "Finish the debate before repairing it." }, { status: 409 });
  }

  const assessment = await finalAssessmentFor(db, debateId);
  const target: RepairTarget | null = assessment ? pickRepairTarget(assessment.graph) : null;
  if (!target) return NextResponse.json({ error: "No repair target found for this debate." }, { status: 404 });

  const result = scoreRepair(target, rewrite);
  const succeeded = result.score >= REPAIR_SUCCESS_THRESHOLD;

  const { data: priorSuccess } = await db
    .from("repair_results")
    .select("id")
    .eq("user_id", user.id)
    .eq("debate_id", debateId)
    .eq("target_kind", target.kind)
    .eq("succeeded", true)
    .limit(1)
    .maybeSingle();

  // A double-click, a network retry or a re-sent request carries the same
  // rewrite. Persisting it again would inflate repair counts and the repair
  // funnel, so an identical stored rewrite for this debate and target is
  // answered from the stored row: nothing new is written or emitted.
  const { data: duplicate } = await db
    .from("repair_results")
    .select("id")
    .eq("user_id", user.id)
    .eq("debate_id", debateId)
    .eq("target_kind", target.kind)
    .eq("rewrite_text", rewrite)
    .limit(1)
    .maybeSingle();

  const { error: insertError } = duplicate ? { error: null } : await db.from("repair_results").insert({
    user_id: user.id,
    debate_id: debateId,
    target_kind: target.kind,
    source_node_id: target.sourceNodeId ?? null,
    source_text: target.sourceText,
    rewrite_text: rewrite,
    score: result.score,
    succeeded,
    signals: result.signals,
  });
  if (insertError) {
    console.error("Failed to persist repair result:", insertError);
    return NextResponse.json({ error: "Failed to save the repair." }, { status: 500 });
  }

  // Link the repair into the coaching system: if today's drill assignment
  // targets the same dimension, the latest submitted rewrite becomes the
  // assignment's formative attempt. Do this for retries too — otherwise a
  // better second draft is persisted in repair_results while coaching remains
  // stuck on the first draft. We deliberately do NOT compare the two scores:
  // repair and drill rubrics are formative signals, not a shared skill scale.
  try {
    const service = createServiceClient();
    // Drill assignments are keyed by the learner's LOCAL training day
    // (coach/today uses dateKeyInTimeZone). A UTC date here matched no row
    // whenever local and UTC dates differ — US evenings, Asia/Pacific
    // mornings — so the repair silently never counted as that day's attempt.
    const { data: profile } = await service.from("profiles").select("timezone").eq("id", user.id).maybeSingle();
    const today = dateKeyInTimeZone(normalizeIanaTimeZone(profile?.timezone));
    const dimension = REPAIR_KIND_TO_DIMENSION[target.kind];
    // Never replace the learner's own drill attempt with a repair rewrite:
    // they are different artifacts scored on different rubrics. A repair may
    // only (re)write the attempt when the slot is empty or when the stored
    // attempt is itself an earlier repair rewrite from this debate.
    const { data: assignment } = await service
      .from("drill_assignments")
      .select("id, attempt_text")
      .eq("user_id", user.id)
      .eq("assigned_date", today)
      .eq("dimension", dimension)
      .maybeSingle();
    const existing = typeof assignment?.attempt_text === "string" ? assignment.attempt_text : "";
    let ownedByRepair = !existing;
    if (existing && existing !== rewrite) {
      const { data: earlier } = await db
        .from("repair_results")
        .select("id")
        .eq("user_id", user.id)
        .eq("debate_id", debateId)
        .eq("rewrite_text", existing)
        .limit(1)
        .maybeSingle();
      ownedByRepair = !!earlier;
    } else if (existing) {
      ownedByRepair = true;
    }
    if (assignment && ownedByRepair) {
      await service
        .from("drill_assignments")
        .update({
          status: "attempted",
          attempt_text: rewrite,
          attempt_score: result.score,
        })
        .eq("id", assignment.id);
    }
  } catch (error) {
    // Non-critical: the repair is already persisted.
    console.error("Failed to link repair to drill assignment:", error);
  }

  if (!duplicate) {
    await recordProductEventForUser(user.id, "repair_attempted", {
      reason: result.state,
      debateId,
    });
  }

  // A prompted rewrite demonstrating the requested structure is not a later
  // learning outcome. Give it its own event, then close the episode exactly
  // once on the first successful attempt. Legacy repair_completed remains
  // readable in analytics but is no longer emitted by new code.
  if (succeeded && !duplicate) {
    await recordProductEventForUser(user.id, "repair_demonstrated", {
      reason: target.kind,
      debateId,
    });
    if (!priorSuccess) {
      await recordProductEventForUser(user.id, "repair_episode_closed", {
        reason: target.kind,
        debateId,
      });
    }
  }

  return NextResponse.json({
    target,
    state: result.state,
    signals: result.signals,
    succeeded,
    feedback: succeeded
      ? "Recorded. You demonstrated the requested repair move in this prompted practice. Your next debate will test whether it transfers."
      : result.state === "partially_repaired"
        ? "Recorded. Part of the repair is present, but one required reasoning move is still missing."
        : "Recorded. This version still needs another pass; use the observable signals below to revise it.",
  });
}
