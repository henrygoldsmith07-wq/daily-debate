"use client";

// Server-authoritative response windows.
//
// The rules this hook exists to keep:
//   - the SERVER decides the window. The client never invents a duration; it
//     asks for the window and converts the authoritative remaining seconds
//     into a local countdown anchor.
//   - a mode is never shown as selected until its window has been durably
//     persisted or restored, which closes the reload race where "Rapid" could
//     appear before response_mode was saved.
//   - reloading mid-round restores the SAME window rather than silently
//     falling back to Text or restarting the clock.
//   - an expired window is not a persistence failure: the mode stays selected
//     and the user is told to switch modes.

import { useCallback, useEffect, useState } from "react";
import { DEBATE_MODES, type DebateModeId } from "@/lib/debateModes";

/**
 * Convert an authoritative remaining duration into a local countdown anchor.
 *
 * `performance.now()` is monotonic and unrelated to the DB clock, so the
 * user's wall clock can never corrupt the remaining-time reading.
 */
export function localCountdownAnchorMs(limitSeconds: number, remainingSeconds: number): number {
  return performance.now() - Math.max(0, limitSeconds - remainingSeconds) * 1000;
}

export interface DebateErrorChannel {
  setError: (message: string | null) => void;
}

export interface ResponseWindowOptions extends DebateErrorChannel {
  debateId: string;
  /** The turn currently awaiting the user, if any. */
  pendingTurnId: string | undefined;
  /** A durable staged submission blocks new windows for this turn. */
  submissionSaved: boolean;
  /** Blocks window changes while the opponent is still speaking. */
  opponentSpeaking: boolean;
  /**
   * The mode/turn as they were when the page loaded. The reload-restore effect
   * keys off these, NOT off live state: keying off `debateMode` would re-fire
   * the restore every time the user picks a mode and reset the clock they had
   * just started.
   */
  initialMode: DebateModeId;
  initialPendingTurnId: string | undefined;
  initialSubmissionSaved: boolean;
}

export interface ResponseWindow {
  debateMode: DebateModeId;
  modeStartedAt: number | null;
  modeWindowStarting: boolean;
  /** True while a timed mode is selected but its window is not yet known. */
  waitingForModeWindow: boolean;
  setDebateMode: (mode: DebateModeId) => void;
  startResponseWindow: (modeId: DebateModeId, turnId: string) => Promise<boolean>;
  chooseMode: (modeId: DebateModeId) => Promise<void>;
  clearWindow: () => void;
}

export function useResponseWindow(opts: ResponseWindowOptions): ResponseWindow {
  const {
    debateId,
    pendingTurnId,
    submissionSaved,
    opponentSpeaking,
    setError,
    initialMode,
    initialPendingTurnId,
    initialSubmissionSaved,
  } = opts;
  const [debateMode, setDebateMode] = useState<DebateModeId>(initialMode);
  const [modeStartedAt, setModeStartedAt] = useState<number | null>(null);
  const [modeWindowStarting, setModeWindowStarting] = useState(false);
  const waitingForModeWindow =
    !submissionSaved &&
    DEBATE_MODES[debateMode].hardTimeLimitSecs !== null &&
    modeStartedAt === null;

  const startResponseWindow = useCallback(
    async (modeId: DebateModeId, turnId: string): Promise<boolean> => {
      setModeWindowStarting(true);
      setError(null);
      try {
        const res = await fetch(`/api/solo/${debateId}/turn-window`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ turnId, modeId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to start response timer.");
        const limit = DEBATE_MODES[modeId].hardTimeLimitSecs;
        if (modeId === "text" || limit === null) {
          setModeStartedAt(null);
          return true;
        }
        const remaining =
          typeof data.remainingSeconds === "number" ? Math.max(0, Math.min(limit, data.remainingSeconds)) : limit;
        if (remaining <= 0) {
          setModeStartedAt(localCountdownAnchorMs(limit, 0));
          setError(`${DEBATE_MODES[modeId].label} time limit has expired. Switch modes to continue this round.`);
          // The server persisted/restored this mode successfully; it is simply
          // no longer answerable. Report success so the caller still selects
          // it and the expired state stays visible to the user.
          return true;
        }
        setModeStartedAt(localCountdownAnchorMs(limit, remaining));
        return true;
      } catch (err) {
        setModeStartedAt(null);
        setError(err instanceof Error ? err.message : "Failed to start response timer.");
        return false;
      } finally {
        setModeWindowStarting(false);
      }
    },
    [debateId, setError],
  );

  const chooseMode = useCallback(
    async (modeId: DebateModeId) => {
      if (!pendingTurnId || opponentSpeaking || modeWindowStarting || submissionSaved) return;
      // Do not expose a mode as selected until the server has durably
      // persisted (or restored) its authoritative response window.
      const persisted = await startResponseWindow(modeId, pendingTurnId);
      if (persisted) setDebateMode(modeId);
    },
    [pendingTurnId, opponentSpeaking, modeWindowStarting, submissionSaved, startResponseWindow],
  );

  // Reloading an active timed round restores the same server-issued window
  // rather than falling back to Text or resetting the clock.
  useEffect(() => {
    if (!initialPendingTurnId || initialSubmissionSaved) return;
    const limit = DEBATE_MODES[initialMode].hardTimeLimitSecs;
    if (limit === null) return;

    let cancelled = false;
    const restore = async () => {
      setModeWindowStarting(true);
      try {
        const res = await fetch(`/api/solo/${debateId}/turn-window`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ turnId: initialPendingTurnId, modeId: initialMode }),
        });
        const data = await res.json();
        if (!res.ok || cancelled) return;
        const remaining =
          typeof data.remainingSeconds === "number" ? Math.max(0, Math.min(limit, data.remainingSeconds)) : limit;
        setModeStartedAt(localCountdownAnchorMs(limit, remaining));
        if (remaining <= 0) {
          setError(`${DEBATE_MODES[initialMode].label} time limit has expired. Switch modes to continue this round.`);
        }
      } finally {
        if (!cancelled) setModeWindowStarting(false);
      }
    };
    void restore();
    return () => {
      cancelled = true;
    };
  }, [debateId, initialMode, initialPendingTurnId, initialSubmissionSaved, setError]);

  return {
    debateMode,
    modeStartedAt,
    modeWindowStarting,
    waitingForModeWindow,
    setDebateMode,
    startResponseWindow,
    chooseMode,
    clearWindow: useCallback(() => setModeStartedAt(null), []),
  };
}
