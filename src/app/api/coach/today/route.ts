import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/backend/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { buildLedgerForUser } from "@/lib/skillLedgerServer";
import {
  buildCoachProfile,
  DIMENSION_LABELS,
  selectFocus,
  todaysDrill,
  type CoachDim,
} from "@/lib/adaptiveCoach";
import { latestRepairRetestAnchor } from "@/lib/repairRetestServer";
import { pendingRepairRetest } from "@/lib/repairRetest";

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

  const [ledger, repairAnchor] = await Promise.all([
    buildLedgerForUser(user.id),
    latestRepairRetestAnchor(user.id),
  ]);
  const service = createServiceClient();
  const pendingRetest = pendingRepairRetest(ledger.points, repairAnchor);

  // Outcome-awareness: dimensions whose recent drills produced negative
  // movement stop being recommended until their skill moves again.
  // `movement` arrives as a real number: numeric columns are normalised at
  // the database/client boundary (backend/sql.ts).
  const { data: past } = await service
    .from("drill_assignments")
    .select("dimension, movement")
    .eq("user_id", user.id)
    .not("movement", "is", null)
    .order("created_at", { ascending: false })
    .limit(12);
  const outcomes: Record<string, number> = {};
  for (const row of past ?? []) {
    if (outcomes[row.dimension] === undefined && typeof row.movement === "number") {
      outcomes[row.dimension] = row.movement;
    }
  }

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
    return NextResponse.json({ profile: dims, assignment: null, reason, retest: null });
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
  });
}
