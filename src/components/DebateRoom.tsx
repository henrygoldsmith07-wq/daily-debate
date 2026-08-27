"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import MessageComposer, { type ComposerSubmitData } from "./MessageComposer";
import ScoreBadges from "./ScoreBadges";
import RoundProgress from "./RoundProgress";
import ThinkingIndicator from "./ThinkingIndicator";
import ArgumentRepair from "./ArgumentRepair";
import { ArgGraphInline, TrackingGrid } from "./ArgGraphView";
import { useSpeechSynthesis } from "./useSpeechSynthesis";
import { MIN_ROUNDS, MAX_ROUNDS, type DebateSummary, type InputMode, type SoloDebate, type SoloDebateTurn } from "@/lib/types";
import type { ArgGraph } from "@/lib/argGraph";

interface RewardEventView { kind: string; xp: number; label: string; }
interface DebateSummaryPayload {
  totalScore: number;
  bonusXP: number;
  rewardEvents: RewardEventView[];
  summary: DebateSummary;
}

export default function DebateRoom({
  debate,
  topic,
  initialTurns,
  completedResult,
}: {
  debate: SoloDebate;
  topic: { title: string; prompt: string };
  initialTurns: SoloDebateTurn[];
  completedResult?: { totalScore: number; argGraph?: ArgGraph } | null;
}) {
  const [turns, setTurns] = useState(initialTurns);
  const [roundCount, setRoundCount] = useState(debate.round_count);
  const [status, setStatus] = useState(debate.status);
  const [sending, setSending] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DebateSummaryPayload | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const { speak, supported: ttsSupported } = useSpeechSynthesis();
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);

  const aiSide = debate.side === "for" ? "against" : "for";
  const pending = turns[turns.length - 1];
  const answeredCount = turns.filter((t) => t.user_message).length;
  const canFinish = answeredCount >= MIN_ROUNDS;
  const runningTotal = turns.reduce((sum, t) => sum + (t.turn_score ?? 0), 0);

  useEffect(() => {
    // Follow new messages only while the reader is already near the bottom;
    // scrolling up to re-read history must not be yanked forward.
    if (scrollRef.current && pinnedToBottom.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns, sending]);

  const [debateMode, setDebateMode] = useState("text");

  async function submitTurn(data: ComposerSubmitData) {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/solo/${debate.id}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: data.message, inputMode: data.inputMode }),
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "Failed to submit response.");

      setTurns((prev) => [...prev.slice(0, -1), resData.completedTurn, resData.nextTurn]);
      setRoundCount(resData.roundCount);
      if (ttsSupported) speak(resData.nextTurn.ai_message);
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
    navigator.clipboard.writeText(text).then(
      () => {
        setCopyState("copied");
        setTimeout(() => setCopyState("idle"), 2000);
      },
      () => {
        setCopyState("failed");
        setTimeout(() => setCopyState("idle"), 3000);
      },
    );
  }

  if (result) {
    // Coaching insight: lead with the most meaningful behavioural signal.
    const rewards = result.rewardEvents?.filter((e) => e.kind !== "complete-debate") ?? [];
    const topReward = rewards[0];
    const bonusXP = result.bonusXP ?? 0;

    return (
      <div className="flex flex-col gap-5">
        <div className="surface-card flex flex-col gap-4 p-6">
          {/* Coaching headline */}
          {topReward ? (
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--accent)]">Best improvement</p>
              <p className="mt-1 text-lg font-semibold">{topReward.label}</p>
              {rewards.length > 1 && (
                <ul className="mt-2 list-inside list-disc text-xs text-ink3">
                  {rewards.slice(1).map((r) => (
                    <li key={r.kind}>{r.label} (+{r.xp} XP)</li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {/* Score demoted to secondary */}
          <div className="flex items-baseline gap-3">
            <span className="tabular text-2xl font-bold">{result.totalScore}</span>
            <span className="text-sm text-ink3">pts</span>
            {bonusXP > 0 && <span className="tabular text-sm text-[var(--accent)]">+{bonusXP} bonus</span>}
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
            <button type="button" onClick={copyResult} className="btn btn-ghost px-3 py-1 text-xs">
              {copyState === "copied" ? "Copied!" : copyState === "failed" ? "Copy failed" : "Copy summary"}
            </button>
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
            <ArgumentRepair graph={result.summary.argGraph} />
            <ArgGraphInline graph={result.summary.argGraph} playerAName="You" playerBName="AI opponent" />
            <TrackingGrid graph={result.summary.argGraph} />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      {debate.status === "completed" && !result && completedResult && (
        <div className="surface-card flex flex-col gap-3 p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-lg font-semibold">Replay — {completedResult.totalScore} pts</h2>
            <Link href="/history" className="btn btn-ghost shrink-0 px-3 py-1 text-xs">
              All debates
            </Link>
          </div>
          {completedResult.argGraph && (
            <>
              <ArgumentRepair graph={completedResult.argGraph} />
              <ArgGraphInline graph={completedResult.argGraph} playerAName="You" playerBName="AI opponent" />
              <TrackingGrid graph={completedResult.argGraph} />
            </>
          )}
        </div>
      )}
      <div>
        <p className="text-xs uppercase tracking-wide text-ink3">{topic.title}</p>
        <p className="text-sm text-ink3">{topic.prompt}</p>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink3">
          You&apos;re arguing <span className="text-[var(--foreground)]">{debate.side}</span> · AI argues {aiSide}
        </p>
        <RoundProgress answered={answeredCount} />
      </div>
      <div className="flex items-center justify-between">
        <p className="tabular text-sm text-ink3">
          Round {roundCount} {roundCount < MIN_ROUNDS && `· ${MIN_ROUNDS - roundCount + 1} to go`}
          {runningTotal > 0 && ` · ${runningTotal} pts so far`}
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
                {turn.scores && <ScoreBadges scores={turn.scores} />}
                {turn.feedback && <p className="text-xs text-ink3">{turn.feedback}</p>}
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

      {status === "active" && !pending?.user_message && roundCount < MAX_ROUNDS && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2 flex-wrap" role="group" aria-label="Debate mode">
            {[
              { id: "text", label: "📝 Text" },
              { id: "speech", label: "🎙️ Speech" },
              { id: "rapid-rebuttal", label: "⚡ Rapid (60s)" },
              { id: "prepared-speech", label: "📋 Speech (5min)" },
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setDebateMode(m.id)}
                aria-pressed={debateMode === m.id}
                className={`btn px-3 py-1.5 text-xs ${debateMode === m.id ? "border-[var(--accent)] text-[var(--accent)] font-semibold" : "btn-ghost"}`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <MessageComposer onSubmit={submitTurn} disabled={sending} modeId={debateMode} />
        </div>
      )}

      {status === "active" && !pending?.user_message && roundCount >= MAX_ROUNDS && (
        <p className="text-center text-sm text-ink3">
          Round limit reached ({MAX_ROUNDS}). Finish the debate to get scored.
        </p>
      )}

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
