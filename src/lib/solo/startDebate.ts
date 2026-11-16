import { randomUUID } from "node:crypto";
import type { BackendClient } from "@/lib/backend/client";
import { debateOpening } from "@/lib/openrouter";
import { isSpendCapError, retryAfterSecondsToReset } from "@/lib/spendCap";
import type {
  CoachingContextDegradationReason,
  CoachingRecord,
  DebateSide,
  SoloDebate,
  SoloDebateTurn,
} from "@/lib/types";
import { isRepairKind, type RepairKind } from "@/lib/argumentRepair";
import { skillsUnderTest } from "@/lib/retestDisclosure";
import type { DebateFormat } from "@/lib/sprint";
import {
  DEFAULT_DIFFICULTY,
  DEFAULT_PERSONA,
  openingDirective,
  type OpponentDifficulty,
  type OpponentPersonaId,
} from "@/lib/opponentPersona";
import type { ChallengeRule } from "@/lib/challengeMe";
import { loadChallengeAssignment } from "@/lib/solo/challengeSide";
import { pickFocus, pickFocusDimension } from "@/lib/coachingGoal";
import type { FocusSteering } from "@/lib/adaptiveCoach";
import { loadCoachingContext } from "@/lib/coachingContextServer";
import { FALLBACK_IN_MEMORY_TOPIC_ID } from "@/lib/dailyTopic";
import { parseGuestLoopSummary } from "@/lib/guestLoop";
import { guestSeededFocus, resolveFirstFocus, type FirstFocusSource } from "@/lib/guestFocus";
import type { CoachDimension } from "@/lib/adaptiveCoach";
import { repairKindToDimension } from "@/lib/repairRetest";
import { ladderLevelForRetest, ladderToDifficulty, type LadderLevel } from "@/lib/retestLadder";
import { stageToLadderOutcome } from "@/lib/weaknessLibrary";
import { loadLoopChain } from "@/lib/loopChainServer";
import { selectRecheckForStart } from "@/lib/spacedRecheck";
import { loadRecheckInputs } from "@/lib/spacedRecheckServer";

export type SoloStartSideChoice = DebateSide | "challenge";

export type SoloStartPayload = {
  debate: SoloDebate;
  turn: SoloDebateTurn;
  side: DebateSide;
  sideReason: string | null;
  format: SoloDebate["format"];
  persona: OpponentPersonaId;
  difficulty: OpponentDifficulty;
  replayed: boolean;
};

export type SoloStartServiceResult =
  | { ok: true; data: SoloStartPayload }
  | { ok: false; status: 404 | 409 | 500 | 502 | 503; error: string; code?: string; retryAfterSeconds?: number };

type ExistingStart = {
  debate: SoloDebate;
  turn: SoloDebateTurn;
};

export function isSoloStartSideChoice(value: unknown): value is SoloStartSideChoice {
  return value === "challenge" || value === "for" || value === "against";
}

function failure(
  status: 404 | 409 | 500 | 502 | 503,
  error: string,
  code?: string,
  retryAfterSeconds?: number,
): SoloStartServiceResult {
  return { ok: false, status, error, ...(code ? { code } : {}), ...(retryAfterSeconds ? { retryAfterSeconds } : {}) };
}

/**
 * The guest-seeded first focus for an account with no evidence of its own
 * (guestFocus.ts). Best effort: any read failure (including a database that
 * has not applied migration 036) degrades to "no seed", never a failed start.
 */
async function loadGuestSeededFocus(
  db: BackendClient,
  userId: string,
  excluded: readonly CoachDimension[],
): Promise<CoachDimension | null> {
  try {
    const [profileResult, completedResult] = await Promise.all([
      db.from("profiles").select("guest_context").eq("id", userId).maybeSingle(),
      db
        .from("solo_debates")
        .select("id")
        .eq("user_id", userId)
        .eq("status", "completed")
        .limit(1)
        .maybeSingle(),
    ]);
    if (profileResult.error || completedResult.error) return null;
    const guestContext = parseGuestLoopSummary(
      (profileResult.data as { guest_context?: unknown } | null)?.guest_context ?? null,
    );
    return guestSeededFocus({
      guestContext,
      hasCompletedDebate: !!completedResult.data,
      ledgerPointCount: 0,
      excluded,
    });
  } catch {
    return null;
  }
}

function existingPayload(existing: ExistingStart): SoloStartPayload {
  const coaching = (existing.debate.coaching ?? {}) as CoachingRecord;
  return {
    debate: existing.debate,
    turn: existing.turn,
    side: existing.debate.side,
    sideReason: coaching.sideReason ?? null,
    format: existing.debate.format,
    persona:
      existing.debate.persona != null
        ? (existing.debate.persona as OpponentPersonaId)
        : DEFAULT_PERSONA,
    difficulty:
      existing.debate.difficulty != null
        ? (existing.debate.difficulty as OpponentDifficulty)
        : DEFAULT_DIFFICULTY,
    replayed: true,
  };
}

export async function startSoloDebate(params: {
  db: BackendClient;
  userId: string;
  topicId: string;
  sideChoice: SoloStartSideChoice;
  format: DebateFormat;
  persona: OpponentPersonaId;
  difficulty: OpponentDifficulty;
  /** True when the learner picked the difficulty; the retest ladder never overrides it. */
  difficultyExplicit?: boolean;
  /**
   * The learner's change to the guest-seeded first focus (a coach dimension,
   * or "none"). Ignored unless the account has a guest seed and no evidence
   * of its own — see guestFocus.ts.
   */
  firstFocus?: unknown;
}): Promise<SoloStartServiceResult> {
  const { db, userId, topicId, sideChoice, format, persona, firstFocus } = params;
  let difficulty = params.difficulty;

  // The in-memory topic fallback was never persisted, so no debate can be
  // anchored to it. Answer 503 (retryable) instead of 404: the store may
  // recover on retry, and a missing-topic verdict would mislead.
  if (topicId === FALLBACK_IN_MEMORY_TOPIC_ID) {
    return failure(
      503,
      "The daily topic store is unavailable right now, so this debate cannot start. Please retry in a moment.",
      "topic-store-unavailable",
      30,
    );
  }

  const { data: topic, error: topicError } = await db
    .from("daily_topics")
    .select("*")
    .eq("id", topicId)
    .single();
  if (topicError || !topic) return failure(404, "Topic not found.");

  async function loadExistingStart(): Promise<ExistingStart | null> {
    const { data: existingDebate } = await db
      .from("solo_debates")
      .select("*")
      .eq("user_id", userId)
      .eq("topic_id", topicId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!existingDebate) return null;

    const { data: firstTurn } = await db
      .from("solo_debate_turns")
      .select("*")
      .eq("debate_id", existingDebate.id)
      .eq("round_number", 1)
      .maybeSingle();
    if (!firstTurn) return null;

    return {
      debate: existingDebate as unknown as SoloDebate,
      turn: firstTurn as unknown as SoloDebateTurn,
    };
  }

  // Lost HTTP responses and ordinary retries return the canonical durable start
  // without another provider call.
  const alreadyStarted = await loadExistingStart();
  if (alreadyStarted) return { ok: true, data: existingPayload(alreadyStarted) };

  // Only the claim owner is allowed to call the opening model. Concurrent tabs
  // therefore cannot create duplicate active debates OR duplicate provider work.
  const startToken = randomUUID();
  const { data: claimData, error: claimError } = await db.rpc("claim_solo_debate_start", {
    p_user_id: userId,
    p_topic_id: topicId,
    p_token: startToken,
    p_stale_after_seconds: 300,
  });
  if (claimError) {
    console.error("Failed to claim solo debate start:", claimError);
    return failure(500, "Failed to start debate.");
  }

  const claim = (claimData ?? {}) as { claimed?: boolean; reason?: string; debateId?: string };
  if (!claim.claimed) {
    const winner = await loadExistingStart();
    if (winner) return { ok: true, data: existingPayload(winner) };
    return failure(
      409,
      "This debate is already starting in another tab. Try again in a moment.",
      claim.reason ?? "start-in-progress",
    );
  }

  // Best-effort and never throwing: it runs on failure paths, and a throw here
  // would replace the intended retryable answer (502/503/409) with an unhandled
  // 500. The claim is also time-limited (p_stale_after_seconds), so a failed
  // release only delays a retry; it can never strand the start.
  async function releaseStartClaim() {
    try {
      const { error } = await db.rpc("release_solo_debate_start", {
        p_user_id: userId,
        p_topic_id: topicId,
        p_token: startToken,
      });
      if (error) console.error("Failed to release solo debate start claim:", error);
    } catch (releaseError) {
      console.error("Failed to release solo debate start claim:", releaseError);
    }
  }

  try {
    let side: DebateSide;
    let sideReason: string | null = null;
    let sideRule: ChallengeRule | null = null;

    if (sideChoice === "challenge") {
      // Same resolver as the home screen's pre-start reveal, so the side the
      // learner was shown is the side this debate opens on.
      const assignment = await loadChallengeAssignment({ db, userId, topicId });
      side = assignment.side;
      sideReason = assignment.reason;
      sideRule = assignment.rule;
    } else {
      side = sideChoice;
    }

    let coachingDimension: string | null = null;
    let focusSteering: FocusSteering | null = null;
    const degradationReasons: CoachingContextDegradationReason[] = [];
    let repairRetest:
      | { repairResultId: string; repairDebateId: string; targetKind: RepairKind; attemptedAt: string }
      | null = null;

    const context = await loadCoachingContext(userId, {
      currentTopicId: topicId,
      reconcileLegacyRetests: true,
    });
    degradationReasons.push(...context.degradationReasons);

    if (context.ledger) {
      // The retest this debate actually carries is the topic-eligible one.
      const pendingRetest = context.selectedRetest;
      // The skill that must NOT be coached in the debate is the oldest
      // PENDING retest's skill — the same rule every other surface uses
      // (retestDisclosure.ts). The two can differ when the day's motion is
      // the very topic the learner repaired: the debate then cannot carry that
      // test, but coaching its skill would still prompt the behaviour a later
      // debate is meant to measure.
      const pickedFocus = pickFocus(
        context.ledger.points,
        context.drillOutcomes,
        skillsUnderTest(context.pendingRetests),
        context.reRepairDimensions,
        context.repairedDimensions,
      );
      coachingDimension = pickedFocus?.dimension ?? null;
      focusSteering = pickedFocus?.steering ?? null;

      if (pendingRetest) {
        const anchor = context.repairAnchors.find(
          (candidate) => candidate.repairResultId === pendingRetest.repairResultId,
        );
        if (anchor) {
          repairRetest = {
            repairResultId: pendingRetest.repairResultId,
            repairDebateId: pendingRetest.debateId,
            targetKind: pendingRetest.targetKind,
            attemptedAt: pendingRetest.attemptedAt,
          };
        } else {
          if (!degradationReasons.includes("repair-retest-unavailable")) {
            degradationReasons.push("repair-retest-unavailable");
          }
          coachingDimension = pickFocusDimension(context.ledger.points, context.drillOutcomes, [], context.reRepairDimensions, context.repairedDimensions);
          focusSteering = null;
        }
      }
    }

    // First signed-in debate after guest practice: the account has no
    // evidence of its own, so the ledger picks no focus. The guest repair
    // pre-selects one (labelled unvalidated; the learner may change it). It
    // is coaching only — the guest rep never enters the ledger, a score, a
    // retest or an improvement (guestFocus.ts).
    let focusSource: FirstFocusSource | null = null;
    if (context.ledger && context.ledger.points.length === 0 && coachingDimension === null && !repairRetest) {
      const excluded = skillsUnderTest(context.pendingRetests);
      const seeded = await loadGuestSeededFocus(db, userId, excluded);
      const resolved = resolveFirstFocus({ seeded, requested: firstFocus, excluded });
      coachingDimension = resolved.dimension;
      focusSource = resolved.source;
      focusSteering = null;
    }

    // M9 spaced re-check: a first retest always takes priority. Otherwise a
    // repair whose retest showed the skill 7-14 days ago is re-checked on
    // today's motion when that motion is fresh (never the repaired or retest
    // topic). Linked through the coaching jsonb, so no migration is needed.
    // Best-effort: a read failure never blocks the debate.
    let recheck: CoachingRecord["recheck"] = null;
    if (context.ledger && !repairRetest) {
      try {
        const inputs = await loadRecheckInputs(db, userId);
        const picked = selectRecheckForStart(inputs.repairs, inputs.debates, topicId, new Date());
        if (picked && isRepairKind(picked.targetKind)) {
          recheck = { repairResultId: picked.repairResultId, targetKind: picked.targetKind, outcome: null };
          // Same disclosure rule as a retest: do not coach the skill being measured.
          const measured = repairKindToDimension(picked.targetKind);
          if (measured && coachingDimension === measured) {
            const repick = pickFocus(
              context.ledger.points,
              context.drillOutcomes,
              [...skillsUnderTest(context.pendingRetests), measured],
              context.reRepairDimensions,
              context.repairedDimensions,
            );
            coachingDimension = repick?.dimension ?? null;
            focusSteering = repick?.steering ?? null;
          }
        }
      } catch (error) {
        console.error("Spaced re-check unavailable at start:", error);
      }
    }

    // M12: a retest on a skill with earned ladder level runs at that level
    // unless the learner chose a difficulty. Best-effort, stored in coaching jsonb.
    let ladderLevel: LadderLevel | null = null;
    if (repairRetest && !params.difficultyExplicit) {
      try {
        const chain = await loadLoopChain(userId);
        const outcomes = chain
          .filter((e) => e.targetKind === repairRetest!.targetKind)
          .sort((a, b) => Date.parse(a.repairedAt) - Date.parse(b.repairedAt))
          .map((e) => stageToLadderOutcome(e.stage))
          .filter((o): o is NonNullable<typeof o> => o !== null);
        const level = ladderLevelForRetest(outcomes);
        if (level !== "standard") {
          ladderLevel = level;
          difficulty = ladderToDifficulty(level);
        }
      } catch (error) {
        console.error("Retest ladder unavailable at start:", error);
      }
    }

    const coaching: CoachingRecord = {
      dimension: coachingDimension,
      ...(focusSource ? { focusSource } : {}),
      ...(focusSteering === "re_repair" || focusSteering === "moved_on" ? { steering: focusSteering } : {}),
      sideReason,
      repairRetest,
      ...(recheck ? { recheck } : {}),
      ...(ladderLevel ? { ladderLevel } : {}),
      degradationReasons: degradationReasons.length ? degradationReasons : null,
    };

    const aiSide: DebateSide = side === "for" ? "against" : "for";
    let aiMessage: string;
    try {
      aiMessage = await debateOpening({
        topicTitle: topic.title,
        topicPrompt: topic.prompt,
        aiSide,
        directive: openingDirective(persona, difficulty, format),
      });
    } catch (error) {
      console.error("Failed to generate opening:", error);
      await releaseStartClaim();
      // Daily spend cap: explicit and retryable — no debate was created.
      if (isSpendCapError(error)) {
        return failure(503, `${error.message} Try again after the daily reset.`, "spend_cap_reached", retryAfterSecondsToReset());
      }
      return failure(502, "Failed to generate AI opening.");
    }

    const { data: completedData, error: completeError } = await db.rpc("complete_solo_debate_start", {
      p_user_id: userId,
      p_topic_id: topicId,
      p_token: startToken,
      p_side: side,
      p_format: format,
      p_persona: persona,
      p_difficulty: difficulty,
      p_coaching: JSON.stringify(coaching),
      p_ai_message: aiMessage,
      p_side_rule: sideRule,
      p_repair_result_id: repairRetest?.repairResultId ?? null,
      p_repair_debate_id: repairRetest?.repairDebateId ?? null,
      p_target_kind: repairRetest?.targetKind ?? null,
    });

    if (completeError) {
      console.error("Failed atomic solo debate start:", completeError);
      await releaseStartClaim();
      return failure(500, "Failed to start debate.");
    }

    const completed = (completedData ?? {}) as {
      ok?: boolean;
      reason?: string;
      debate?: SoloDebate;
      turn?: SoloDebateTurn;
      retestAssigned?: boolean;
    };

    if (!completed.ok || !completed.debate || !completed.turn) {
      await releaseStartClaim();
      const winner = await loadExistingStart();
      if (winner) return { ok: true, data: existingPayload(winner) };
      return failure(
        409,
        "Failed to establish the debate start. Try again.",
        completed.reason ?? "start-commit-failed",
      );
    }

    const persistedCoaching = (completed.debate.coaching ?? {}) as CoachingRecord;
    return {
      ok: true,
      data: {
        debate: completed.debate,
        turn: completed.turn,
        side: completed.debate.side,
        sideReason: persistedCoaching.sideReason ?? null,
        format: completed.debate.format,
        persona:
          completed.debate.persona != null
            ? (completed.debate.persona as OpponentPersonaId)
            : persona,
        difficulty:
          completed.debate.difficulty != null
            ? (completed.debate.difficulty as OpponentDifficulty)
            : difficulty,
        replayed: completed.reason === "existing-debate",
      },
    };
  } catch (error) {
    console.error("Unexpected solo debate start failure:", error);
    await releaseStartClaim();
    return failure(500, "Failed to start debate.");
  }
}
