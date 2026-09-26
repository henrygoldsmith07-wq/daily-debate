import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/backend/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { scoreAttempt, type CoachDimension } from "@/lib/adaptiveCoach";

// Submit a formative drill attempt. A deterministic rubric value is stored
// internally for diagnostics/selection, but the learner-facing response only
// returns observable signals. Longitudinal movement is measured in later debates.

export async function POST(request: Request) {
  const limited = await checkRateLimit(request, { name: "coach-attempt", limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
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
    signals: attempt.signals,
    note: "Formative practice only — skill movement is measured against later debates.",
  });
}
