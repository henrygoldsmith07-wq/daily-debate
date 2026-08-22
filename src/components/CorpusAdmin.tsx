"use client";

import { useCallback, useEffect, useState } from "react";

interface ReliabilityReport {
  totalItems: number;
  fullyRatedItems: number;
  ratedItems: number;
  agreementReady: number;
  needsAdjudication: number;
  adjudicationQueue: Array<{ id: string; verdicts: string[] }>;
  meanWinnerKappa: number | null;
  perDimensionIcc: Record<string, number | null>;
  population: {
    targetItems: number;
    remainingToTarget: number;
    cellsNeedingCoverage: string[];
    meanRaterConfidence: number | null;
  };
  strata: {
    byLength: Record<string, number>;
    byAbility: Record<string, number>;
    bySubject: Record<string, number>;
  };
}

interface ItemReview {
  item: { id: string; transcript: string; topic: string | null; status: string };
  ratings: Array<{ rater: string; winner: string; confidence: number | null; rationale: string }>;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-[var(--rule)] bg-surface-2 p-3">
      <p className="text-xs font-medium">{label}</p>
      <p className="tabular text-sm text-ink3">{value}</p>
    </div>
  );
}

export default function CorpusAdmin() {
  const [report, setReport] = useState<ReliabilityReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [review, setReview] = useState<ItemReview | null>(null);
  const [comparisonLimit, setComparisonLimit] = useState(3);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/corpus/reliability", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load reliability report.");
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load reliability report.");
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function openReview(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      setReview(null);
      return;
    }
    setExpandedId(id);
    setReview(null);
    try {
      const res = await fetch(`/api/corpus/item/${id}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load item.");
      setReview(data);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to load item.");
    }
  }

  async function adjudicate(corpusId: string, winner?: "a" | "b" | "tie") {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/corpus/adjudicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(winner ? { corpusId, winner } : { corpusId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Adjudication failed.");
      setNotice(`Adjudicated ${corpusId.slice(0, 8)}… → ${data.consensusWinner} (${data.basis})`);
      if (expandedId === corpusId) {
        setExpandedId(null);
        setReview(null);
      }
      void load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Adjudication failed.");
    } finally {
      setBusy(false);
    }
  }

  async function runComparison() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/corpus/system-comparison", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: comparisonLimit }),
      });
      const data = await res.json();
      if (!res.ok && !data.judged) throw new Error(data.error || "Comparison failed.");
      setNotice(
        data.judged
          ? `Judged ${data.judged}: judge agreed with humans on ${data.agree}/${data.judged} (${Math.round((data.agreementRate ?? 0) * 100)}%)${data.errors?.length ? ` · ${data.errors.length} failed` : ""}`
          : (data.note ?? "Nothing to compare yet."),
      );
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Comparison failed.");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="text-sm text-[var(--bad)]">{error}</p>;
  if (!report) return <p className="text-sm text-ink3">Loading reliability report…</p>;

  const pct = report.population.targetItems
    ? Math.min(100, Math.round((report.totalItems / report.population.targetItems) * 100))
    : 0;

  return (
    <div className="flex flex-col gap-6">
      {notice && (
        <p className="surface-card px-4 py-3 text-xs text-[var(--accent)]" role="status">
          {notice}
        </p>
      )}

      <section className="surface-card flex flex-col gap-3 p-5">
        <h2 className="text-sm font-semibold">Population progress</h2>
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Imported / target" value={`${report.totalItems} / ${report.population.targetItems}`} />
          <Stat label="Fully rated (≥2)" value={report.fullyRatedItems} />
          <Stat label="Agreement-ready" value={report.agreementReady} />
          <Stat label="Needs adjudication" value={report.needsAdjudication} />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Winner Cohen κ (pairs ≥5 items)" value={report.meanWinnerKappa ?? "—"} />
          <Stat label="Mean rater confidence" value={report.population.meanRaterConfidence ?? "—"} />
          <Stat label="Remaining to target" value={report.population.remainingToTarget} />
          <Stat label="Rated items" value={report.ratedItems} />
        </div>
        <div>
          <p className="mb-1 text-xs font-medium">Strata below minimum (recruit here)</p>
          {report.population.cellsNeedingCoverage.length ? (
            <div className="flex flex-wrap gap-1">
              {report.population.cellsNeedingCoverage.map((c) => (
                <span key={c} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs tabular text-amber-600">
                  {c}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-ink3">All canonical strata meet the minimum.</p>
          )}
        </div>
      </section>

      <section className="surface-card flex flex-col gap-3 p-5">
        <h2 className="text-sm font-semibold">Per-dimension ICC (items × raters)</h2>
        {Object.keys(report.perDimensionIcc).length ? (
          <table className="w-full text-left text-xs">
            <thead className="text-ink3">
              <tr>
                <th className="pb-1 font-medium">dimension:side</th>
                <th className="pb-1">ICC</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {Object.entries(report.perDimensionIcc).map(([key, icc]) => (
                <tr key={key} className="border-t border-[var(--rule)]">
                  <td className="py-1 pr-2">{key}</td>
                  <td className={`py-1 ${icc !== null && icc < 0.5 ? "text-amber-600" : ""}`}>{icc ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-xs text-ink3">Appears once at least three fully-rated items exist.</p>
        )}
      </section>

      <section className="surface-card flex flex-col gap-3 p-5">
        <h2 className="text-sm font-semibold">System-vs-human comparison</h2>
        <p className="text-xs text-ink3">
          Judges only agreement-ready items (humans agreed first). Each item is judged once; verdicts persist.
        </p>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs">
            Items
            <input
              type="number"
              min={1}
              max={10}
              value={comparisonLimit}
              onChange={(e) => setComparisonLimit(Number(e.target.value))}
              className="w-16 rounded border border-[var(--rule)] bg-transparent px-2 py-1 text-sm tabular"
              aria-label="Items to judge"
            />
          </label>
          <button type="button" onClick={runComparison} disabled={busy} className="btn btn-primary px-4 py-1.5 text-xs disabled:opacity-40">
            {busy ? "Running…" : "Run comparison"}
          </button>
        </div>
      </section>

      <section className="surface-card flex flex-col gap-3 p-5">
        <h2 className="text-sm font-semibold">Adjudication queue</h2>
        {report.adjudicationQueue.length === 0 ? (
          <p className="text-xs text-ink3">No disputed items. Raters agree so far.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {report.adjudicationQueue.map(({ id, verdicts }) => {
              const counts = verdicts.reduce<Record<string, number>>((acc, w) => ({ ...acc, [w]: (acc[w] ?? 0) + 1 }), {});
              const split = Object.entries(counts)
                .map(([w, n]) => `${w}×${n}`)
                .join(" · ");
              return (
                <li key={id} className="flex flex-col gap-2 rounded-lg border border-[var(--rule)] p-3">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="tabular text-ink3">
                      {id.slice(0, 8)}… · raters split: {split}
                    </span>
                    <span className="flex gap-2">
                      <button type="button" onClick={() => openReview(id)} className="btn btn-ghost px-2 py-1 text-xs">
                        {expandedId === id ? "Hide" : "Review"}
                      </button>
                      <button
                        type="button"
                        onClick={() => adjudicate(id)}
                        disabled={busy}
                        className="btn btn-ghost px-2 py-1 text-xs disabled:opacity-40"
                        title="Settle by rater majority"
                      >
                        Accept majority
                      </button>
                    </span>
                  </div>
                  {expandedId === id && (
                    <div className="flex flex-col gap-3 border-t border-[var(--rule)] pt-3">
                      {!review ? (
                        <p className="text-xs text-ink3">Loading transcript…</p>
                      ) : (
                        <>
                          <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-[var(--rule)] bg-surface-2 p-3 text-xs leading-relaxed">
{review.item.transcript}
                          </pre>
                          <ul className="flex flex-col gap-1 text-xs text-ink3">
                            {review.ratings.map((r) => (
                              <li key={r.rater}>
                                {r.rater}: <span className="font-medium text-[var(--foreground)]">{r.winner}</span> · confidence{" "}
                                {r.confidence ?? "—"}
                                {r.rationale ? ` — "${r.rationale}"` : ""}
                              </li>
                            ))}
                          </ul>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-ink3">Override:</span>
                            {(["a", "b", "tie"] as const).map((w) => (
                              <button
                                key={w}
                                type="button"
                                onClick={() => adjudicate(id, w)}
                                disabled={busy}
                                className="btn btn-ghost px-2 py-1 text-xs disabled:opacity-40"
                              >
                                {w}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
