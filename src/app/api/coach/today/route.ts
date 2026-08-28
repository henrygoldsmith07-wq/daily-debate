import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/backend/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { buildLedgerForUser } from "@/lib/skillLedgerServer";
import {
  buildCoachProfile,
  selectFocus,
  todaysDrill,
} from "@/lib/adaptiveCoach";

// Today's training focus: the lowest skill dimension adjusted by movement
// (improving dimensions are deprioritised; dimensions whose previous drill
// produced negative movement are skipped). Idempotent per day — the same
// assignment row is returned on repeat calls so the coach stays deliberate.

export async function GET(request: Request) {
  const limited = await checkRateLimit(request, { name: "coach-today", limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ledger = await buildLedgerForUser(user.id);
  const service = createServiceClient();

  // Outcome-awareness: dimensions whose recent drills produced negative
  // movement stop being recommended until their skill moves again.
  const { data: past } = await service
    .from("drill_assignments")
    .select("dimension, movement")
    .eq("user_id", user.id)
    .not("movement", "is", null)
    .order("created_at", { ascending: false })
    .limit(12);
  const outcomes: Record<string, number> = {};
  for (const row of past ?? []) {
    if (outcomes[row.dimension] === undefined) outcomes[row.dimension] = Number(row.movement);
  }

  const { dims, slopes } = buildCoachProfile(ledger.points);
  const { focus, reason } = selectFocus(dims, slopes, outcomes);

  if (!focus) {
    return NextResponse.json({ profile: dims, assignment: null, reason });
  }

  const today = new Date().toISOString().slice(0, 10);
  const drill = todaysDrill(focus.key, new Date().toISOString());

  // Idempotent per (user, day): upsert keeps the same assignment all day.
  const beforeScore = focus.score;
  const { data: existing } = await service
    .from("drill_assignments")
    .select("*")
    .eq("user_id", user.id)
    .eq("assigned_date", today)
    .maybeSingle();

  let assignment;
  if (existing) {
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
    debatesAnalysed: ledger.debates,
  });
}
