"use client";

import { useCallback, useEffect, useState } from "react";
import { DRILL_FEEDBACK_COPY, normaliseDrillSignals } from "@/lib/drillFeedback";

interface Dim {
  key: string;
  label: string;
  score: number | null;
  hasData: boolean;
}

interface Assignment {
  id: string;
  dimension: string;
  minutes: number;
  title: string;
  prompt: string;
  before_score: number | null;
  status: string;
}

interface Proposal {
  dimension: string;
  minutes: number;
  title: string;
  prompt: string;
  beforeScore: number | null;
}

interface RetestInfo {
  dimension: string;
  label: string;
  repairDebateId: string;
  attemptedAt: string;
}

interface OutcomeRow {
  id: string;
  label: string;
  title: string;
  assignedDate: string;
  movement: number | null;
  measured: boolean;
}

function ProfileRead({ label, score, min, max }: { label: string; score: number | null; min: number | null; max: number | null }) {
  const read = score === null
    ? "No observed signal"
    : min !== null && max !== null && min !== max && score === max
      ? "Stronger signal"
      : min !== null && max !== null && min !== max && score === min
        ? "Current gap"
        : "Mixed evidence";
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--rule)] py-1.5 text-xs last:border-0">
      <span className="w-24 shrink-0 text-ink3">{label}</span>
      <span className="text-right text-ink2" aria-label={`${label}: ${read}`}>{read}</span>
    </div>
  );
}

export default function CoachToday({ showProfile = true }: { showProfile?: boolean }) {
  const [dims, setDims] = useState<Dim[]>([]);
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [activationRequired, setActivationRequired] = useState(false);
  const [focusReason, setFocusReason] = useState<string>("");
  const [debatesAnalysed, setDebatesAnalysed] = useState<number | null>(null);
  const [outcomes, setOutcomes] = useState<OutcomeRow[]>([]);
  const [retest, setRetest] = useState<RetestInfo | null>(null);
  const [outcomeSummary, setOutcomeSummary] = useState<string | null>(null);
  const [attemptText, setAttemptText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [activating, setActivating] = useState(false);
  const [feedback, setFeedback] = useState<{ signals: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Distinguishes "still fetching" from "fetched, nothing to show". The empty
  // state and the loading state look different on purpose.
  const [loading, setLoading] = useState(true);
  const [coachingStatus, setCoachingStatus] = useState<"ok" | "partial" | "unavailable" | null>(null);
  const scoredDims = dims.map((d) => d.score).filter((score): score is number => score !== null);
  const profileMin = scoredDims.length ? Math.min(...scoredDims) : null;
  const profileMax = scoredDims.length ? Math.max(...scoredDims) : null;

  const load = useCallback(async () => {
    setError(null);
    try {
      const [todayRes, outcomesRes] = await Promise.all([
        fetch("/api/coach/today", { cache: "no-store" }),
        fetch("/api/coach/outcomes", { cache: "no-store" }),
      ]);
      const todayData = await todayRes.json();
      if (!todayRes.ok) throw new Error(todayData.error || "Coach unavailable.");
      setDims(todayData.profile ?? []);
      setAssignment(todayData.assignment ?? null);
      setProposal(todayData.proposal ?? null);
      setActivationRequired(todayData.activationRequired === true);
      setFocusReason(todayData.focusReason ?? "");
      setRetest(todayData.retest ?? null);
      setDebatesAnalysed(todayData.debatesAnalysed ?? null);
      setCoachingStatus(todayData.coachingStatus ?? "ok");
      if (outcomesRes.ok) {
        const o = await outcomesRes.json();
        setOutcomes(o.outcomes ?? []);
        setOutcomeSummary(o.summary?.note ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Coach unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function activateAssignment() {
    if (!proposal || !activationRequired) return;
    setActivating(true);
    setError(null);
    try {
      const res = await fetch("/api/coach/today", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start today's drill.");
      setAssignment(data.assignment ?? null);
      setProposal(data.proposal ?? null);
      setActivationRequired(data.activationRequired === true);
      setFocusReason(data.focusReason ?? focusReason);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start today's drill.");
    } finally {
      setActivating(false);
    }
  }

  async function submitAttempt() {
    if (!assignment) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/coach/today/attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId: assignment.id, text: attemptText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || DRILL_FEEDBACK_COPY.errorFallback);
      setFeedback({ signals: normaliseDrillSignals(data.signals) });
      setAttemptText("");
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : DRILL_FEEDBACK_COPY.errorFallback);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {coachingStatus === "partial" && (
        <p className="text-xs text-ink3" role="status">
          Some coaching context is temporarily unavailable, so this focus may use fallback evidence.
        </p>
      )}
      {showProfile && (
        <section className="surface-card p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Argument skill profile</h2>
            {debatesAnalysed !== null && (
              <span className="tabular text-xs text-ink3">{debatesAnalysed} debates analysed</span>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            {dims.map((d) => (
              <ProfileRead key={d.key} label={d.label} score={d.score} min={profileMin} max={profileMax} />
            ))}
          </div>
          <p className="mt-3 text-[10px] leading-4 text-ink3">These are relative coaching signals from observed debate behaviour, not ability scores.</p>
        </section>
      )}

      {retest && (
        <section className="surface-card border-[var(--accent)] p-5" role="status" data-testid="repair-retest-card">
          <p className="text-xs uppercase tracking-wide text-[var(--accent)]">Retest after repair</p>
          <h2 className="mt-1 text-lg font-semibold">{retest.label}</h2>
          <p className="mt-1 text-sm text-ink3">
            You practised this weak link after your last debate. Your next debate keeps this skill in focus until it
            produces an observable reading.
          </p>
        </section>
      )}

      {assignment ? (
        <section className="surface-card flex flex-col gap-4 p-5">
          <div>
            <p className="text-xs uppercase tracking-wide text-[var(--accent)]">Today&apos;s training focus</p>
            <h2 className="mt-1 text-lg font-semibold">{assignment.title}</h2>
            <p className="text-xs text-ink3">
              {assignment.minutes} min · {focusReason}
            </p>
          </div>
          <p className="rounded-lg border border-[var(--rule)] bg-surface-2 p-4 text-sm leading-relaxed">
            {assignment.prompt}
          </p>

          {feedback ? (
            <div className="rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] p-4" role="status">
              <p className="text-sm font-semibold">{DRILL_FEEDBACK_COPY.heading}</p>
              <p className="mt-1 text-xs text-ink3">{DRILL_FEEDBACK_COPY.observationLabel}</p>
              <ul className="mt-1 list-inside list-disc text-xs text-ink3">
                {feedback.signals.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-ink3">{DRILL_FEEDBACK_COPY.note}</p>
            </div>
          ) : assignment.status === "attempted" ? (
            <p className="text-sm text-ink3" role="status">
              {DRILL_FEEDBACK_COPY.savedNote}
            </p>
          ) : (
            <textarea
              value={attemptText}
              onChange={(e) => setAttemptText(e.target.value)}
              rows={4}
              placeholder="Write your drill attempt here…"
              aria-label="Drill attempt"
              className="w-full resize-none rounded-lg border border-[var(--rule)] bg-transparent px-3 py-2 text-sm"
            />
          )}

          {!feedback && assignment.status !== "attempted" && (
            <>
              {error && (
                <p role="alert" className="text-xs text-[var(--bad)]">
                  {error}
                </p>
              )}
              <button
                type="button"
                onClick={submitAttempt}
                disabled={submitting || attemptText.trim().length < 10}
                className="btn btn-primary px-4 py-2 text-sm disabled:opacity-40"
              >
                {submitting ? DRILL_FEEDBACK_COPY.submitBusy : DRILL_FEEDBACK_COPY.submitIdle}
              </button>
            </>
          )}
        </section>
      ) : proposal ? (
        <section className="surface-card flex flex-col gap-4 p-5" data-testid="coach-drill-proposal">
          <div>
            <p className="text-xs uppercase tracking-wide text-[var(--accent)]">
              {retest ? "Retest drill ready" : "Today’s training focus"}
            </p>
            <h2 className="mt-1 text-lg font-semibold">{proposal.title}</h2>
            <p className="text-xs text-ink3">{proposal.minutes} min · {focusReason}</p>
          </div>
          <p className="rounded-lg border border-[var(--rule)] bg-surface-2 p-4 text-sm leading-relaxed">
            {proposal.prompt}
          </p>
          {error && (
            <p role="alert" className="text-xs text-[var(--bad)]">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={activateAssignment}
            disabled={activating}
            className="btn btn-primary px-4 py-2 text-sm disabled:opacity-40"
          >
            {activating ? "Starting…" : retest ? "Use this retest drill" : "Start drill"}
          </button>
          <p className="text-[10px] leading-4 text-ink3">
            Opening Progress only previews the drill. It is added to your training history when you start it.
          </p>
        </section>
      ) : loading ? (
        /* The un-loaded state is NOT the empty state. Rendering
           "Complete a debate to unlock today's training focus" while the two
           coach requests are in flight tells a learner with pending repairs
           that they have no coaching at all, for a moment, on every visit. */
        <section className="surface-card p-5" role="status" aria-busy="true" data-testid="coach-loading">
          <div className="flex items-center gap-3">
            <span
              className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[var(--line)] border-t-[var(--accent)]"
              aria-hidden="true"
            />
            <p className="text-sm text-ink3">Loading today&apos;s training focus…</p>
          </div>
        </section>
      ) : error ? (
        /* The error is rendered here regardless of whether an assignment
           loaded. Previously it only appeared inside the assignment and
           proposal branches, so a load failure with no drill rendered nothing
           at all — a silent hole on the coaching surface. */
        <section className="surface-card p-5" role="alert">
          <p className="text-sm text-[var(--bad)]">{error}</p>
          <button type="button" onClick={() => void load()} className="btn btn-ghost mt-3 px-3 py-1.5 text-xs">
            Try again
          </button>
        </section>
      ) : (
        <section className="surface-card p-5 text-sm text-ink3" role="status">
          {focusReason || "Complete a debate to unlock today's training focus."}
        </section>
      )}

      {(outcomes.length > 0 || outcomeSummary) && (
        <section className="surface-card p-5">
          <h2 className="text-sm font-semibold">Drill outcomes</h2>
          {outcomeSummary && <p className="mt-1 text-xs text-ink3">{outcomeSummary}</p>}
          <ul className="mt-3 flex flex-col gap-2 text-xs">
            {outcomes.slice(0, 8).map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 border-b border-[var(--rule)] pb-2 last:border-0 last:pb-0">
                <span>
                  <span className="font-medium">{o.title}</span>{" "}
                  <span className="text-ink3">· {o.label}</span>
                </span>
                <span
                  className={`tabular shrink-0 ${
                    !o.measured ? "text-ink3" : (o.movement ?? 0) > 0 ? "text-[var(--accent)]" : (o.movement ?? 0) < 0 ? "text-[var(--bad)]" : "text-ink3"
                  }`}
                >
                  {o.measured ? `${(o.movement ?? 0) > 0 ? "+" : ""}${((o.movement ?? 0) * 100).toFixed(0)}% skill` : "awaiting debates"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
