import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { scoreAttempt, type CoachDimension } from "@/lib/adaptiveCoach";

// Submit a scored drill attempt: deterministic rubric scoring is stored on
// the assignment row; the ledger later fills `movement` once subsequent
// debates exist. Drills whose movement stays negative stop being recommended.

export async function POST(request: Request) {
  const limited = await checkRateLimit(request, { name: "coach-attempt", limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const assignmentId = typeof body?.assignmentId === "string" ? body.assignmentId : null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!assignmentId) return NextResponse.json({ error: "assignmentId is required." }, { status: 400 });
  if (text.length < 10) return NextResponse.json({ error: "Write at least a sentence or two." }, { status: 400 });
  if (text.length > 6000) return NextResponse.json({ error: "Attempt too long." }, { status: 400 });

  const service = createServiceClient();
  const { data: assignment } = await service
    .from("drill_assignments")
    .select("id, user_id, dimension, status")
    .eq("id", assignmentId)
    .single();
  if (!assignment || assignment.user_id !== user.id) {
    return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
  }

  const attempt = scoreAttempt(assignment.dimension as CoachDimension, text);

  const { data: updated, error } = await service
    .from("drill_assignments")
    .update({
      attempt_text: text,
      attempt_score: attempt.score,
      status: "attempted",
    })
    .eq("id", assignmentId)
    .eq("user_id", user.id)
    .select("*")
    .single();
  if (error || !updated) {
    console.error("Failed to store drill attempt:", error);
    return NextResponse.json({ error: "Failed to store your attempt." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    attemptScore: attempt.score,
    signals: attempt.signals,
    note: "Skill movement will be measured against your next debates — check back after a few rounds.",
  });
}
