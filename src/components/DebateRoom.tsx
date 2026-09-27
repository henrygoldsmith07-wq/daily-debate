"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import MessageComposer, { type ComposerSubmitData } from "./MessageComposer";
import RoundProgress from "./RoundProgress";
import ThinkingIndicator from "./ThinkingIndicator";
import ArgumentRepair, { FixThisNowButton } from "./ArgumentRepair";
import { ArgGraphInline, TrackingGrid } from "./ArgGraphView";
import { useSpeechSynthesis } from "./useSpeechSynthesis";
import { MAX_ROUNDS, type DebateSummary, type SoloDebate, type SoloDebateTurn, type TrainingSummary } from "@/lib/types";
import type { ArgGraph } from "@/lib/argGraph";
import type { ResultSnapshot } from "@/lib/resultSnapshot";
import { minRoundsFor } from "@/lib/sprint";
import { trackEvent } from "@/lib/trackClientEvent";
import { DEBATE_MODES, type DebateModeId } from "@/lib/debateModes";

interface RewardEventView { kind: string; xp: number; label: string; detail?: string; dimension?: string; }
interface DebateSummaryPayload {
  totalScore: number;
  bonusXP: number;
  rewardEvents: RewardEventView[];
  summary: DebateSummary;
  format?: "sprint" | "full";
  honesty?: { confidence: "standard" | "reduced"; note: string | null };
  snapshot?: ResultSnapshot;
  trainingSummary?: TrainingSummary;
  summarySource?: "ai" | "fallback";
}

/** The shared result/replay story: action first, coaching second, detail last. */
interface ReplayView {
  totalScore: number;
  snapshot: ResultSnapshot | null;
  argGraph: ArgGraph | null;
  /** Whether a repair has already been recorded for this debate. */
  repaired: boolean;
  bonusXP?: number;
  topRewardLabel?: string;
  topRewardDetail?: string;
  honestyNote?: string | null;
  summary?: DebateSummary;
  trainingSummary?: TrainingSummary;
  summarySource?: "ai" | "fallback";
  fresh?: boolean;
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
  completedResult?: {
    totalScore: number;
    argGraph?: ArgGraph;
    snapshot?: ResultSnapshot | null;
    /** Whether a repair has already been recorded for this debate (server-side). */
    repaired?: boolean;
    honestyNote?: string | null;
    summary?: DebateSummary;
    bonusXP?: number;
    rewardEvents?: RewardEventView[];
    trainingSummary?: TrainingSummary;
    summarySource?: "ai" | "fallback";
  } | null;
}) {
  const [turns, setTurns] = useState(initialTurns);
  const [roundCount, setRoundCount] = useState(debate.round_count);
  const [status, setStatus] = useState(debate.status);
  const [sending, setSending] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DebateSummaryPayload | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [showFullAnalysis, setShowFullAnalysis] = useState(false);
  const [repairSucceeded, setRepairSucceeded] = useState(completedResult?.repaired ?? false);
  const { speak, supported: ttsSupported } = useSpeechSynthesis();
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);
  const repairRef = useRef<HTMLDivElement>(null);

  const format = debate.format === "sprint" ? "sprint" : "full";
  const minRounds = minRoundsFor(format);
  const aiSide = debate.side === "for" ? "against" : "for";
  const pending = turns[turns.length - 1];
  const answeredCount = turns.filter((t) => t.user_message).length;
  const canFinish = answeredCount >= minRounds;
  const sideReason =
    (debate.coaching as { sideReason?: string | null } | null)?.sideReason ??
    ((debate as unknown as { side_reason?: string | null }).side_reason ?? null);
  const repairRetest = debate.coaching?.repairRetest ?? null;
  // Sprint rounds are answered up to and including round 3 (the cap itself);
  // full debates keep the legacy behaviour where round_count counts created
  // turns and the composer hides at 12.
  const composerVisible =
    status === "active" && !pending?.user_message && (format === "sprint" ? roundCount <= 3 : roundCount < MAX_ROUNDS);

  useEffect(() => {
    // Follow new messages only while the reader is already near the bottom;
    // scrolling up to re-read history must not be yanked forward.
    if (scrollRef.current && pinnedToBottom.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns, sending]);

  const [debateMode, setDebateMode] = useState<DebateModeId>("text");
  const [modeStartedAt, setModeStartedAt] = useState<number | null>(null);
  const [showAdvancedModes, setShowAdvancedModes] = useState(false);
  const [opponentSpeaking, setOpponentSpeaking] = useState(false);
  const [modeWindowStarting, setModeWindowStarting] = useState(false);
  const waitingForModeWindow =
    DEBATE_MODES[debateMode].hardTimeLimitSecs !== null && modeStartedAt === null;

  async function startResponseWindow(modeId: DebateModeId, turnId: string) {
    setModeWindowStarting(true);
    setError(null);
    try {
      const res = await fetch(`/api/solo/${debate.id}/turn-window`, {
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
      const remaining = typeof data.remainingSeconds === "number" ? data.remainingSeconds : limit;
      if (remaining <= 0) {
        setModeStartedAt(Date.now() - limit * 1000);
        setError(`${DEBATE_MODES[modeId].label} time limit has expired. Switch modes to continue this round.`);
        return false;
      }
      setModeStartedAt(Date.now() - (limit - Math.min(limit, remaining)) * 1000);
      return true;
    } catch (err) {
      setModeStartedAt(null);
      setError(err instanceof Error ? err.message : "Failed to start response timer.");
      return false;
    } finally {
      setModeWindowStarting(false);
    }
  }

  async function chooseMode(modeId: DebateModeId) {
    if (!pending?.id || opponentSpeaking || modeWindowStarting) return;
    setDebateMode(modeId);
    await startResponseWindow(modeId, pending.id);
  }

  async function submitTurn(data: ComposerSubmitData) {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/solo/${debate.id}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: data.message,
          inputMode: data.inputMode,
          modeId: data.modeId,
          timing: data.timing,
          elapsedSeconds: data.elapsedSeconds,
        }),
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "Failed to submit response.");

      // Final round: no next turn is created — the room switches to its
      // "finish the debate" state instead of waiting for a reply that
      // will never come.
      setTurns((prev) =>
        resData.nextTurn
          ? [...prev.slice(0, -1), resData.completedTurn, resData.nextTurn]
          : [...prev.slice(0, -1), resData.completedTurn],
      );
      setRoundCount(resData.roundCount);
      if (resData.nextTurn && debateMode !== "text") {
        setModeStartedAt(null);
        if (ttsSupported) {
          setOpponentSpeaking(true);
          speak(resData.nextTurn.ai_message, () => {
            setOpponentSpeaking(false);
            void startResponseWindow(debateMode, resData.nextTurn.id);
          });
        } else {
          void startResponseWindow(debateMode, resData.nextTurn.id);
        }
      } else {
        setModeStartedAt(null);
        if (resData.nextTurn && ttsSupported) {
          setOpponentSpeaking(true);
          speak(resData.nextTurn.ai_message, () => setOpponentSpeaking(false));
        }
      }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit response.");
      return false;
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

  function scrollToRepair() {
    // Direct route to the repair exercise — the graph stays folded. Full
    // Analysis is only for users who explicitly ask for it.
    requestAnimationFrame(() => {
      repairRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      repairRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true });
    });
  }

  // ── Shared result/replay story ─────────────────────────────────────────
  // Both the fresh result and a replay render the same hierarchy:
  // strength → weakness → repair → score → collapsed advanced analysis.
  const view: ReplayView | null = result
    ? {
        totalScore: result.totalScore,
        snapshot: result.snapshot ?? null,
        argGraph: result.summary.argGraph ?? null,
        repaired: repairSucceeded,
        bonusXP: result.bonusXP,
        topRewardLabel: result.rewardEvents?.filter((e) => e.kind !== "complete-debate")[0]?.label,
        topRewardDetail: result.rewardEvents?.filter((e) => e.kind !== "complete-debate")[0]?.detail,
        honestyNote: result.honesty?.note ?? null,
        summary: result.summary,
        trainingSummary: result.trainingSummary,
        summarySource: result.summarySource,
        fresh: true,
      }
    : debate.status === "completed" && completedResult
      ? {
          totalScore: completedResult.totalScore,
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
    const snapshot = view.snapshot;
    const weakness = snapshot?.weakness ?? null;
    const highlight = snapshot?.highlight ?? null;
    const summary = view.summary;
    const trainingSummary = view.trainingSummary;

    return (
      <div className="flex flex-col gap-5">
        <div className="surface-card flex flex-col gap-4 p-6" data-testid="result-card">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">
            {view.fresh ? (
              <>Debate complete{format === "sprint" ? " · Sprint" : ""}</>
            ) : (
              <>Replay{format === "sprint" ? " · Sprint" : ""}</>
            )}
          </p>

          {/* Today's focus outcome, including deliberate repair retests. */}
          {snapshot?.goalOutcome?.detail && (
            <div
              className="rounded-lg border border-[var(--rule)] bg-surface-2 px-3 py-2 text-sm text-ink2"
              data-testid={repairRetest ? "repair-retest-outcome" : "goal-outcome"}
            >
              {repairRetest && (
                <span className="mr-1 font-semibold text-[var(--accent)]">Repair retest ·</span>
              )}
              {snapshot.goalOutcome.demonstrated === true && <span className="mr-1 text-[var(--success)]">✓</span>}
              {snapshot.goalOutcome.demonstrated === false && <span className="mr-1 text-amber-600">→</span>}
              {snapshot.goalOutcome.detail}
            </div>
          )}
          {repairRetest && !snapshot?.goalOutcome?.detail && (
            <div
              className="rounded-lg border border-[var(--rule)] bg-surface-2 px-3 py-2 text-sm text-ink2"
              data-testid="repair-retest-outcome"
            >
              <span className="mr-1 font-semibold text-[var(--accent)]">Repair retest ·</span>
              This skill was practised under debate conditions. A one-debate pass/fail claim is not available for this
              dimension; Progress tracks the later observable movement instead.
            </div>
          )}

          {/* One strength, grounded in the debate */}
          {highlight && (
            <div>
              <p className="text-xs uppercase tracking-wide text-ink3">You did well</p>
              <p className="mt-1 text-base font-semibold">{highlight.headline}</p>
              <p className="mt-0.5 text-sm text-ink3">{highlight.evidence}</p>
            </div>
          )}

          {/* One main weakness + why it matters (+ repeated-weakness signal) */}
          {weakness && (
            <div className="rounded-lg border border-[var(--speak)]/30 bg-[var(--speak-soft)] p-4" data-testid="main-weakness">
              <p className="text-xs uppercase tracking-wide text-[var(--speak)]">Main weakness</p>
              <p className="mt-1 text-base font-semibold">{weakness.headline}</p>
              <p className="mt-1 text-sm leading-6 text-ink2">{weakness.whyItMatters}</p>
              {snapshot?.recurrence?.label && (
                <p className="mt-2 text-xs font-medium text-[var(--speak)]" data-testid="weakness-recurrence">
                  ↻ {snapshot.recurrence.label}
                </p>
              )}
            </div>
          )}

          {/* Primary action: fix it now — straight to the repair exercise */}
          {weakness && !view.repaired && <FixThisNowButton onClick={scrollToRepair} debateId={debate.id} />}

          {/* Repair status once recorded (replays land here) */}
          {view.repaired && (
            <div className="flex items-center gap-2 text-sm text-ink2" data-testid="repair-status">
              <span className="text-[var(--success)]">✓</span>
              Repair completed for this debate — your next debates test whether it stuck.
            </div>
          )}

          {/* Score & XP demoted to secondary */}
          <div className="flex items-baseline gap-3 pt-1">
            <span className="text-xs uppercase tracking-wide text-ink3">Score</span>
            <span className="tabular text-xl font-bold">{view.totalScore}</span>
            {(view.bonusXP ?? 0) > 0 && <span className="tabular text-sm text-[var(--accent)]">+{view.bonusXP} XP</span>}
            {view.topRewardLabel && <span className="text-xs text-ink3">· {view.topRewardLabel}</span>}
            {view.topRewardDetail && <span className="text-xs text-ink3">({view.topRewardDetail})</span>}
          </div>
          {view.honestyNote && <p className="text-xs leading-5 text-ink3">{view.honestyNote}</p>}
          {view.summarySource === "fallback" && (
            <p className="rounded-lg border border-[var(--rule)] bg-surface-2 px-3 py-2 text-xs leading-5 text-ink3" role="status">
              Detailed generated feedback was unavailable for this finish. Scores, the main weakness, repair guidance and progress signals still come from the stored deterministic assessment.
            </p>
          )}

          {trainingSummary && (trainingSummary.speechTurns > 0 || Object.keys(trainingSummary.modeCounts).some((mode) => mode !== "text")) && (
            <section className="rounded-lg border border-[var(--rule)] bg-surface-2 p-4" aria-labelledby="delivery-analysis-heading">
              <p className="text-xs uppercase tracking-wide text-ink3">Mode-specific analysis</p>
              <h2 id="delivery-analysis-heading" className="mt-1 text-sm font-semibold">Pressure and delivery</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {trainingSummary.avgPaceWpm !== null && (
                  <div>
                    <p className="text-xs text-ink3">Average pace</p>
                    <p className="tabular text-sm font-semibold">{trainingSummary.avgPaceWpm} WPM</p>
                  </div>
                )}
                {trainingSummary.avgSpeechQuality !== null && (
                  <div>
                    <p className="text-xs text-ink3">Delivery composite</p>
                    <p className="tabular text-sm font-semibold">{trainingSummary.avgSpeechQuality}/100</p>
                  </div>
                )}
                {trainingSummary.avgFillerDensity !== null && (
                  <div>
                    <p className="text-xs text-ink3">Fillers</p>
                    <p className="tabular text-sm font-semibold">{trainingSummary.avgFillerDensity} / 100 words</p>
                  </div>
                )}
                {trainingSummary.avgElapsedSeconds !== null && (
                  <div>
                    <p className="text-xs text-ink3">Response time</p>
                    <p className="tabular text-sm font-semibold">{trainingSummary.avgElapsedSeconds}s avg</p>
                  </div>
                )}
              </div>
              {trainingSummary.paceChangeWpm !== null && trainingSummary.speechTurns >= 2 && (
                <p className="mt-3 text-xs text-ink3">
                  Pace changed {trainingSummary.paceChangeWpm > 0 ? "+" : ""}{trainingSummary.paceChangeWpm} WPM from your first to last measured speech turn.
                </p>
              )}
              <p className="mt-3 text-[11px] leading-5 text-ink3">
                Delivery observations are separate from the argument score. They describe pace, wording and timing in this training mode, not accent, voice quality or general ability.
              </p>
            </section>
          )}

          <div className="flex flex-wrap gap-3 pt-1">
            <button
              type="button"
              onClick={() => {
                trackEvent("full_analysis_opened", { format, debateId: debate.id });
                setShowFullAnalysis((v) => !v);
              }}
              aria-expanded={showFullAnalysis}
              className="btn btn-ghost px-3 py-1.5 text-xs underline underline-offset-2"
              data-testid="toggle-full-analysis"
            >
              {showFullAnalysis ? "Hide full analysis" : "View full analysis"}
            </button>
            {view.fresh && (
              <button type="button" onClick={copyResult} className="btn btn-ghost px-3 py-1.5 text-xs">
                {copyState === "copied" ? "Copied!" : copyState === "failed" ? "Copy failed" : "Copy summary"}
              </button>
            )}
            {!view.fresh && (
              <Link href="/history" className="btn btn-ghost px-3 py-1.5 text-xs">
                All debates
              </Link>
            )}
            {view.fresh && (
              <Link href="/" className="btn btn-ghost px-3 py-1.5 text-xs">
                Back to today
              </Link>
            )}
          </div>

          {showFullAnalysis && (
            <div className="flex flex-col gap-4 border-t border-[var(--rule)] pt-4" data-testid="full-analysis">
              {summary ? (
                <>
                  <p className="text-sm text-ink3">{summary.overallFeedback}</p>
                  {summary.strengths.length > 0 && (
                    <div>
                      <p className="text-xs uppercase tracking-wide text-ink3">Strengths</p>
                      <ul className="list-inside list-disc text-sm text-ink3">
                        {summary.strengths.map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {summary.improvements.length > 0 && (
                    <div>
                      <p className="text-xs uppercase tracking-wide text-ink3">To improve</p>
                      <ul className="list-inside list-disc text-sm text-ink3">
                        {summary.improvements.map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-ink3">
                  Detailed model feedback is only generated when a debate is finished. This replay shows the
                  deterministic story above.
                </p>
              )}
              {view.argGraph && (
                <>
                  <ArgGraphInline graph={view.argGraph} playerAName="You" playerBName="AI opponent" />
                  <TrackingGrid graph={view.argGraph} />
                </>
              )}
              <Link href="/leaderboard" className="btn btn-ghost self-start px-3 py-1 text-xs">
                View leaderboard
              </Link>
            </div>
          )}
        </div>

        {/* The repair exercise: failed attempts stay retryable. A replay
            that was ALREADY successfully repaired before this page load starts
            collapsed; if success happens during this visit, keep the mounted
            panel so the user can read the feedback they just earned. */}
        {view.argGraph && weakness && !completedResult?.repaired && (
          <div ref={repairRef}>
            <ArgumentRepair
              graph={view.argGraph}
              debateId={debate.id}
              presetTarget={weakness.repair}
              onCompleted={(repair) => {
                if (repair.succeeded) setRepairSucceeded(true);
              }}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
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
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Debate mode">
            {[
              { id: "text", label: "📝 Text" },
              { id: "speech", label: "🎙️ Speech" },
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                disabled={opponentSpeaking || modeWindowStarting}
                onClick={() => void chooseMode(m.id as DebateModeId)}
                aria-pressed={debateMode === m.id}
                className={`btn px-3 py-1.5 text-xs disabled:opacity-40 ${debateMode === m.id ? "border-[var(--accent)] text-[var(--accent)] font-semibold" : "btn-ghost"}`}
              >
                {m.label}
              </button>
            ))}
            <button
              type="button"
              disabled={opponentSpeaking || modeWindowStarting}
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
                    disabled={opponentSpeaking || modeWindowStarting}
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
            key={`${debateMode}-${pending?.id ?? "none"}`}
            onSubmit={submitTurn}
            disabled={sending || opponentSpeaking || modeWindowStarting || waitingForModeWindow}
            modeId={debateMode}
            startedAtMs={modeStartedAt}
          />
          {opponentSpeaking ? (
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

      {canFinish && status === "active" && (
        <button
          type="button"
          onClick={finishDebate}
          disabled={finishing}
          className="btn chip-elevated px-4 py-2 text-sm text-[var(--accent)] disabled:opacity-40"
          data-testid="finish-debate"
        >
          {finishing ? "Scoring your debate…" : "Finish & get scored"}
        </button>
      )}
    </div>
  );
}
