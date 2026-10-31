"use client";

import { useState } from "react";
import type { ExploreKind, ReportReason } from "@/lib/explore";

const REASONS: { value: ReportReason; label: string }[] = [
  { value: "abuse", label: "Abusive or hateful" },
  { value: "personal_info", label: "Shares someone's personal details" },
  { value: "spam", label: "Spam or nonsense" },
  { value: "other", label: "Something else" },
];

/**
 * Report a published debate (migration 043). Collapsed by default so it never
 * competes with reading or voting. One report per reader; three from
 * different accounts take the debate off Explore, which the confirmation says
 * rather than promising a review that may not happen.
 */
export default function ReportDebate({ kind, id }: { kind: ExploreKind; id: string }) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!reason) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/explore/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, id, reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not send your report.");
      setDone(
        data.outcome === "taken_down"
          ? "Thanks. Enough readers reported this debate, so it has been taken off Explore."
          : data.outcome === "already_reported"
            ? "You have already reported this debate."
            : "Thanks, your report is in. Debates reported by several readers come off Explore.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your report.");
    } finally {
      setSending(false);
    }
  }

  return (
    <details className="explore-report" data-testid="explore-report">
      <summary>Report this debate</summary>
      {done ? (
        <p className="explore-report-done" role="status">{done}</p>
      ) : (
        <fieldset className="explore-report-form" disabled={sending}>
          <legend className="sr-only">Why are you reporting it?</legend>
          {REASONS.map((option) => (
            <label key={option.value} className="explore-report-reason">
              <input type="radio" name={`report-${id}`} value={option.value} checked={reason === option.value} onChange={() => setReason(option.value)} />
              {option.label}
            </label>
          ))}
          <button type="button" className="btn btn-secondary px-3 py-1.5 text-xs" onClick={() => void send()} disabled={!reason || sending}>
            {sending ? "Sending…" : "Send report"}
          </button>
          {error && <p className="text-xs text-[var(--bad)]" role="alert">{error}</p>}
        </fieldset>
      )}
    </details>
  );
}
