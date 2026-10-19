"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DRILL_FEEDBACK_COPY, normaliseDrillSignals } from "@/lib/drillFeedback";

// Inline drill attempt for the Today page's priority card. The same submission
// contract as CoachToday's form (/api/coach/today/attempt): the deterministic
// rubric stays server-side, the learner sees observable signals only, and
// skill movement is measured in later debates — never a score on this screen.

export default function InlineDrillAttempt({ assignmentId }: { assignmentId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ signals: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!assignmentId || submitting || text.trim().length < 10) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/coach/today/attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId, text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || DRILL_FEEDBACK_COPY.errorFallback);
      setFeedback({ signals: normaliseDrillSignals(data.signals) });
      setText("");
      // The assignment is now attempted; refresh so the priority card and any
      // other server-rendered loop state (learner model, drill outcome rows)
      // agree with what just happened.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : DRILL_FEEDBACK_COPY.errorFallback);
    } finally {
      setSubmitting(false);
    }
  }

  if (feedback) {
    return (
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
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder="Write your drill attempt here…"
        aria-label="Drill attempt"
        aria-describedby="drill-attempt-hint"
        className="w-full resize-none rounded-lg border border-[var(--rule)] bg-transparent px-3 py-2 text-sm"
      />
      <p id="drill-attempt-hint" className="text-xs opacity-70">
        {text.trim().length < 10 ? "Write at least 10 characters to submit." : "Ready to submit."}
      </p>
      {error && (
        <p role="alert" className="text-xs text-[var(--bad)]">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={submit}
        disabled={submitting || text.trim().length < 10}
        className="btn btn-primary self-start px-4 py-2 text-sm disabled:opacity-40"
      >
        {submitting ? DRILL_FEEDBACK_COPY.submitBusy : DRILL_FEEDBACK_COPY.submitIdle}
      </button>
      <p className="text-[10px] leading-4 text-ink3">{DRILL_FEEDBACK_COPY.note}</p>
    </div>
  );
}
