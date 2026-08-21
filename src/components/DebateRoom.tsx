"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import MessageComposer from "./MessageComposer";
import ScoreBadges from "./ScoreBadges";
import { ArgGraphInline, TrackingGrid } from "./ArgGraphView";
import { useSpeechSynthesis } from "./useSpeechSynthesis";
import { MIN_ROUNDS, type DebateSummary, type InputMode, type SoloDebate, type SoloDebateTurn } from "@/lib/types";

interface DebateSummaryPayload {
  totalScore: number;
  summary: DebateSummary;
}

export default function DebateRoom({
  debate,
  topic,
  initialTurns,
}: {
  debate: SoloDebate;
  topic: { title: string; prompt: string };
  initialTurns: SoloDebateTurn[];
}) {
  const [turns, setTurns] = useState(initialTurns);
  const [roundCount, setRoundCount] = useState(debate.round_count);
  const [status, setStatus] = useState(debate.status);
  const [sending, setSending] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DebateSummaryPayload | null>(null);
  const [copied, setCopied] = useState(false);
  const { speak, supported: ttsSupported } = useSpeechSynthesis();
  const scrollRef = useRef<HTMLDivElement>(null);

  const aiSide = debate.side === "for" ? "against" : "for";
  const pending = turns[turns.length - 1];
  const canFinish = turns.filter((t) => t.user_message).length >= MIN_ROUNDS;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns, sending]);

  async function submitTurn(message: string, inputMode: InputMode) {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/solo/${debate.id}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, inputMode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit response.");

      setTurns((prev) => [...prev.slice(0, -1), data.completedTurn, data.nextTurn]);
      setRoundCount(data.roundCount);
      if (ttsSupported) speak(data.nextTurn.ai_message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit response.");
    } finally {
      setSending(false);
    }
  }

  async function finishDebate() {
    setFinishing(true);
    setError(null);
    try {
      const res = await fetch(`/api/solo/${debate.id}/finish`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to finish debate.");
      setStatus("completed");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to finish debate.");
    } finally {
      setFinishing(false);
    }
  }

  function copyResult() {
    if (!result) return;
    const text = [
      `Debate complete — ${result.totalScore} pts`,
      topic.title,
      "",
      result.summary.overallFeedback,
      "",
      "Strengths:",
      ...result.summary.strengths.map((s) => `• ${s}`),
      "",
      "To improve:",
      ...result.summary.improvements.map((s) => `• ${s}`),
    ].join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (result) {
    return (
      <div className="flex flex-col gap-5">
        <div className="surface-card flex flex-col gap-4 p-6">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-xl font-semibold">Debate complete — {result.totalScore} pts</h2>
            <button type="button" onClick={copyResult} className="btn btn-ghost shrink-0 px-3 py-1 text-xs">
              {copied ? "Copied!" : "Copy summary"}
            </button>
          </div>
          <p className="text-sm text-ink3">{result.summary.overallFeedback}</p>
          {result.summary.strengths.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-wide text-ink3">Strengths</p>
              <ul className="list-inside list-disc text-sm text-ink3">
                {result.summary.strengths.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {result.summary.improvements.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-wide text-ink3">To improve</p>
              <ul className="list-inside list-disc text-sm text-ink3">
                {result.summary.improvements.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-3 pt-2">
            <Link href="/" className="btn btn-primary px-4 py-2 text-sm">
              Back to today
            </Link>
            <Link href="/leaderboard" className="btn btn-ghost px-4 py-2 text-sm">
              View leaderboard
            </Link>
          </div>
        </div>
        {result.summary.argGraph ? (
          <div className="flex flex-col gap-4">
            <ArgGraphInline graph={result.summary.argGraph} playerAName="You" playerBName="AI opponent" />
            <TrackingGrid graph={result.summary.argGraph} />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-ink3">{topic.title}</p>
        <p className="text-sm text-ink3">{topic.prompt}</p>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink3">
          You&apos;re arguing <span className="text-[var(--foreground)]">{debate.side}</span> · AI argues {aiSide}
        </p>
        <p className="tabular text-sm text-ink3">
          Round {roundCount} {roundCount < MIN_ROUNDS && `· ${MIN_ROUNDS - roundCount + 1} to go`}
        </p>
      </div>

      <div
        ref={scrollRef}
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
                {turn.scores && <ScoreBadges scores={turn.scores} />}
                {turn.feedback && <p className="text-xs text-ink3">{turn.feedback}</p>}
              </div>
            )}
          </div>
        ))}
        {sending && <div className="text-sm text-ink3">AI is thinking…</div>}
      </div>

      {error && (
        <p className="text-sm text-[var(--bad)]" role="alert">
          {error}
        </p>
      )}

      {status === "active" && !pending?.user_message && <MessageComposer onSubmit={submitTurn} disabled={sending} />}

      {canFinish && status === "active" && (
        <button
          type="button"
          onClick={finishDebate}
          disabled={finishing}
          className="btn chip-elevated px-4 py-2 text-sm text-[var(--accent)] disabled:opacity-40"
        >
          {finishing ? "Scoring your debate…" : "Finish & get scored"}
        </button>
      )}
    </div>
  );
}
