import { NextResponse } from "next/server";
import { createClient } from "@/lib/backend/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { debateOpening } from "@/lib/openrouter";
import { debateOpening as anthropicOpening } from "@/lib/anthropic";
import { withProviderFallback } from "@/lib/aiFallback";
import { isValidOpening } from "@/lib/aiSchema";
import type { CoachingContextDegradationReason, DebateSide } from "@/lib/types";
import type { RepairKind } from "@/lib/argumentRepair";
import { resolveDebateFormat, type DebateFormat } from "@/lib/sprint";
import {
  assignChallengeSide,
  normaliseSoloPerformance,
  type ChallengeRule,
  type SideHistoryItem,
} from "@/lib/challengeMe";
import { pickFocusDimension } from "@/lib/coachingGoal";
import { buildLedgerForUser } from "@/lib/skillLedgerServer";
import { recordProductEventForUser } from "@/lib/productEvents";
import { successfulRepairRetestAnchors } from "@/lib/repairRetestServer";
import { isDifferentRetestContext, pendingRepairRetests } from "@/lib/repairRetest";
import { latestDrillOutcomes } from "@/lib/adaptiveCoachServer";

export async function POST(request: Request) {
  const limited = await checkRateLimit(request, { name: "solo-start", limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const topicId = typeof body?.topicId === "string" ? body.topicId : null;
  const format: DebateFormat = resolveDebateFormat(body?.format);
  if (!topicId) {
    return NextResponse.json({ error: "topicId is required." }, { status: 400 });
  }

  const { data: topic, error: topicError } = await db
    .from("daily_topics")
    .select("*")
    .eq("id", topicId)
    .single();
  if (topicError || !topic) return NextResponse.json({ error: "Topic not found." }, { status: 404 });

  // Side resolution: explicit pick, or "Challenge me" — an explainable choice
  // from the user's own history (never presented as optimised, just reasoned).
  let side: DebateSide;
  let sideReason: string | null = null;
  let sideRule: ChallengeRule | null = null;
  if (body?.side === "challenge") {
    // Fetch the actual newest debates (descending + reverse). The previous
    // ascending-limit query quietly became "oldest 20" once a user had >20.
    const { data: historyRows } = await db
      .from("solo_debates")
      .select("id, side, total_score")
      .eq("user_id", user.id)
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(8);

    const debateIds = (historyRows ?? []).map((row) => row.id);
    const answeredByDebate = new Map<string, number>();
    if (debateIds.length) {
      const { data: answeredTurns } = await db
        .from("solo_debate_turns")
        .select("debate_id, id")
        .in("debate_id", debateIds)
        .not("user_message", "is", null);
      for (const row of answeredTurns ?? []) {
        answeredByDebate.set(
          row.debate_id,
          (answeredByDebate.get(row.debate_id) ?? 0) + 1,
        );
      }
    }

    const history: SideHistoryItem[] = [...(historyRows ?? [])]
      .reverse()
      .map((row) => ({
        side: row.side as DebateSide,
        performanceScore: normaliseSoloPerformance(
          typeof row.total_score === "number" ? row.total_score : null,
          answeredByDebate.get(row.id) ?? 0,
        ),
      }));
    const assignment = assignChallengeSide(history);
    side = assignment.side;
    sideReason = assignment.reason;
    sideRule = assignment.rule;
    await recordProductEventForUser(user.id, "challenge_me_selected", { format, side, reason: assignment.rule });
  } else if (body?.side === "for" || body?.side === "against") {
    side = body.side;
  } else {
    return NextResponse.json({ error: "side must be 'for', 'against', or 'challenge'." }, { status: 400 });
  }

  // The daily goal travels with the debate: whichever dimension the coach
  // focuses on today is what the finish step will assess.
  let coachingDimension: string | null = null;
  const degradationReasons: CoachingContextDegradationReason[] = [];
  let repairRetest:
    | { repairDebateId: string; targetKind: RepairKind; attemptedAt: string }
    | null = null;

  const [ledgerResult, repairAnchorsResult] = await Promise.allSettled([
    buildLedgerForUser(user.id),
    successfulRepairRetestAnchors(user.id),
  ]);
  if (ledgerResult.status === "rejected") degradationReasons.push("skill-ledger-unavailable");
  if (repairAnchorsResult.status === "rejected") degradationReasons.push("repair-retest-unavailable");

  if (ledgerResult.status === "fulfilled") {
    const ledger = ledgerResult.value;
    let drillOutcomes = {};
    try {
      drillOutcomes = await latestDrillOutcomes(user.id, ledger.points);
    } catch {
      degradationReasons.push("drill-outcomes-unavailable");
    }
    const pendingRetest =
      repairAnchorsResult.status === "fulfilled"
        ? pendingRepairRetests(ledger.points, repairAnchorsResult.value)[0] ?? null
        : null;
    coachingDimension = pickFocusDimension(
      ledger.points,
      drillOutcomes,
      pendingRetest?.dimension ?? null,
    );
    if (pendingRetest) {
      repairRetest = isDifferentRetestContext(pendingRetest.topicId, topicId)
        ? {
            repairDebateId: pendingRetest.debateId,
            targetKind: pendingRetest.targetKind,
            attemptedAt: pendingRetest.attemptedAt,
          }
        : null;
    }
  }

  const { data: debate, error: debateError } = await db
    .from("solo_debates")
    .insert({
      user_id: user.id,
      topic_id: topicId,
      side,
      round_count: 1,
      format,
      coaching: {
        dimension: coachingDimension,
        sideReason,
        repairRetest,
        degradationReasons: degradationReasons.length ? degradationReasons : null,
      },
    })
    .select("*")
    .single();
  if (debateError || !debate) {
    console.error("Failed to create solo debate:", debateError);
    return NextResponse.json({ error: "Failed to start debate." }, { status: 500 });
  }

  await recordProductEventForUser(user.id, format === "sprint" ? "sprint_started" : "full_debate_started", {
    format,
    side,
    reason: sideRule,
    debateId: debate.id,
  });
  if (repairRetest) {
    await recordProductEventForUser(user.id, "retest_started", {
      format,
      side,
      reason: repairRetest.targetKind,
      debateId: debate.id,
    });
  }

  const aiSide: DebateSide = side === "for" ? "against" : "for";
  let aiMessage: string;
  try {
    aiMessage = await withProviderFallback(
      () => debateOpening({ topicTitle: topic.title, topicPrompt: topic.prompt, aiSide }),
      isValidOpening,
      () => anthropicOpening({ topicTitle: topic.title, topicPrompt: topic.prompt, aiSide }),
    );
  } catch (error) {
    console.error("Failed to generate opening:", error);
    // Compensating delete: an active debate with zero turns is a dead end —
    // the dashboard would keep linking it and every turn submit would fail.
    await db.from("solo_debates").delete().eq("id", debate.id);
    return NextResponse.json({ error: "Failed to generate AI opening." }, { status: 502 });
  }

  const { data: turn, error: turnError } = await db
    .from("solo_debate_turns")
    .insert({ debate_id: debate.id, round_number: 1, ai_message: aiMessage })
    .select("*")
    .single();
  if (turnError || !turn) {
    console.error("Failed to create opening turn:", turnError);
    await db.from("solo_debates").delete().eq("id", debate.id);
    return NextResponse.json({ error: "Failed to start debate." }, { status: 500 });
  }

  return NextResponse.json({ debate, turn, side, sideReason, format });
}
