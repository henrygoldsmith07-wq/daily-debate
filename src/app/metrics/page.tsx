import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/server";
import { computeCorpusMetrics, type MetricItem, type MetricRating } from "@/lib/corpusMetrics";
import AppHeader from "@/components/AppHeader";

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
    service.from("corpus_items").select("id, side_mapping"),
    service.from("corpus_ratings").select("corpus_id, rater_id, winner, confidence, scores_a, scores_b"),
  ]);
  const m = computeCorpusMetrics((items ?? []) as MetricItem[], (ratings ?? []) as unknown as MetricRating[]);

  const targetPct = Math.min(100, Math.round((m.corpus.items / 1000) * 100));

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <main id="main" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
        <div>
          <p className="text-xs uppercase tracking-wide text-ink3">Evaluation</p>
          <h1 className="text-2xl font-semibold tracking-tight">Corpus metrics</h1>
          <p className="mt-2 text-sm text-ink3">
            Every metric carries an evidence state (insufficient / early / reportable). Dashes mean not enough data.
          </p>
        </div>

        <section className="surface-card flex flex-col gap-3 p-5">
          <h2 className="text-sm font-semibold">Campaign progress</h2>
          <p className="tabular text-xs text-ink3">
            {m.corpus.items} / 1000 debates · {m.corpus.ratings} judgements · {m.corpus.raters} raters
          </p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${targetPct}%` }} />
          </div>
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
      </main>
    </div>
  );
}
