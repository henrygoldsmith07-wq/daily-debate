import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/backend/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { assessArgumentGraph, mergeAssessmentGraphs } from "@/lib/observableAssessment";
import type { ObservableAssessment } from "@/lib/observableAssessment";
import { isRepairKind, pickRepairTarget, repairStateFromScore, scoreRepair, type RepairTarget } from "@/lib/argumentRepair";
import { clampHelpLevel, helpLevelFromSignals, maxUnlockedLevel, tagHelpSignal, unlockedHelp, visibleSignals } from "@/lib/repairHints";
import { recordProductEventForUser } from "@/lib/productEvents";
import { REPAIR_KIND_TO_DIMENSION } from "@/lib/repairRetest";
import { dateKeyInTimeZone, normalizeIanaTimeZone } from "@/lib/timeZone";

const REPAIR_SUCCESS_THRESHOLD = 60;
const MAX_REPAIR_REQUEST_BYTES = 8_192;

class RepairReadUnavailable extends Error {}

function requireRepairRead(error: unknown) {
  if (error) throw new RepairReadUnavailable("Repair context is temporarily unavailable.");
}

type RouteContext = { params: Promise<{ debateId: string }> };

async function readRepairBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; tooLarge: boolean }> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REPAIR_REQUEST_BYTES) {
    return { ok: false, tooLarge: true };
  }
  if (!request.body) return { ok: false, tooLarge: false };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REPAIR_REQUEST_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, tooLarge: true };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, tooLarge: false };
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, body: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, tooLarge: false };
  }
}

async function withRepairReadRecovery(action: () => Promise<Response>): Promise<Response> {
  try {
    return await action();
  } catch (error) {
    if (!(error instanceof RepairReadUnavailable)) throw error;
    return NextResponse.json(
      { error: "Repair history is temporarily unavailable. Your draft has not been recorded; please retry." },
      { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "2" } },
    );
  }
}

/** Merge the debate's per-turn graphs into the final assessment. */
async function finalAssessmentFor(db: Awaited<ReturnType<typeof createClient>>, debateId: string) {
  const { data: turns, error } = await db
    .from("solo_debate_turns")
    .select("assessment")
    .eq("debate_id", debateId)
    .not("assessment", "is", null)
    .order("round_number", { ascending: true });
  requireRepairRead(error);
  const assessments = ((turns ?? []) as Array<{ assessment: unknown }>)
    .map((t) => t.assessment as ObservableAssessment)
    .filter((a) => !!a?.graph);
  if (!assessments.length) return null;
  return assessArgumentGraph(
    mergeAssessmentGraphs(assessments.map((a) => a.graph)),
    { sideA: "a", sideB: "ai", extractionSource: "deterministic", labelA: "You", labelB: "AI opponent" },
  );
}

/**
 * The target the result screen persisted at finish is the one the learner was
 * shown, so it is the one scored. Re-deriving it from turns diverges whenever
 * extraction or ranking rules change between finish and repair.
 */
function persistedRepairTarget(resultPayload: unknown): RepairTarget | null {
  const repair = (resultPayload as { snapshot?: { weakness?: { repair?: unknown } | null } | null } | null)
    ?.snapshot?.weakness?.repair;
  if (!repair || typeof repair !== "object") return null;
  const t = repair as Partial<RepairTarget>;
  if (!isRepairKind(t.kind)) return null;
  if (typeof t.sourceText !== "string" || !t.sourceText.trim()) return null;
  if (typeof t.label !== "string" || typeof t.title !== "string" || typeof t.prompt !== "string") return null;
  return t as RepairTarget;
}

/** Persisted target first; legacy debates without a snapshot re-derive it. */
async function repairTargetFor(
  db: Awaited<ReturnType<typeof createClient>>,
  debate: { id: string; result_payload?: unknown },
): Promise<RepairTarget | null> {
  const persisted = persistedRepairTarget(debate.result_payload);
  if (persisted) return persisted;
  const assessment = await finalAssessmentFor(db, debate.id);
  return assessment ? pickRepairTarget(assessment.graph) : null;
}

async function failedAttemptsFor(
  db: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  debateId: string,
  kind: string,
) {
  const { count, error } = await db
    .from("repair_results")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("debate_id", debateId)
    .eq("target_kind", kind)
    .eq("succeeded", false);
  requireRepairRead(error);
  return count ?? 0;
}

/** GET: the one repair target for this debate (server-picked, consequential). */
export async function GET(request: Request, context: RouteContext) {
  return withRepairReadRecovery(() => getRepair(request, context));
}

async function getRepair(request: Request, { params }: RouteContext) {
  const limited = await checkRateLimit(request, { name: "repair-get", limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const { debateId } = await params;
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: debate, error: debateError } = await db
    .from("solo_debates")
    .select("id, status, result_payload")
    .eq("id", debateId)
    .eq("user_id", user.id)
    .maybeSingle();
  requireRepairRead(debateError);
  if (!debate) return NextResponse.json({ error: "Debate not found." }, { status: 404 });
  if (debate.status !== "completed") {
    return NextResponse.json({ error: "Finish the debate before repairing it." }, { status: 409 });
  }

  const target = await repairTargetFor(db, debate);
  if (!target) return NextResponse.json({ target: null });
  const failedAttempts = await failedAttemptsFor(db, user.id, debateId, target.kind);
  return NextResponse.json({
    target,
    failedAttempts,
    unlockedLevel: maxUnlockedLevel(failedAttempts),
    help: unlockedHelp(target, failedAttempts),
  });
}

/**
 * POST: score the rewrite server-side, persist the repair outcome, and feed it
 * into the coaching system. The debate's own score is never changed — the
 * repair is deliberate practice, not a re-judgement.
 */
export async function POST(request: Request, context: RouteContext) {
  return withRepairReadRecovery(() => submitRepair(request, context));
}

async function submitRepair(request: Request, { params }: RouteContext) {
  const limited = await checkRateLimit(request, { name: "repair-post", limit: 20, windowMs: 60_000, failClosed: true });
  if (limited) return limited;

  const { debateId } = await params;
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsedBody = await readRepairBody(request);
  if (!parsedBody.ok && parsedBody.tooLarge) {
    return NextResponse.json({ error: "Repair request is too large." }, { status: 413 });
  }
  const body = parsedBody.ok ? parsedBody.body as { rewrite?: unknown; helpLevel?: unknown } : null;
  const rewrite = typeof body?.rewrite === "string" ? body.rewrite.trim() : "";
  if (!rewrite) return NextResponse.json({ error: "rewrite is required." }, { status: 400 });
  if (rewrite.length > 2000) {
    return NextResponse.json({ error: "Keep the rewrite under 2,000 characters." }, { status: 400 });
  }

  const { data: debate, error: debateError } = await db
    .from("solo_debates")
    .select("id, status, result_payload")
    .eq("id", debateId)
    .eq("user_id", user.id)
    .maybeSingle();
  requireRepairRead(debateError);
  if (!debate) return NextResponse.json({ error: "Debate not found." }, { status: 404 });
  if (debate.status !== "completed") {
    return NextResponse.json({ error: "Finish the debate before repairing it." }, { status: 409 });
  }

  const target = await repairTargetFor(db, debate);
  if (!target) return NextResponse.json({ error: "No repair target found for this debate." }, { status: 404 });

  const priorFailed = await failedAttemptsFor(db, user.id, debateId, target.kind);
  // A double-click, a network retry or a re-sent request carries the same
  // rewrite. Persisting it again would inflate repair counts and the repair
  // funnel, so an identical stored rewrite for this debate and target is
  // answered from the stored row: nothing new is written or emitted.
  const { data: duplicate, error: duplicateError } = await db
    .from("repair_results")
    .select("id, score, succeeded, signals")
    .eq("user_id", user.id)
    .eq("debate_id", debateId)
    .eq("target_kind", target.kind)
    .eq("rewrite_text", rewrite)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  requireRepairRead(duplicateError);
  if (duplicate) {
    const signals = Array.isArray(duplicate.signals)
      ? duplicate.signals.filter((signal): signal is string => typeof signal === "string")
      : [];
    return NextResponse.json({
      target,
      state: duplicate.succeeded ? "repair_demonstrated" : repairStateFromScore(duplicate.score),
      signals: visibleSignals(signals),
      succeeded: duplicate.succeeded,
      helpLevel: helpLevelFromSignals(signals),
      failedAttempts: priorFailed,
      unlockedLevel: maxUnlockedLevel(priorFailed),
      help: unlockedHelp(target, priorFailed),
      feedback: "Already recorded. This is the saved feedback for this version; no new attempt or drill update was made.",
    });
  }

  const { data: priorSuccess, error: priorSuccessError } = await db
    .from("repair_results")
    .select("id")
    .eq("user_id", user.id)
    .eq("debate_id", debateId)
    .eq("target_kind", target.kind)
    .eq("succeeded", true)
    .limit(1)
    .maybeSingle();

  requireRepairRead(priorSuccessError);

  const helpLevel = clampHelpLevel(body?.helpLevel, priorFailed);
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
    signals: tagHelpSignal(result.signals, helpLevel),
  });
  if (insertError) {
    console.error("Failed to persist repair result:", insertError);
    return NextResponse.json({ error: "Failed to save the repair." }, { status: 500 });
  }

  // Link the repair into the coaching system: if today's drill assignment
  // targets the same dimension, the latest submitted rewrite becomes the
  // assignment's formative attempt. A changed draft updates coaching; an
  // identical replay returns above without touching today's assignment.
  // repair and drill rubrics are formative signals, not a shared skill scale.
  try {
    const service = createServiceClient();
    // Drill assignments are keyed by the learner's LOCAL training day
    // (coach/today uses dateKeyInTimeZone). A UTC date here matched no row
    // whenever local and UTC dates differ — US evenings, Asia/Pacific
    // mornings — so the repair silently never counted as that day's attempt.
    const { data: profile, error: profileError } = await service.from("profiles").select("timezone").eq("id", user.id).maybeSingle();
    requireRepairRead(profileError);
    const today = dateKeyInTimeZone(normalizeIanaTimeZone(profile?.timezone));
    const dimension = REPAIR_KIND_TO_DIMENSION[target.kind];
    // Never replace the learner's own drill attempt with a repair rewrite:
    // they are different artifacts scored on different rubrics. A repair may
    // only (re)write the attempt when the slot is empty or when the stored
    // attempt is itself an earlier repair rewrite from this debate.
    const { data: assignment, error: assignmentError } = await service
      .from("drill_assignments")
      .select("id, attempt_text")
      .eq("user_id", user.id)
      .eq("assigned_date", today)
      .eq("dimension", dimension)
      .maybeSingle();
    requireRepairRead(assignmentError);
    const existing = typeof assignment?.attempt_text === "string" ? assignment.attempt_text : "";
    let ownedByRepair = !existing;
    if (existing && existing !== rewrite) {
      const { data: earlier, error: earlierError } = await db
        .from("repair_results")
        .select("id")
        .eq("user_id", user.id)
        .eq("debate_id", debateId)
        .eq("rewrite_text", existing)
        .limit(1)
        .maybeSingle();
      requireRepairRead(earlierError);
      ownedByRepair = !!earlier;
    } else if (existing) {
      ownedByRepair = true;
    }
    if (assignment && ownedByRepair) {
      const update = service
        .from("drill_assignments")
        .update({
          status: "attempted",
          attempt_text: rewrite,
          attempt_score: result.score,
        })
        .eq("id", assignment.id)
        .eq("user_id", user.id);
      // Only replace the exact draft we inspected; a concurrent drill attempt wins.
      if (assignment.attempt_text === null) update.is("attempt_text", null);
      else update.eq("attempt_text", assignment.attempt_text);
      const { error: updateError } = await update;
      if (updateError) throw new Error("Failed to update the linked drill assignment.");
    }
  } catch (error) {
    // Non-critical: the repair is already persisted.
    console.error("Failed to link repair to drill assignment:", error);
  }

  await recordProductEventForUser(user.id, "repair_attempted", {
    reason: result.state,
    debateId,
  });

  // A prompted rewrite demonstrating the requested structure is not a later
  // learning outcome. Give it its own event, then close the episode exactly
  // once on the first successful attempt. Legacy repair_completed remains
  // readable in analytics but is no longer emitted by new code.
  if (succeeded) {
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
    helpLevel,
    failedAttempts: succeeded ? priorFailed : priorFailed + 1,
    unlockedLevel: maxUnlockedLevel(succeeded ? priorFailed : priorFailed + 1),
    help: unlockedHelp(target, succeeded ? priorFailed : priorFailed + 1),
    feedback: succeeded
      ? "Recorded. You demonstrated the requested repair move in this prompted practice. Your next debate will test whether it transfers."
      : result.state === "partially_repaired"
        ? "Recorded. Part of the repair is present, but one required reasoning move is still missing."
        : "Recorded. This version still needs another pass; use the observable signals below to revise it.",
  });
}
