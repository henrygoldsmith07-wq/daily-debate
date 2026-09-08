import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/backend/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { assessArgumentGraph, mergeAssessmentGraphs } from "@/lib/observableAssessment";
import type { ObservableAssessment } from "@/lib/observableAssessment";
import { pickRepairTarget, scoreRepair, type RepairKind, type RepairTarget } from "@/lib/argumentRepair";
import { recordProductEvent } from "@/lib/productEvents";

const REPAIR_SUCCESS_THRESHOLD = 60;

const KIND_TO_DIMENSION: Record<RepairKind, string> = {
  evidence: "evidence",
  rebuttal: "rebuttal",
  logic: "logic",
  impact: "impact",
  structure: "structure",
  clarity: "clarity",
};

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
  const limited = await checkRateLimit(request, { name: "repair-post", limit: 20, windowMs: 60_000 });
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

  const { error: insertError } = await db.from("repair_results").insert({
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
  // targets the same dimension, the repair counts as its attempt.
  try {
    const service = createServiceClient();
    const today = new Date().toISOString().slice(0, 10);
    const dimension = KIND_TO_DIMENSION[target.kind];
    await service
      .from("drill_assignments")
      .update({
        status: "attempted",
        attempt_text: rewrite,
        attempt_score: result.score,
      })
      .eq("user_id", user.id)
      .eq("assigned_date", today)
      .eq("dimension", dimension)
      .eq("status", "open");
  } catch (error) {
    // Non-critical: the repair is already persisted.
    console.error("Failed to link repair to drill assignment:", error);
  }

  void recordProductEvent("repair_completed", {
    repairScore: result.score,
    reason: succeeded ? "succeeded" : "retry",
    debateId,
  });

  return NextResponse.json({
    target,
    score: result.score,
    signals: result.signals,
    succeeded,
    feedback: succeeded
      ? `Recorded. The rewrite now ${result.signals[0] ?? "addresses the weak link"} — your next debate will test whether it sticks.`
      : "Recorded — not there yet. Check the signals below and try another version.",
  });
}
