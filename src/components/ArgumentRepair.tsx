"use client";

import { useState } from "react";
import type { ArgGraph } from "@/lib/argGraph";
import { pickRepairTarget, scoreRepair, type RepairScore } from "@/lib/argumentRepair";

export default function ArgumentRepair({ graph }: { graph: ArgGraph }) {
  const target = pickRepairTarget(graph);
  const [draft, setDraft] = useState("");
  const [result, setResult] = useState<RepairScore | null>(null);

  if (!target) return null;

  function checkRepair() {
    setResult(scoreRepair(target!, draft));
  }

  return (
    <section className="repair-panel surface-card flex flex-col gap-4 p-5" aria-labelledby="repair-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="repair-overline">One-minute repair</p>
          <h2 id="repair-title" className="mt-1 text-xl font-semibold tracking-tight">Repair the weak link</h2>
          <p className="mt-1 max-w-xl text-sm leading-6 text-ink3">
            Your Argument DNA found one observable move to practise. Rewrite it now and get a transparent, skill-specific check.
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
          disabled={draft.trim().length < 10}
          className="btn btn-primary px-4 py-2 text-sm disabled:opacity-40"
        >
          {result ? "Check this version" : "Check my repair"} <span aria-hidden="true">→</span>
        </button>
      </div>

      {result && (
        <div className="repair-result" role="status" aria-live="polite">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold">Repair signal</p>
            <p className="tabular text-lg font-bold">{result.score}<span className="text-xs font-medium text-ink3">/100</span></p>
          </div>
          <ul className="mt-2 list-inside list-disc text-xs leading-5 text-ink3">
            {result.signals.map((signal) => <li key={signal}>{signal}</li>)}
          </ul>
          <p className="mt-2 text-xs text-ink3">Use the signal as a next move, not as a verdict on your ability.</p>
        </div>
      )}
    </section>
  );
}
