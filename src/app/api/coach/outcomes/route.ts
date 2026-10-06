import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/backend/server";
import { movementAround, DIMENSION_LABELS, COACH_DIMENSIONS } from "@/lib/adaptiveCoach";
import type { CoachDimension } from "@/lib/adaptiveCoach";
import { loadCoachingContext } from "@/lib/coachingContextServer";
import { getCurrentUser } from "@/lib/currentViewer";

// Read-only drill-outcome report. Movement is derived from later debates on
// demand; GET never writes the derived value back into coaching history. The
// recommendation engine consumes the same calculation through coaching context.

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = createServiceClient();
  const [assignmentResult, context] = await Promise.all([
    service
      .from("drill_assignments")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "attempted")
      .order("created_at", { ascending: false })
      .limit(30),
    loadCoachingContext(user.id),
  ]);
  if (assignmentResult.error) {
    return NextResponse.json({ error: "Drill outcomes are temporarily unavailable." }, { status: 503 });
  }
  if (!context.ledger) {
    return NextResponse.json(
      { error: "Coaching context is temporarily unavailable.", degradationReasons: context.degradationReasons },
      { status: 503 },
    );
  }
  const assignments = assignmentResult.data;
  const ledgerPack = context.ledger;
  const validDimensions = new Set<string>(COACH_DIMENSIONS);

  const outcomes = [];
  let improved = 0;
  let measured = 0;

  for (const a of assignments ?? []) {
    if (!validDimensions.has(a.dimension)) continue;
    const dim = a.dimension as CoachDimension;
    const m = movementAround(ledgerPack.points, dim, a.created_at);
    if (m && m.delta !== null) {
      measured += 1;
      if (m.delta > 0) improved += 1;
    }
    outcomes.push({
      id: a.id,
      dimension: dim,
      label: DIMENSION_LABELS[dim] ?? dim,
      title: a.title,
      assignedDate: a.assigned_date,
      beforeScore: a.before_score,
      attemptScore: a.attempt_score,
      movement: m?.delta ?? null,
      measured: !!m,
    });
  }

  return NextResponse.json(
    {
      outcomes,
      summary: {
        attempted: (assignments ?? []).length,
        measured,
        improved,
        note:
          measured < 2
            ? "Movement is measured against your next debates — complete a few after drilling."
            : `${improved}/${measured} drills showed skill movement.`,
      },
      coachingStatus: context.status,
      degradationReasons: context.degradationReasons,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
