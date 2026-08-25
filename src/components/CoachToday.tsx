"use client";

import { useCallback, useEffect, useState } from "react";

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
  attempt_score?: number | null;
}

interface OutcomeRow {
  id: string;
  label: string;
  title: string;
  assignedDate: string;
  attemptScore: number | null;
  movement: number | null;
  measured: boolean;
}

function Bar({ label, score }: { label: string; score: number | null }) {
  const filled = score === null ? 0 : Math.round(score / 10);
  const blocks = "█".repeat(filled) + "░".repeat(10 - filled);
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-24 shrink-0 text-ink3">{label}</span>
      <span className="tabular w-28 tracking-tight text-[var(--foreground)]" aria-label={`${label} ${score ?? "no data"} of 100`}>
        {score === null ? "—".repeat(11) : blocks}
      </span>
      <span className="tabular w-8 text-right font-medium">{score ?? "—"}</span>
    </div>
  );
}

export default function CoachToday() {
  const [dims, setDims] = useState<Dim[]>([]);
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [focusReason, setFocusReason] = useState<string>("");
  const [debatesAnalysed, setDebatesAnalysed] = useState<number | null>(null);
  const [outcomes, setOutcomes] = useState<OutcomeRow[]>([]);
  const [outcomeSummary, setOutcomeSummary] = useState<string | null>(null);
  const [attemptText, setAttemptText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ score: number; signals: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      setAssignment(todayData.assignment);
      setFocusReason(todayData.focusReason ?? "");
      setDebatesAnalysed(todayData.debatesAnalysed ?? null);
      if (outcomesRes.ok) {
        const o = await outcomesRes.json();
        setOutcomes(o.outcomes ?? []);
        setOutcomeSummary(o.summary?.note ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Coach unavailable.");
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

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
      if (!res.ok) throw new Error(data.error || "Failed to score your attempt.");
      setFeedback({ score: data.attemptScore, signals: data.signals });
      setAttemptText("");
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to score your attempt.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ARGUMENT SKILL PROFILE */}
      <section className="surface-card p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Argument skill profile</h2>
          {debatesAnalysed !== null && (
            <span className="tabular text-xs text-ink3">{debatesAnalysed} debates analysed</span>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          {dims.map((d) => (
            <Bar key={d.key} label={d.label} score={d.score} />
          ))}
        </div>
      </section>

      {/* Today's training focus */}
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
              <p className="text-sm font-semibold">Attempt scored: {feedback.score}/100</p>
              <ul className="mt-1 list-inside list-disc text-xs text-ink3">
                {feedback.signals.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-ink3">
                Skill movement gets measured against your next debates — keep debating and check back.
              </p>
            </div>
          ) : assignment.status === "attempted" && assignment.attempt_score != null ? (
            <p className="text-sm text-ink3" role="status">
              Attempt scored: {assignment.attempt_score}/100. Movement is tracked against upcoming debates.
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
                {submitting ? "Scoring…" : "Submit attempt for scoring"}
              </button>
            </>
          )}
        </section>
      ) : (
        !error && (
          <section className="surface-card p-5 text-sm text-ink3" role="status">
            {focusReason || "Complete a debate to unlock today's training focus."}
          </section>
        )
      )}

      {/* Outcomes */}
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
