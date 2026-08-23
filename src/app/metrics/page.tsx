import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/server";
import { computeCorpusMetrics, type MetricItem, type MetricRating } from "@/lib/corpusMetrics";
import AppHeader from "@/components/AppHeader";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Corpus metrics",
  description: "Published evaluation metrics for Daily Debate's human-rated debate corpus.",
};

function pct(value: number | null, digits = 0): string {
  return value === null ? "—" : `${value.toFixed(digits)}%`;
}

function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-[var(--rule)] py-3 first:border-0">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {sub && <p className="text-xs text-ink3">{sub}</p>}
      </div>
      <p className="tabular text-lg font-semibold">{value}</p>
    </div>
  );
}

export default async function MetricsPage() {
  // Aggregates only — no transcripts or identities leave the database.
  const service = createServiceClient();
  const [{ data: items }, { data: ratings }] = await Promise.all([
    service.from("corpus_items").select("id, side_mapping"),
    service.from("corpus_ratings").select("corpus_id, rater_id, winner, confidence, scores_a, scores_b"),
  ]);
  const m = computeCorpusMetrics((items ?? []) as MetricItem[], (ratings ?? []) as unknown as MetricRating[]);

  const targetPct = Math.min(100, Math.round((m.corpus.items / 1000) * 100));
  const judgedEnough = m.judgeVsConsensus.judged >= 30;

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <main id="main" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
        <div>
          <p className="text-xs uppercase tracking-wide text-ink3">Evaluation</p>
          <h1 className="text-2xl font-semibold tracking-tight">Corpus metrics</h1>
          <p className="mt-2 text-sm text-ink3">
            Published numbers for Daily Debate&apos;s human-rated debate corpus. Every metric is computed live from
            rated debates; a dash means that measurement does not yet have enough data to be claimed.
          </p>
        </div>

        {/* Campaign progress */}
        <section className="surface-card flex flex-col gap-3 p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Campaign progress</h2>
            <p className="tabular text-xs text-ink3">
              {m.corpus.items} / 1000 debates · {m.corpus.ratings} human judgements · {m.corpus.raters} raters
            </p>
          </div>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={1000}
            aria-valuenow={m.corpus.items}
          >
            <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${targetPct}%` }} />
          </div>
          <p className="tabular text-xs text-ink3">
            ≥2 ratings: {m.corpus.itemsWithTwoPlusRatings} · ≥3 ratings: {m.corpus.itemsWithThreePlusRatings} · target:
            3+ per debate
          </p>
        </section>

        {/* The published table */}
        <section className="surface-card p-5">
          <h2 className="text-sm font-semibold">Judge quality</h2>
          <div className="mt-2">
            <Row
              label="Human consensus agreement"
              sub={`${m.humanConsensusUnanimousPct === null ? "—" : `${m.corpus.itemsWithTwoPlusRatings} multi-rated debates`}: unanimous winner share (majority view: ${pct(m.humanConsensusMajorityPct, 1)})`}
              value={pct(m.humanConsensusUnanimousPct, 1)}
            />
            <Row
              label="Judge vs consensus agreement"
              sub={judgedEnough ? `${m.judgeVsConsensus.judged} judged debates` : "shown once ≥30 debates are judged"}
              value={judgedEnough ? pct(m.judgeVsConsensus.pct, 0) : "—"}
            />
            <Row
              label="Close-debate accuracy"
              sub={`judge accuracy on debates humans scored within ${0.75} Likert points (${m.closeDebateAccuracy.n} so far)`}
              value={m.closeDebateAccuracy.n >= 20 ? pct(m.closeDebateAccuracy.pct) : "—"}
            />
            <Row
              label="Position-swap stability"
              sub={`mirrored-transcript re-judgements (${m.positionSwapStability.n} probed)`}
              value={m.positionSwapStability.n >= 20 ? pct(m.positionSwapStability.pct) : "—"}
            />
            <Row
              label="Calibration error (ECE)"
              sub="system-verdict confidence vs correctness, 10 bins"
              value={m.calibrationError === null ? "—" : m.calibrationError.toFixed(2)}
            />
            <Row
              label="Citation-flag rate on judged graphs"
              sub={`${m.unsupportedSourceFlagRate.flagged} flagged of ${m.unsupportedSourceFlagRate.citedNodes} cited evidence nodes`}
              value={pct(m.unsupportedSourceFlagRate.pct, 1)}
            />
          </div>
          <p className="mt-4 text-xs leading-relaxed text-ink3">
            These are corpus metrics, not marketing claims: they update as real blind ratings arrive and every number is
            reproducible from the stored ratings. Judge-side rows require an admin comparison run over agreement-ready
            items. Help populate the corpus at{" "}
            <Link href="/rate" className="text-[var(--accent)] hover:underline">
              /rate
            </Link>
            .
          </p>
        </section>
      </main>
    </div>
  );
}
