"use client";

// The live debate: transcript, response composer and finish action.
//
// Presentation only. All state and network work arrives through `session`
// and `timing`, so this file is about what the user sees and what they can do
// next - never about when something is persisted.

import { useEffect, useRef, useState } from "react";
import MessageComposer from "../MessageComposer";
import RoundProgress from "../RoundProgress";
import ThinkingIndicator from "../ThinkingIndicator";
import { MAX_ROUNDS, type SoloDebate } from "@/lib/types";
import type { DebateModeId } from "@/lib/debateModes";
import { roundCapFor } from "@/lib/sprint";
import { OPPONENT_PERSONAS } from "@/lib/opponentPersona";
import type { DebateSession } from "./useDebateSession";
import type { ResponseWindow } from "./useResponseWindow";

export interface DebateLivePanelProps {
  debate: SoloDebate;
  topic: { title: string; prompt: string };
  session: DebateSession;
  timing: ResponseWindow;
  opponentSpeaking: boolean;
  /** Minimum answered rounds required before the debate can be finished. */
  minRounds: number;
  /** The side the opponent is arguing. */
  aiSide: string;
  /** Why this side was assigned; shown before the debate starts. */
  sideReason: string | null;
  canFinish: boolean;
  canFinishWithSaved: boolean;
  error: string | null;
}

export function DebateLivePanel({
  debate,
  topic,
  session,
  timing,
  opponentSpeaking,
  minRounds,
  aiSide,
  sideReason,
  canFinish,
  canFinishWithSaved,
  error,
}: DebateLivePanelProps) {
  const { turns, pending, roundCount, status, sending, finishing, submitTurn, finishDebate, liveHints } = session;
  const { debateMode, modeStartedAt, modeWindowStarting, waitingForModeWindow, chooseMode } = timing;
  const [showAdvancedModes, setShowAdvancedModes] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);
  const answeredCount = turns.filter((t) => t.user_message).length;
  const submissionSaved = !!pending?.staged_user_message;
  // Adversary controls: show the persona label when a non-default opponent
  // persona is attached to the debate (difficulty changes pressure, not voice).
  const personaLabel =
    debate.persona && debate.persona !== "balanced" ? OPPONENT_PERSONAS[debate.persona]?.label : null;
  // Fixed-length formats cap at their round count (sprint 3, flash 1,
  // cross-examination/socratic 4); full debates cap at 12. Both keep the cap
  // itself playable: the API deliberately creates no round beyond it.
  const composerVisible =
    status === "active" && !pending?.user_message && roundCount <= roundCapFor(debate.format);

  useEffect(() => {
    // Follow new messages only while the reader is already near the bottom;
    // scrolling up to re-read history must not be yanked forward.
    if (scrollRef.current && pinnedToBottom.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns, sending]);
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div>
        {/* The debate room is the core screen, so it carries the page's h1.
            It was previously a <p>, which left the single most important screen
            with no document heading at all — a WCAG 1.3.1/2.4.6 failure and the
            reason a screen-reader user could not orient themselves here. */}
        <h1 className="text-sm font-medium text-ink2">{topic.title}</h1>
        <p className="text-sm text-ink3">{topic.prompt}</p>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink3">
          You&apos;re arguing <span className="text-[var(--foreground)]">{debate.side}</span> · AI argues {aiSide}
          {personaLabel && <span className="text-[var(--accent)]"> · {personaLabel}</span>}
        </p>
        <RoundProgress answered={answeredCount} />
      </div>
      {sideReason && (
        <p className="rounded-lg border border-[var(--rule)] bg-surface-2 px-3 py-2 text-xs leading-5 text-ink2" data-testid="challenge-reason">
          <span className="font-semibold text-ink">Challenge selected: {debate.side === "for" ? "For" : "Against"}.</span>{" "}
          {sideReason}
        </p>
      )}
      <div className="flex items-center justify-between">
        <p className="tabular text-sm text-ink3" data-testid="round-status">
          Round {roundCount} {roundCount < minRounds && `· ${minRounds - roundCount + 1} to go`}
        </p>
      </div>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="surface-card flex flex-1 flex-col gap-4 overflow-y-auto p-4"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {turns.map((turn) => (
          <div key={turn.id} className="flex flex-col gap-2">
            <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-[var(--accent-soft)] px-3 py-2 text-sm">
              {turn.ai_message}
            </div>
            {turn.user_message && (
              <div className="ml-auto flex max-w-[85%] flex-col items-end gap-1">
                <div className="rounded-2xl rounded-tr-sm bg-surface/10 px-3 py-2 text-sm">{turn.user_message}</div>
                {turn.training_meta?.modeWarnings?.length ? (
                  <p className="max-w-md text-right text-xs text-ink3">
                    {turn.training_meta.modeWarnings[0]}
                  </p>
                ) : null}
              </div>
            )}
          </div>
        ))}
        {sending && <ThinkingIndicator />}
      </div>

      {error && (
        <p className="text-sm text-[var(--bad)]" role="alert">
          {error}
        </p>
      )}

      {composerVisible && (
        <div className="flex flex-col gap-2">
          {liveHints.length > 0 && (
            <div className="flex flex-col gap-1.5" data-testid="live-coaching">
              {liveHints.map((hint) => (
                <p
                  key={hint.id}
                  className={`rounded-lg border px-3 py-2 text-xs leading-5 ${
                    hint.severity === "warning"
                      ? "border-amber-500/40 bg-amber-500/10 text-ink2"
                      : "border-[var(--rule)] bg-surface-2 text-ink3"
                  }`}
                >
                  <span className="mr-1.5 font-semibold uppercase tracking-wide text-[var(--accent)]">Coach</span>
                  {hint.message}
                </p>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Debate mode">
            {[
              { id: "text", label: "📝 Text" },
              { id: "speech", label: "🎙️ Speech" },
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                disabled={opponentSpeaking || modeWindowStarting || submissionSaved}
                onClick={() => void chooseMode(m.id as DebateModeId)}
                aria-pressed={debateMode === m.id}
                className={`btn px-3 py-1.5 text-xs disabled:opacity-40 ${debateMode === m.id ? "border-[var(--accent)] text-[var(--accent)] font-semibold" : "btn-ghost"}`}
              >
                {m.label}
              </button>
            ))}
            <button
              type="button"
              disabled={opponentSpeaking || modeWindowStarting || submissionSaved}
              onClick={() => setShowAdvancedModes((visible) => !visible)}
              aria-expanded={showAdvancedModes}
              className="btn btn-ghost px-3 py-1.5 text-xs disabled:opacity-40"
            >
              {showAdvancedModes ? "Fewer modes" : "More modes"}
            </button>
            {showAdvancedModes && (
              <>
                {[
                  { id: "rapid-rebuttal", label: "⚡ Rapid (60s)" },
                  { id: "prepared-speech", label: "📋 Prepared (5min)" },
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    disabled={opponentSpeaking || modeWindowStarting || submissionSaved}
                    onClick={() => void chooseMode(m.id as DebateModeId)}
                    aria-pressed={debateMode === m.id}
                    className={`btn px-3 py-1.5 text-xs disabled:opacity-40 ${debateMode === m.id ? "border-[var(--accent)] text-[var(--accent)] font-semibold" : "btn-ghost"}`}
                  >
                    {m.label}
                  </button>
                ))}
              </>
            )}
          </div>
          <MessageComposer
            key={`${debateMode}-${pending?.id ?? "none"}-${submissionSaved ? "saved" : "open"}`}
            onSubmit={submitTurn}
            disabled={sending || opponentSpeaking || modeWindowStarting || waitingForModeWindow}
            modeId={debateMode}
            startedAtMs={modeStartedAt}
            initialText={pending?.staged_user_message ?? ""}
            resumeSavedSubmission={submissionSaved}
          />
          {submissionSaved ? (
            <p className="text-xs text-ink3" role="status">
              Your response is saved. Send it again to resume opponent generation
              {canFinishWithSaved ? ", or finish now using this saved response" : ""}; the original response deadline no longer applies.
            </p>
          ) : opponentSpeaking ? (
            <p className="text-xs text-ink3" role="status">Opponent is speaking — your response clock starts when they finish.</p>
          ) : modeWindowStarting || waitingForModeWindow ? (
            <p className="text-xs text-ink3" role="status">Preparing the server-timed response window…</p>
          ) : null}
        </div>
      )}

      {status === "active" && !pending?.user_message && !composerVisible && (
        <p className="text-center text-sm text-ink3">
          Round limit reached ({MAX_ROUNDS}). Finish the debate to get scored.
        </p>
      )}

      {(canFinish || canFinishWithSaved) && status === "active" && (
        <button
          type="button"
          onClick={() => void finishDebate(submissionSaved)}
          disabled={finishing || sending || (submissionSaved && !canFinishWithSaved)}
          className="btn chip-elevated px-4 py-2 text-sm text-[var(--accent)] disabled:opacity-40"
          data-testid="finish-debate"
        >
          {finishing
            ? "Finishing your debate…"
            : submissionSaved
              ? "Finish with saved response"
              : "Finish debate"}
        </button>
      )}
    </div>
  );
}
