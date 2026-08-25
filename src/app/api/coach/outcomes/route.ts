import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { buildLedgerForUser } from "@/lib/skillLedgerServer";
import { movementAround, DIMENSION_LABELS } from "@/lib/adaptiveCoach";
import type { CoachDimension } from "@/lib/adaptiveCoach";

// Drill-outcome ledger: fills in `movement` for attempted assignments once
// subsequent debates exist, and reports which dimensions are actually
// improving under training. The recommendation engine reads this to stop
// suggesting drills that don't work for this user.

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = createServiceClient();
  const [{ data: assignments }, ledgerPack] = await Promise.all([
    service
      .from("drill_assignments")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "attempted")
      .order("created_at", { ascending: false })
      .limit(30),
    buildLedgerForUser(user.id),
  ]);

  const outcomes = [];
  let improved = 0;
  let measured = 0;

  for (const a of assignments ?? []) {
    const dim = a.dimension as CoachDimension;
    const m = movementAround(ledgerPack.points, dim, a.created_at);
    if (m && m.delta !== null) {
      // Persist so the recommendation engine can exclude non-producers.
      await service.from("drill_assignments").update({ movement: m.delta }).eq("id", a.id);
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
            : `${improved}/${measured} drills produced skill movement.`,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
