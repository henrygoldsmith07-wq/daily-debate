"use client";

import { useCallback, useEffect, useState } from "react";
import { RATER_GUIDANCE } from "@/lib/corpusAdjudication";
import { EVAL_DIMENSIONS } from "@/lib/debateEvaluation";

interface RateItem {
  id: string;
  transcript: string;
  topic: string | null;
}

type ScoreMap = Partial<Record<string, number>>;

const DIMENSION_LABELS: Record<string, string> = {
  evidenceQuality: "Evidence quality",
  reasoning: "Reasoning",
  relevance: "Relevance",
  rebuttalQuality: "Rebuttal quality",
  logicalValidity: "Logical validity",
  sourceQuality: "Source quality",
};

function ScoreColumn({
  title,
  scores,
  onChange,
}: {
  title: string;
  scores: ScoreMap;
  onChange: (dim: string, value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink3">{title}</p>
      {EVAL_DIMENSIONS.map((dim) => (
        <label key={dim} className="flex items-center justify-between gap-2 text-xs">
          <span className="text-ink3">{DIMENSION_LABELS[dim] ?? dim}</span>
          <span className="flex gap-1" role="radiogroup" aria-label={`${title} ${DIMENSION_LABELS[dim] ?? dim}`}>
            {[1, 2, 3, 4, 5].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => onChange(dim, v)}
                aria-pressed={scores[dim] === v}
                className={`h-6 w-6 rounded border text-xs tabular ${
                  scores[dim] === v
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "border-[var(--rule)] text-ink3 hover:border-ink3"
                }`}
              >
                {v}
              </button>
            ))}
          </span>
        </label>
      ))}
    </div>
  );
}

export default function RateForm() {
  const [item, setItem] = useState<RateItem | null>(null);
  const [emptyNote, setEmptyNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ratedCount, setRatedCount] = useState<number | null>(null);
  const [scoresA, setScoresA] = useState<ScoreMap>({});
  const [scoresB, setScoresB] = useState<ScoreMap>({});
  const [winner, setWinner] = useState<"a" | "b" | "tie">("tie");
  const [confidence, setConfidence] = useState(0.8);
  const [rationale, setRationale] = useState("");

  const loadNext = useCallback(async () => {
    setLoading(true);
    setError(null);
    setEmptyNote(null);
    try {
      const res = await fetch("/api/corpus/rate", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load an item.");
      if (data.myRatingsCount !== undefined) setRatedCount(data.myRatingsCount);
      if (!data.item) {
        setItem(null);
        setEmptyNote(data.note ?? "No unrated items available.");
      } else {
        setItem(data.item);
        setScoresA({});
        setScoresB({});
        setWinner("tie");
        setConfidence(0.8);
        setRationale("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load an item.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred so the effect body itself performs no synchronous state updates.
    const t = setTimeout(() => void loadNext(), 0);
    return () => clearTimeout(t);
  }, [loadNext]);

  async function submit() {
    if (!item) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/corpus/rate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ corpusId: item.id, scores_a: scoresA, scores_b: scoresB, winner, confidence, rationale }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit your rating.");
      void loadNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit your rating.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="surface-card p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold">Rater guidance</h2>
          {ratedCount !== null && <p className="tabular text-xs text-ink3">{ratedCount} rated by you</p>}
        </div>
        <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-ink3">{RATER_GUIDANCE}</p>
        <p className="mt-2 text-xs text-ink3">
          Sides are anonymised — you never see who argued or which side was the AI. Score both sides honestly.
        </p>
      </div>

      {loading ? (
        <p className="text-center text-sm text-ink3">Loading…</p>
      ) : !item ? (
        <div className="surface-card p-8 text-center">
          <p className="text-sm text-ink3">{emptyNote}</p>
        </div>
      ) : (
        <div className="surface-card flex flex-col gap-5 p-5">
          {item.topic && <p className="text-xs uppercase tracking-wide text-ink3">Topic area: {item.topic}</p>}
          <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg border border-[var(--rule)] bg-surface-2 p-4 text-sm leading-relaxed">
{item.transcript}
          </pre>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <ScoreColumn title="Side A" scores={scoresA} onChange={(d, v) => setScoresA((s) => ({ ...s, [d]: v }))} />
            <ScoreColumn title="Side B" scores={scoresB} onChange={(d, v) => setScoresB((s) => ({ ...s, [d]: v }))} />
          </div>

          <div className="flex flex-col gap-3 border-t border-[var(--rule)] pt-4">
            <div role="radiogroup" aria-label="Overall winner" className="flex gap-2">
              {(["a", "tie", "b"] as const).map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setWinner(w)}
                  aria-pressed={winner === w}
                  className={`btn flex-1 px-3 py-2 text-xs ${
                    winner === w ? "chip-elevated text-[var(--accent)]" : "btn-ghost"
                  }`}
                >
                  {w === "a" ? "Side A won" : w === "b" ? "Side B won" : "Too close to call"}
                </button>
              ))}
            </div>

            <label className="flex items-center justify-between gap-3 text-xs">
              <span className="text-ink3">Confidence in this verdict</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={confidence}
                onChange={(e) => setConfidence(Number(e.target.value))}
                className="w-40 accent-[var(--accent)]"
                aria-valuetext={confidence.toFixed(2)}
              />
              <span className="tabular w-10 text-right text-ink3">{confidence.toFixed(2)}</span>
            </label>

            <textarea
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="Optional: one line on what decided it…"
              aria-label="Rationale"
              className="w-full resize-none rounded-lg border border-[var(--rule)] bg-transparent px-3 py-2 text-sm"
            />

            {error && (
              <p role="alert" className="text-xs text-[var(--bad)]">
                {error}
              </p>
            )}

            <button type="button" onClick={submit} disabled={submitting} className="btn btn-primary px-4 py-2 text-sm disabled:opacity-40">
              {submitting ? "Submitting…" : "Submit & rate next"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
