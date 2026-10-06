"use client";

// The finished-debate story.
//
// Order follows the product loop rather than a dashboard: the goal outcome,
// then the ONE weakness worth fixing, then the repair affordance, then
// numbers, then delivery detail, then full analysis behind a disclosure.
// The repair panel is mounted last so a repair completed during this visit
// keeps its freshly earned feedback on screen; a replay that was already
// repaired before load starts collapsed.

import { useState, type RefObject } from "react";
import type { SoloDebate } from "@/lib/types";
import Link from "next/link";
import ArgumentRepair, { FixThisNowButton } from "../ArgumentRepair";
import { ArgGraphInline, TrackingGrid } from "../ArgGraphView";
import type { DebateSummaryPayload, ReplayView } from "./types";
import { trackEvent } from "@/lib/trackClientEvent";
import { formatLabelFor, type DebateFormat } from "@/lib/sprint";

export interface DebateResultCardProps {
  view: ReplayView;
  format: DebateFormat;
  debateId: string;
  /** The deliberate retest assignment this debate is serving, if any. */
  repairRetest: NonNullable<SoloDebate["coaching"]>["repairRetest"] | null;
  repairRef: RefObject<HTMLDivElement | null>;
  /** The raw finish payload, present only for a debate finished in this visit. */
  freshResult: DebateSummaryPayload | null;
  /** Whether the server had already recorded a repair before this load. */
  completedRepaired: boolean;
  onRepairSucceeded: () => void;
}

export function DebateResultCard({
  view,
  format,
  debateId,
  repairRetest,
  completedRepaired,
  freshResult,
  repairRef,
  onRepairSucceeded,
}: DebateResultCardProps) {
  const [showFullAnalysis, setShowFullAnalysis] = useState(false);

  // Copy the plain-text summary for learners who want to revisit it elsewhere.
  const copyResult = () => {
    if (!freshResult) return;
    const text = [
      `Debate complete - performance ${freshResult.performanceScore}/100 · +${freshResult.totalScore + freshResult.bonusXP} XP`,
      freshResult.summary.overallFeedback,
      "",
      "Strengths:",
      ...freshResult.summary.strengths.map((s) => `• ${s}`),
      "",
      "To improve:",
      ...freshResult.summary.improvements.map((s) => `• ${s}`),
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
  };
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  // Direct route to the repair exercise. The graph stays folded, and the
  // textarea takes focus so the learner can start typing immediately instead of
  // having to find the field after the scroll settles.
  const scrollToRepair = () => {
    requestAnimationFrame(() => {
      repairRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      repairRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true });
    });
  };
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
              <>Debate complete · {formatLabelFor(format)}</>
            ) : (
              <>Replay · {formatLabelFor(format)}</>
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
          {weakness && !view.repaired && <FixThisNowButton onClick={scrollToRepair} debateId={debateId} />}

          {/* Repair status once recorded (replays land here) */}
          {view.repaired && (
            <div className="flex items-center gap-2 text-sm text-ink2" data-testid="repair-status">
              <span className="text-[var(--success)]">✓</span>
              Repair completed for this debate — your next debates test whether it stuck.
            </div>
          )}

          {/* Performance is length-normalized; XP remains cumulative reward volume. */}
          <div className="flex items-baseline gap-3 pt-1">
            <span className="text-xs uppercase tracking-wide text-ink3">Performance</span>
            <span className="tabular text-xl font-bold">{view.performanceScore}/100</span>
            <span className="tabular text-sm text-[var(--accent)]">+{view.totalScore + (view.bonusXP ?? 0)} XP</span>
            {view.topRewardLabel && <span className="text-xs text-ink3">· {view.topRewardLabel}</span>}
            {view.topRewardDetail && <span className="text-xs text-ink3">({view.topRewardDetail})</span>}
          </div>
          {view.honestyNote && <p className="text-xs leading-5 text-ink3">{view.honestyNote}</p>}
          {view.summarySource === "fallback" && (
            <p className="rounded-lg border border-[var(--rule)] bg-surface-2 px-3 py-2 text-xs leading-5 text-ink3" role="status">
              Detailed generated feedback was unavailable for this finish. Performance, the main weakness, repair guidance and progress signals still come from the stored deterministic assessment.
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
                trackEvent("full_analysis_opened", { format, debateId });
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
        {view.argGraph && weakness && !completedRepaired && (
          <div ref={repairRef}>
            <ArgumentRepair
              graph={view.argGraph}
              debateId={debateId}
              presetTarget={weakness.repair}
              onCompleted={(repair) => {
                if (repair.succeeded) onRepairSucceeded();
              }}
            />
          </div>
        )}
      </div>
    );
}
