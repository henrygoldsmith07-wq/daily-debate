"use client";

// The solo debate room.
//
// This file only WIRES the room together. The concerns it used to hold are
// separated so each can be read and changed on its own:
//
//   useDebateSession    turns, status, submission, finish, recovery
//   useResponseWindow   server-authoritative response windows and timers
//   useDebateSpeech     optional opponent read-aloud
//   DebateLivePanel     transcript + composer while the debate is running
//   DebateResultCard    the finished story: outcome, weakness, repair
//
// Hook order is load-bearing: the session needs to be able to speak a turn and
// then time the response, so speech and timing are created before it. The
// callback below closes over `timing` and `speech`, which is why the session
// hook takes behaviour rather than reading their state directly.

import { useCallback, useRef, useState } from "react";
import { isDebateModeId, type DebateModeId } from "@/lib/debateModes";
import { minRoundsFor } from "@/lib/sprint";
import { DebateLivePanel } from "./debate/DebateLivePanel";
import { DebateResultCard } from "./debate/DebateResultCard";
import { useDebateError, useDebateSession } from "./debate/useDebateSession";
import { useDebateSpeech } from "./debate/useDebateSpeech";
import { useResponseWindow } from "./debate/useResponseWindow";
import type { DebateRoomProps, ReplayView } from "./debate/types";

export default function DebateRoom({
  debate,
  topic,
  initialTurns,
  completedResult,
}: DebateRoomProps) {
  const initialPending = initialTurns[initialTurns.length - 1];
  // The mode the server recorded for the turn awaiting the user. A staged
  // retry wins over the previously committed response mode.
  const initialMode: DebateModeId = isDebateModeId(initialPending?.staged_mode)
    ? initialPending.staged_mode
    : isDebateModeId(initialPending?.response_mode)
      ? initialPending.response_mode
      : "text";

  const [repairSucceeded, setRepairSucceeded] = useState(completedResult?.repaired ?? false);
  const repairRef = useRef<HTMLDivElement>(null);

  const errors = useDebateError();
  const speech = useDebateSpeech();
  const timing = useResponseWindow({
    debateId: debate.id,
    pendingTurnId: initialPending?.id,
    submissionSaved: !!initialPending?.staged_user_message,
    opponentSpeaking: speech.opponentSpeaking,
    setError: errors.setError,
    initialMode,
    initialPendingTurnId: initialPending?.id,
    initialSubmissionSaved: !!initialPending?.staged_user_message,
  });

  // A new opponent turn is read aloud first, and the response window opens
  // only once the read-aloud finishes: a timed mode must never be silently
  // shortened by slow speech synthesis.
  // The hook objects are rebuilt every render; the functions inside them are
  // stable, so depend on the functions rather than their containers.
  const { speakOpponentTurn } = speech;
  const { startResponseWindow } = timing;

  const announceOpponentTurn = useCallback(
    (nextTurn: { id: string; ai_message: string }, modeId: DebateModeId) => {
      speakOpponentTurn(nextTurn.ai_message, () => {
        if (modeId !== "text") void startResponseWindow(modeId, nextTurn.id);
      });
    },
    [speakOpponentTurn, startResponseWindow],
  );

  const session = useDebateSession({
    debate,
    initialTurns,
    errors,
    clearWindow: timing.clearWindow,
    announceOpponentTurn,
    getDebateMode: () => timing.debateMode,
    setDebateMode: timing.setDebateMode,
  });

  const format = debate.format === "sprint" ? "sprint" : "full";
  const minRounds = minRoundsFor(format);
  const aiSide = debate.side === "for" ? "against" : "for";
  const answeredCount = session.turns.filter((t) => t.user_message).length;
  const canFinish = answeredCount >= minRounds;
  const canFinishWithSaved = !!session.pending?.staged_user_message && answeredCount + 1 >= minRounds;
  const sideReason =
    (debate.coaching as { sideReason?: string | null } | null)?.sideReason ??
    ((debate as unknown as { side_reason?: string | null }).side_reason ?? null);
  const repairRetest = debate.coaching?.repairRetest ?? null;

  // One result shape for a freshly finished debate and for a replay, so the
  // story a learner reads is identical whichever route they arrived by.
  const view: ReplayView | null = session.result
    ? {
        totalScore: session.result.totalScore,
        performanceScore: session.result.performanceScore,
        snapshot: session.result.snapshot ?? null,
        argGraph: session.result.summary?.argGraph ?? null,
        repaired: repairSucceeded,
        bonusXP: session.result.bonusXP,
        topRewardLabel: session.result.rewardEvents?.filter((e) => e.kind !== "complete-debate")[0]?.label,
        topRewardDetail: session.result.rewardEvents?.filter((e) => e.kind !== "complete-debate")[0]?.detail,
        honestyNote: session.result.honesty?.note ?? null,
        summary: session.result.summary,
        trainingSummary: session.result.trainingSummary,
        summarySource: session.result.summarySource,
        fresh: true,
      }
    : debate.status === "completed" && completedResult
      ? {
          totalScore: completedResult.totalScore,
          performanceScore: completedResult.performanceScore,
          snapshot: completedResult.snapshot ?? null,
          argGraph: completedResult.argGraph ?? null,
          repaired: repairSucceeded,
          bonusXP: completedResult.bonusXP,
          topRewardLabel: completedResult.rewardEvents?.filter((e) => e.kind !== "complete-debate")[0]?.label,
          topRewardDetail: completedResult.rewardEvents?.filter((e) => e.kind !== "complete-debate")[0]?.detail,
          honestyNote: completedResult.honestyNote ?? null,
          summary: completedResult.summary,
          trainingSummary: completedResult.trainingSummary,
          summarySource: completedResult.summarySource,
        }
      : null;

  if (view) {
    return (
      <DebateResultCard
        view={view}
        format={format}
        debateId={debate.id}
        repairRetest={repairRetest}
        completedRepaired={!!completedResult?.repaired}
        freshResult={session.result}
        repairRef={repairRef}
        onRepairSucceeded={() => setRepairSucceeded(true)}
      />
    );
  }

  return (
    <DebateLivePanel
      debate={debate}
      topic={topic}
      session={session}
      timing={timing}
      opponentSpeaking={speech.opponentSpeaking}
      minRounds={minRounds}
      aiSide={aiSide}
      sideReason={sideReason}
      canFinish={canFinish}
      canFinishWithSaved={canFinishWithSaved}
      error={errors.error}
    />
  );
}

export type { CompletedResultView, DebateRoomProps } from "./debate/types";
