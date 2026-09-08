"use client";

import { useState } from "react";
import type { ArgGraph } from "@/lib/argGraph";
import type { RepairTarget } from "@/lib/argumentRepair";
import { pickRepairTarget, scoreRepair, type RepairScore } from "@/lib/argumentRepair";
import { trackEvent } from "@/lib/trackClientEvent";

interface RepairFeedback {
  score: number;
  signals: string[];
  succeeded: boolean;
  feedback: string;
}

export default function ArgumentRepair({
  graph,
  debateId,
  presetTarget,
  onCompleted,
}: {
  graph: ArgGraph;
  /** When present, the repair is scored server-side and remembered. */
  debateId?: string;
  /** Pre-picked target from the result snapshot (server-derived). */
  presetTarget?: RepairTarget | null;
  onCompleted?: (result: RepairFeedback) => void;
}) {
  const target = presetTarget ?? pickRepairTarget(graph);
  const [draft, setDraft] = useState("");
  const [result, setResult] = useState<RepairScore | null>(null);
  const [persisted, setPersisted] = useState<RepairFeedback | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!target) return null;

  async function checkRepair() {
    const local = scoreRepair(target!, draft);
    setResult(local);
    if (!debateId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/solo/${debateId}/repair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rewrite: draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to record the repair.");
      setPersisted({
        score: data.score,
        signals: data.signals,
        succeeded: data.succeeded,
        feedback: data.feedback,
      });
      onCompleted?.(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record the repair.");
    } finally {
      setSubmitting(false);
    }
  }

  const shown = persisted ?? (result ? { ...result, succeeded: result.score >= 60, feedback: null } : null);

  return (
    <section className="repair-panel surface-card flex flex-col gap-4 p-5" aria-labelledby="repair-title" data-testid="repair-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="repair-overline">One-minute repair</p>
          <h2 id="repair-title" className="mt-1 text-xl font-semibold tracking-tight">Repair the weak link</h2>
          <p className="mt-1 max-w-xl text-sm leading-6 text-ink3">
            Rewrite this one move from your debate and get an explainable, skill-specific check. Your debate score never changes.
          </p>
        </div>
        <span className="pill border-[var(--speak)]/30 bg-[var(--speak-soft)] text-[var(--speak)]">{target.label}</span>
      </div>

      <div className="repair-target">
        <p className="repair-target-label">From your debate</p>
        <p className="mt-1 text-sm leading-6 text-ink2">“{target.sourceText}”</p>
      </div>

      <div>
        <p className="text-sm font-semibold text-ink">{target.title}</p>
        <p className="mt-1 text-sm leading-6 text-ink3">{target.prompt}</p>
      </div>

      <textarea
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          if (result) setResult(null);
          if (persisted) setPersisted(null);
        }}
        rows={4}
        placeholder="Write your improved move here…"
        aria-label="Improved argument move"
        className="field resize-none text-sm leading-6"
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-ink3">{draft.trim().length} characters · practice only, score unchanged</span>
        <button
          type="button"
          onClick={checkRepair}
          disabled={draft.trim().length < 10 || submitting}
          className="btn btn-primary px-4 py-2 text-sm disabled:opacity-40"
          data-testid="submit-repair"
        >
          {submitting ? "Recording…" : persisted ? "Check this version" : "Submit repair"} <span aria-hidden="true">→</span>
        </button>
      </div>
      {error && <p className="text-sm text-[var(--bad)]" role="alert">{error}</p>}

      {shown && (
        <div className="repair-result" role="status" aria-live="polite" data-testid="repair-feedback">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold">{persisted ? (persisted.succeeded ? "Repair recorded" : "Not there yet — recorded") : "Repair signal"}</p>
            <p className="tabular text-lg font-bold">{shown.score}<span className="text-xs font-medium text-ink3">/100</span></p>
          </div>
          {"feedback" in shown && shown.feedback && (
            <p className="mt-1 text-sm text-ink2">{shown.feedback}</p>
          )}
          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-ink3">
            {shown.succeeded ? "What worked" : "What to add"}
          </p>
          <ul className="mt-1 list-inside list-disc text-xs leading-5 text-ink3">
            {shown.signals.map((signal) => <li key={signal}>{signal}</li>)}
          </ul>
          <p className="mt-2 text-xs text-ink3">Use the signals as a next move, not as a verdict on your ability. Your next debates will test whether the fix sticks.</p>
        </div>
      )}
    </section>
  );
}

/** Compact CTA that scrolls to / focuses the repair exercise. */
export function FixThisNowButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        // Funnel: "repair started" is the click on this CTA; completion is
        // recorded server-side when a rewrite is actually submitted.
        trackEvent("repair_started", {});
        onClick();
      }}
      className="btn btn-primary px-6 py-3 text-sm uppercase tracking-wide"
      data-testid="fix-this-now"
    >
      Fix this now <span aria-hidden="true">→</span>
    </button>
  );
}
