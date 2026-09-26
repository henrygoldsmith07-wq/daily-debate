import { createServiceClient } from "@/lib/backend/server";
import { computeCorpusMetrics, type MetricItem, type MetricRating } from "@/lib/corpusMetrics";
import { POPULATION_TARGET_ITEMS, VALIDATION_STAGES, validationStageForCoverage } from "@/lib/corpus";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Corpus metrics",
  description: "Published evaluation metrics for Daily Debate's human-rated debate corpus.",
};

function fmt(g: { estimate: number | null; ciLower: number | null; ciUpper: number | null; n: number; state: string }): string {
  if (g.state === "insufficient" || g.estimate === null) return "—";
  return `${g.estimate}%`;
}

function ciStr(g: { estimate: number | null; ciLower: number | null; ciUpper: number | null; n: number }): string {
  if (g.ciLower === null || g.ciUpper === null) return `n=${g.n}`;
  return `${g.estimate}% CI [${g.ciLower}–${g.ciUpper}] · n=${g.n}`;
}

export default async function MetricsPage() {
  const service = createServiceClient();
  const [{ data: items }, { data: ratings }] = await Promise.all([
    service.from("corpus_items").select("id, side_mapping, status"),
    service
      .from("corpus_ratings")
      .select("corpus_id, rater_id, winner, confidence, scores_a, scores_b, presented_first, corrections"),
  ]);
  const m = computeCorpusMetrics((items ?? []) as MetricItem[], (ratings ?? []) as unknown as MetricRating[]);
  const stage = validationStageForCoverage({
    itemsWithTwoPlusRatings: m.corpus.itemsWithTwoPlusRatings,
    itemsWithThreePlusRatings: m.corpus.itemsWithThreePlusRatings,
  });

  const targetPct = Math.min(100, Math.round((m.corpus.items / POPULATION_TARGET_ITEMS) * 100));

  return (
    <AppShell width="narrow">
      <PageHeader
        eyebrow="Trust & research"
        title="Corpus metrics"
        description="Every metric carries an evidence state (insufficient / early / reportable). Dashes mean not enough data."
      />

      <section className="surface-card flex flex-col gap-3 p-5">
        <h2 className="text-sm font-semibold">Campaign progress</h2>
        <p className="text-xs font-medium text-[var(--accent)]">{VALIDATION_STAGES[stage].label}</p>
        <p className="tabular text-xs text-ink3">
          {m.corpus.items} / {POPULATION_TARGET_ITEMS} debates · {m.corpus.itemsWithTwoPlusRatings} with ≥2 ratings · {m.corpus.itemsWithThreePlusRatings} with ≥3
        </p>
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${targetPct}%` }} />
        </div>
      </section>

      <section className="surface-card p-5" aria-labelledby="hv-heading">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="hv-heading" className="text-sm font-semibold">Human validation status</h2>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
              m.humanValidation.groundTruth.ready ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"
            }`}
          >
            {m.humanValidation.groundTruth.ready ? "pilot consensus gate met" : "pilot consensus gate pending"}
          </span>
        </div>
        <p className="mt-1 text-xs text-ink3">
          {m.humanValidation.consensusReadyItems} consensus-ready items · {m.humanValidation.unresolvedDisagreements} unresolved
          disagreements · mean winner κ {m.humanValidation.meanWinnerKappa ?? "—"} · score-gap dispersion (mean SD){" "}
          {m.humanValidation.meanScoreGapDispersion ?? "—"} · mean confidence {m.humanValidation.meanRaterConfidence ?? "—"}
        </p>
        <p className="mt-2 text-xs text-ink3">
          Pilot consensus is not external validity. Stage 2 requires 500 debates with ≥3 independent ratings; Stage 3 requires 1,000+ with ≥3 and balanced coverage.
        </p>
        <p className="mt-1 text-xs text-ink3">
          {m.corpus.itemsWithTwoPlusRatings} independently rated (≥2) · {m.corpus.adjudicatedItems} adjudicated ·{" "}
          {m.corpus.correctedRatings} corrected (audited) · presentation balance{" "}
          {m.corpus.presentation.balance ?? "—"} (A-first {m.corpus.presentation.firstA} / B-first{" "}
          {m.corpus.presentation.firstB}
          {m.corpus.presentation.unknown ? ` / unknown ${m.corpus.presentation.unknown}` : ""})
        </p>
        {!m.humanValidation.groundTruth.ready && (
          <p className="mt-1 text-xs text-amber-700">
            Judge-vs-human numbers below are provisional until: {m.humanValidation.groundTruth.reasons.join("; ")}.
          </p>
        )}
      </section>

      <section className="surface-card p-5">
        <h2 className="text-sm font-semibold">Judge quality</h2>
        <div className="mt-2">
          {[
            { label: "Human consensus (unanimous)", metric: m.humanConsensusUnanimous },
            { label: "Judge vs consensus agreement", metric: m.judgeVsConsensus },
            { label: "Close-debate accuracy", metric: m.closeDebateAccuracy },
            { label: "Position-swap stability", metric: m.positionSwapStability },
            { label: "Citation-flag rate", metric: m.citationFlagRate },
          ].map((row) => (
            <div key={row.label} className="border-t border-[var(--rule)] py-3 first:border-0">
              <div className="flex items-baseline justify-between">
                <p className="text-sm font-medium">{row.label}</p>
                <span className={`tabular text-lg font-semibold ${row.metric.state === "reportable" ? "" : row.metric.state === "early" ? "opacity-60" : "opacity-30"}`}>
                  {fmt(row.metric)}
                </span>
              </div>
              <p className="text-xs text-ink3">{ciStr(row.metric)} · {row.metric.state}</p>
            </div>
          ))}
          <div className="border-t border-[var(--rule)] py-3">
            <div className="flex items-baseline justify-between">
              <p className="text-sm font-medium">Calibration error (ECE)</p>
              <span className="tabular text-lg font-semibold">{m.calibrationError === null ? "—" : m.calibrationError.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
