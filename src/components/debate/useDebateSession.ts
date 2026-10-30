"use client";

// Solo debate session state: turns, submission, finish, recovery.
//
// Everything here that touches the network, and nothing about presentation or
// timing. The response clock and speech live in their own hooks; this hook
// calls back into them so a new opponent turn is spoken and only THEN timed.
//
// Reliability rules it is responsible for:
//   - a submission that reaches the server but whose opponent generation fails
//     comes back as submissionSaved: the staged text is adopted locally so the
//     user can resume instead of retyping, and the condition stays visible;
//   - the final round creates no next turn, so the room switches to "finish the
//     debate" instead of waiting for a reply that will never come;
//   - finishing sends the staged turn id explicitly so a concurrent turn
//     cannot be finalised by mistake;
//   - a failure never silently reverts the UI to a state the server never
//     reached - it surfaces a message;
//   - the opponent reply is streamed when the server can: the text renders as
//     it is written, but the turn only joins the transcript from the route's
//     final persisted result. A stream that is cut before that result falls
//     back to one plain JSON request for the same submission, which the route
//     answers idempotently (committed round replayed, or response saved), so
//     a dropped connection never loses the learner's turn;
//   - leaving the room aborts the in-flight request without touching state.

import type { FinishPreview } from "@/lib/solo/finishPreview";
import { useEffect, useRef, useState } from "react";
import { readTurnResponse, TURN_STREAM_ACCEPT, type TurnOutcome } from "@/lib/turnStreamClient";
import type { ComposerSubmitData } from "../MessageComposer";
import { isDebateModeId, type DebateModeId } from "@/lib/debateModes";
import type { SoloDebate, SoloDebateTurn } from "@/lib/types";
import type { LiveCoachingHint } from "@/lib/liveCoaching";
import type { DebateSummaryPayload } from "./types";

export interface DebateErrorState {
  error: string | null;
  setError: (message: string | null) => void;
}

/**
 * One error surface for the whole room.
 *
 * Submission and timer failures share a single message slot, so a successful
 * action always clears the previous problem whichever action it was.
 */
export function useDebateError(): DebateErrorState {
  const [error, setError] = useState<string | null>(null);
  return { error, setError };
}

export interface DebateSessionOptions {
  debate: SoloDebate;
  initialTurns: SoloDebateTurn[];
  errors: DebateErrorState;
  /** Clear the server-issued window once the current turn is answered. */
  clearWindow: () => void;
  /**
   * Announce a new opponent turn: read it aloud if speech is available, and
   * only then start the response window so a slow read-aloud cannot silently
   * eat the learner's thinking time.
   */
  announceOpponentTurn: (nextTurn: SoloDebateTurn, modeId: DebateModeId) => void;
  /** The mode currently selected, used as the fallback for a staged retry. */
  getDebateMode: () => DebateModeId;
  setDebateMode: (modeId: DebateModeId) => void;
}

export interface DebateSession {
  turns: SoloDebateTurn[];
  pending: SoloDebateTurn | undefined;
  roundCount: number;
  status: SoloDebate["status"];
  sending: boolean;
  finishing: boolean;
  /** Deterministic weakness shown while the full result is still generating. */
  preview: FinishPreview | null;
  result: DebateSummaryPayload | null;
  /** Advisory mid-debate hints for the NEXT round, from the last submitted turn. */
  liveHints: LiveCoachingHint[];
  /** The submitted response once the server has staged it, while the reply is generated. */
  pendingUserMessage: string | null;
  /** The opponent reply streamed so far; null before the first text arrives. */
  streamingReply: string | null;
  submitTurn: (data: ComposerSubmitData) => Promise<boolean>;
  finishDebate: (finishSavedResponse?: boolean) => Promise<void>;
}

export function useDebateSession(opts: DebateSessionOptions): DebateSession {
  const {
    debate,
    initialTurns,
    errors,
    clearWindow,
    announceOpponentTurn,
    getDebateMode,
    setDebateMode,
  } = opts;
  const { setError } = errors;
  const [turns, setTurns] = useState<SoloDebateTurn[]>(initialTurns);
  const [roundCount, setRoundCount] = useState(debate.round_count);
  const [status, setStatus] = useState<SoloDebate["status"]>(debate.status);
  const [sending, setSending] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [preview, setPreview] = useState<FinishPreview | null>(null);
  const [result, setResult] = useState<DebateSummaryPayload | null>(null);
  // Real-time coaching: hints computed server-side from the just-submitted
  // turn's observable evidence, shown for the NEXT round and cleared on submit.
  const [liveHints, setLiveHints] = useState<LiveCoachingHint[]>([]);
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(null);
  const [streamingReply, setStreamingReply] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  // Navigation away aborts the request. The server keeps generating and
  // persists the turn; coming back loads the committed round.
  useEffect(() => () => inFlight.current?.abort(), []);

  const pending = turns[turns.length - 1];

  const submitTurn = async (data: ComposerSubmitData): Promise<boolean> => {
    setSending(true);
    setError(null);
    setLiveHints([]);
    setStreamingReply(null);
    setPendingUserMessage(null);
    const controller = new AbortController();
    inFlight.current?.abort();
    inFlight.current = controller;
    const url = `/api/solo/${debate.id}/turn`;
    const payload = JSON.stringify({
      expectedTurnId: pending?.id ?? "",
      message: data.message,
      inputMode: data.inputMode,
      modeId: data.modeId,
      timing: data.timing,
      elapsedSeconds: data.elapsedSeconds,
    });
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: TURN_STREAM_ACCEPT },
        body: payload,
        signal: controller.signal,
      });
      let outcome: TurnOutcome | null = await readTurnResponse(
        res,
        {
          onStart: () => setPendingUserMessage(data.message),
          onDelta: (text) => setStreamingReply((prev) => (prev ?? "") + text),
          onReset: () => setStreamingReply(null),
        },
        controller.signal,
      );
      if (!outcome) {
        // The stream was cut before its persisted result. Ask again without
        // streaming: the same submission is idempotent server-side.
        setStreamingReply(null);
        const retry = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          signal: controller.signal,
        });
        outcome = await readTurnResponse(retry, {}, controller.signal);
      }
      const ok = !!outcome && outcome.status >= 200 && outcome.status < 300;
      // Same loosely typed route payload `res.json()` gave before streaming;
      // every field is checked where it is read below.
      const resData: Awaited<ReturnType<Response["json"]>> = outcome?.body ?? {};
      if (!ok && resData.submissionSaved) {
        // The response is durable on the server but opponent generation
        // failed. Adopt the staged text so the user can resume rather than
        // retype, and say plainly what happened.
        const savedMode = isDebateModeId(resData.stagedMode)
          ? resData.stagedMode
          : isDebateModeId(data.modeId)
            ? data.modeId
            : getDebateMode();
        setDebateMode(savedMode);
        clearWindow();
        setTurns((prev) => {
          if (!prev.length) return prev;
          const latest = prev[prev.length - 1];
          return [
            ...prev.slice(0, -1),
            {
              ...latest,
              staged_user_message:
                typeof resData.stagedMessage === "string" ? resData.stagedMessage : data.message,
              staged_input_mode: data.inputMode,
              staged_mode: savedMode,
              staged_training_meta: resData.trainingMeta ?? latest.staged_training_meta ?? null,
            },
          ];
        });
        setError(resData.error || "Your response is saved. Retry to continue opponent generation.");
        return false;
      }
      if (!ok) throw new Error(resData.error || "Failed to submit response.");

      // Final round: no next turn is created - the room switches to its
      // "finish the debate" state instead of waiting for a reply that will
      // never come.
      setTurns((prev) =>
        resData.nextTurn
          ? [...prev.slice(0, -1), resData.completedTurn, resData.nextTurn]
          : [...prev.slice(0, -1), resData.completedTurn],
      );
      setRoundCount(resData.roundCount);
      if (Array.isArray(resData.liveCoaching)) setLiveHints(resData.liveCoaching);
      // The window is cleared and the new opponent turn announced whenever one
      // exists, regardless of mode: in text mode `announceOpponentTurn` is a
      // no-op that only reads aloud, so there is nothing extra to branch on.
      // (The previous if/else had two identical bodies.)
      clearWindow();
      if (resData.nextTurn) announceOpponentTurn(resData.nextTurn, data.modeId as DebateModeId);
      return true;
    } catch (err) {
      // Leaving the room is not an error the learner needs to read.
      if (controller.signal.aborted) return false;
      setError(err instanceof Error ? err.message : "Failed to submit response.");
      return false;
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
      setSending(false);
      setStreamingReply(null);
      setPendingUserMessage(null);
    }
  };

  const finishDebate = async (finishSavedResponse = false): Promise<void> => {
    setFinishing(true);
    setError(null);
    if (!finishSavedResponse) {
      void fetch(`/api/solo/${debate.id}/preview`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setPreview((d?.preview as FinishPreview | null) ?? null))
        .catch(() => undefined);
    }
    try {
      const res = await fetch(`/api/solo/${debate.id}/finish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          finishSavedResponse,
          // Send the staged turn explicitly so a concurrent turn cannot be
          // finalised by mistake.
          expectedTurnId: finishSavedResponse ? pending?.id ?? "" : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to finish debate.");
      setStatus("completed");
      setResult(data as DebateSummaryPayload);
      setPreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to finish debate.");
    } finally {
      setFinishing(false);
    }
  };

  return {
    turns,
    pending,
    roundCount,
    status,
    sending,
    finishing,
    preview,
    result,
    liveHints,
    pendingUserMessage,
    streamingReply,
    submitTurn,
    finishDebate,
  };
}
