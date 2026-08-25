"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSpeechRecognition } from "./useSpeechRecognition";
import { resolveMode, DEBATE_MODE_LIST } from "@/lib/debateModes";
import type { InputMode } from "@/lib/types";
import type { TurnTiming } from "@/lib/speechAnalysis";

export interface ComposerSubmitData {
  message: string;
  inputMode: InputMode;
  modeId: string;
  timing: TurnTiming | null;
}

export default function MessageComposer({
  onSubmit,
  disabled,
  placeholder,
  modeId = "text",
}: {
  onSubmit: (data: ComposerSubmitData) => void;
  disabled: boolean;
  placeholder?: string;
  modeId?: string;
}) {
  const mode = resolveMode(modeId);
  const [text, setText] = useState("");
  const [usedVoice, setUsedVoice] = useState(false);
  const { supported, listening, transcript, interim, error: speechError, start, stop } = useSpeechRecognition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const voiceStartedAt = useRef<number | null>(null);

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
      stop();
    } else {
      setUsedVoice(true);
      voiceStartedAt.current = Date.now();
      start();
    }
  }

  function buildTiming(): TurnTiming | null {
    if (!usedVoice || !voiceStartedAt.current) return null;
    return {
      startedAt: new Date(voiceStartedAt.current).toISOString(),
      endedAt: new Date().toISOString(),
      durationSeconds: Math.round((Date.now() - voiceStartedAt.current) / 1000),
    };
  }

  function submit() {
    const trimmed = displayValue.trim();
    if (!trimmed || disabled) return;
    onSubmit({
      message: trimmed,
      inputMode: usedVoice ? "voice" : "text",
      modeId,
      timing: usedVoice ? buildTiming() : null,
    });
    setText("");
    setUsedVoice(false);
    voiceStartedAt.current = null;
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  }

  // Timer for rapid-rebuttal / prepared-speech modes
  const [elapsedSecs, setElapsedSecs] = useState(0);
  useEffect(() => {
    if (!listening) return;
    const start = Date.now();
    const tick = () => setElapsedSecs(Math.floor((Date.now() - start) / 1000));
    const initial = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => { clearTimeout(initial); clearInterval(t); };
  }, [listening]);

  const isTimed = mode.hardTimeLimitSecs !== null;
  const timeRemaining = (isTimed && listening && mode.hardTimeLimitSecs !== null)
    ? Math.max(0, mode.hardTimeLimitSecs - elapsedSecs)
    : null;
  const timeUrgent = timeRemaining !== null && timeRemaining < 15;

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
        {isTimed && listening && (
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
          setText(e.target.value);
          setUsedVoice(false);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? "Make your case… (Ctrl/⌘+Enter to send)"}
        rows={3}
        disabled={disabled || listening}
        aria-label="Your debate response"
        className="w-full resize-none rounded-lg border border-[var(--rule)] bg-transparent px-3 py-2 text-sm disabled:opacity-50"
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          {supported ? (
            <button
              type="button"
              onClick={toggleListening}
              disabled={disabled}
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
            disabled={disabled || !displayValue.trim()}
            className="btn btn-primary px-4 py-1.5 text-sm disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
