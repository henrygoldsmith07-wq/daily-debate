"use client";

import { useState, useRef, useEffect } from "react";
import { useSpeechRecognition } from "./useSpeechRecognition";
import { resolveMode } from "@/lib/debateModes";
import type { InputMode } from "@/lib/types";
import type { TurnTiming } from "@/lib/speechAnalysis";

export interface ComposerSubmitData {
  message: string;
  inputMode: InputMode;
  modeId: string;
  timing: TurnTiming | null;
  elapsedSeconds: number | null;
}

export default function MessageComposer({
  onSubmit,
  disabled,
  placeholder,
  modeId = "text",
  startedAtMs = null,
}: {
  onSubmit: (data: ComposerSubmitData) => void | boolean | Promise<void | boolean>;
  disabled: boolean;
  placeholder?: string;
  modeId?: string;
  startedAtMs?: number | null;
}) {
  const mode = resolveMode(modeId);
  const [text, setText] = useState("");
  const [usedVoice, setUsedVoice] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const busy = disabled || submitting;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const voiceStartedAt = useRef<number | null>(null);
  const voiceEndedAt = useRef<number | null>(null);
  const { supported, listening, transcript, interim, error: speechError, start, stop } = useSpeechRecognition({
    onEnd: () => {
      if (voiceStartedAt.current !== null && voiceEndedAt.current === null) voiceEndedAt.current = Date.now();
    },
  });
  const [responseStartedAt, setResponseStartedAt] = useState<number | null>(null);
  const effectiveResponseStartedAt = startedAtMs ?? responseStartedAt;

  // While listening, the textarea mirrors the live transcript (final + interim)
  const displayValue = listening ? (transcript + (interim ? ` ${interim}` : "")).trimStart() : text;

  useEffect(() => {
    if (!disabled && !listening) {
      textareaRef.current?.focus();
    }
  }, [disabled, listening]);

  function toggleListening() {
    if (listening) {
      setText(transcript);
      voiceEndedAt.current = Date.now();
      stop();
    } else {
      setUsedVoice(true);
      const now = Date.now();
      voiceStartedAt.current = now;
      voiceEndedAt.current = null;
      if (startedAtMs === null) setResponseStartedAt((current) => current ?? now);
      start();
    }
  }

  function buildTiming(): TurnTiming | null {
    if (!usedVoice || !voiceStartedAt.current) return null;
    const endedAtMs = voiceEndedAt.current ?? Date.now();
    return {
      startedAt: new Date(voiceStartedAt.current).toISOString(),
      endedAt: new Date(endedAtMs).toISOString(),
      durationSeconds: Math.round((endedAtMs - voiceStartedAt.current) / 1000),
    };
  }

  async function submit() {
    const trimmed = displayValue.trim();
    if (!trimmed || busy) return;
    setSubmitting(true);
    try {
      const accepted = await onSubmit({
        message: trimmed,
        inputMode: usedVoice ? "voice" : "text",
        modeId,
        timing: usedVoice ? buildTiming() : null,
        elapsedSeconds: effectiveResponseStartedAt === null
          ? null
          : Math.max(0, Math.round((Date.now() - effectiveResponseStartedAt) / 1000)),
      });
      // Preserve the user's draft when the parent reports a failed request.
      // Losing a response because Wi-Fi dropped is much worse than making the
      // user explicitly retry it.
      if (accepted === false) return;
      setText("");
      setUsedVoice(false);
      voiceStartedAt.current = null;
      voiceEndedAt.current = null;
      setResponseStartedAt(null);
      setElapsedSecs(0);
    } finally {
      setSubmitting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  }

  // Timed modes measure the whole response window, not only microphone time.
  const [elapsedSecs, setElapsedSecs] = useState(0);
  useEffect(() => {
    if (effectiveResponseStartedAt === null || (mode.hardTimeLimitSecs === null && !listening)) return;
    const tick = () => setElapsedSecs(Math.floor((Date.now() - effectiveResponseStartedAt) / 1000));
    const initial = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => { clearTimeout(initial); clearInterval(t); };
  }, [effectiveResponseStartedAt, mode.hardTimeLimitSecs, listening]);

  const isTimed = mode.hardTimeLimitSecs !== null;
  const timeRemaining = (isTimed && mode.hardTimeLimitSecs !== null)
    ? Math.max(0, mode.hardTimeLimitSecs - elapsedSecs)
    : null;
  const timeUrgent = timeRemaining !== null && timeRemaining < 15;
  const timeExpired = timeRemaining === 0;

  return (
    <div className="flex flex-col gap-2 border-t border-[var(--rule)] pt-4">
      {/* Mode badge */}
      <div className="flex items-center gap-2">
        <span
          className="rounded-full px-2 py-0.5 text-xs font-medium"
          style={{ background: `${mode.accent}18`, color: mode.accent }}
        >
          {mode.label}
        </span>
        {isTimed && (
          <span className={`tabular text-xs font-medium ${timeUrgent ? "text-[var(--bad)]" : "text-ink3"}`}>
            ⏱ {timeRemaining}s remaining
          </span>
        )}
        {!isTimed && listening && (
          <span className="tabular text-xs text-ink3">{elapsedSecs}s</span>
        )}
      </div>

      <textarea
        ref={textareaRef}
        value={displayValue}
        onChange={(e) => {
          if (startedAtMs === null) setResponseStartedAt((current) => current ?? Date.now());
          setText(e.target.value);
          setUsedVoice(false);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? "Make your case… (Ctrl/⌘+Enter to send)"}
        rows={3}
        disabled={busy || listening || timeExpired}
        aria-label="Your debate response"
        className="w-full resize-none rounded-lg border border-[var(--rule)] bg-transparent px-3 py-2 text-sm disabled:opacity-50"
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          {supported ? (
            <button
              type="button"
              onClick={toggleListening}
              disabled={busy || timeExpired}
              aria-pressed={listening}
              aria-label={listening ? "Stop listening" : "Start voice input"}
              className={`btn px-3 py-1.5 text-xs disabled:opacity-40 ${listening ? "border border-[var(--bad)] text-[var(--bad)]" : "btn-ghost"}`}
            >
              {listening ? `● Listening… ${elapsedSecs}s` : "🎙️ Speak instead"}
            </button>
          ) : (
            <span className="text-xs text-ink2">Voice: Chrome/Edge only — type or paste on Safari/Firefox.</span>
          )}
          {speechError ? <span className="text-xs text-[var(--bad)]" role="alert">{speechError}</span> : null}
          {listening && interim ? <span className="text-xs italic text-ink3" aria-live="polite">{interim}</span> : null}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-ink2 tabular">
            {displayValue.trim().length > 0 ? `${displayValue.trim().split(/\s+/).length} words` : ""}
          </span>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !displayValue.trim() || timeExpired}
            className="btn btn-primary px-4 py-1.5 text-sm disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
      {timeExpired ? (
        <p className="text-xs text-[var(--bad)]" role="status">
          Time expired for {mode.label}. Switch to another mode to continue this round.
        </p>
      ) : null}
    </div>
  );
}
