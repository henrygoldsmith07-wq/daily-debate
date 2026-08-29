import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import { HUMAN_CORPUS, HUMAN_CORPUS_AUDIT, corpusStats, ratingMatrix, fleissKappa, syntheticCorpus } from "@/lib/humanCorpus";
import { evaluateFallacyDetection, FALLACY_BENCHMARK_CASES } from "@/lib/fallacyBenchmark";
import { runAllProbesOffline } from "@/lib/judgeInvariance";
import { dailyDebateEvaluation } from "@/lib/debateEvaluation";
import { syntheticEvalCorpus, systemVerdictsTrackingHumans } from "@/lib/evalFixtures";
import { TRANSCRIPTS } from "@/lib/benchmark.fixtures";

export const dynamic = "force-dynamic";

function meanPearson(report: ReturnType<typeof dailyDebateEvaluation>): string {
  if (!report.comparison.length) return "—";
  return (report.comparison.reduce((s, c) => s + c.pearson, 0) / report.comparison.length).toFixed(2);
}

function meanMae(report: ReturnType<typeof dailyDebateEvaluation>): string {
  if (!report.comparison.length) return "—";
  return (report.comparison.reduce((s, c) => s + c.mae, 0) / report.comparison.length).toFixed(2);
}

export default function BenchmarkPage() {
  const syn = syntheticCorpus({ n: 200, seed: 42, agreement: "medium" });
  const statsFixture = corpusStats(HUMAN_CORPUS);
  const statsSyn = corpusStats(syn);
  const probes = runAllProbesOffline(TRANSCRIPTS.map((t) => t.transcript));
  const mat = ratingMatrix(syn.slice(0, 40));
  const kappaHint = fleissKappa(mat);
  const fallacyReport = evaluateFallacyDetection(FALLACY_BENCHMARK_CASES);
  const cohenMean = statsFixture.byRaterPair.length ? statsFixture.byRaterPair.reduce((a, p) => a + p.cohenKappa, 0) / statsFixture.byRaterPair.length : null;

  // Full evaluation pipeline over the deterministic synthetic scaffold:
  // reliability first, then system-vs-human comparison, calibration, and bias.
  const evalCorpus = syntheticEvalCorpus();
  const evalReport = dailyDebateEvaluation(evalCorpus, systemVerdictsTrackingHumans(evalCorpus));
  const tiltedReport = dailyDebateEvaluation(evalCorpus, systemVerdictsTrackingHumans(evalCorpus, true));

  return (
    <AppShell>
      <PageHeader
        eyebrow="Benchmark"
        title="Judge benchmark"
        description={
          <>
            Mock-harness numbers run on every CI turn (no keys needed). Live-model numbers appear when
            OPENROUTER_API_KEY / ANTHROPIC_API_KEY are set — see{" "}
            <code className="rounded bg-surface-2 px-1 py-0.5 text-xs">scripts/benchmark-judges.mjs</code>.
          </>
        }
      />

      <section className="surface-card p-5">
        <h2 className="text-sm font-semibold">Corpus</h2>
        <p className="mt-1 text-sm text-ink3">
          The repository contains {HUMAN_CORPUS.length} labelled fixture debates. Their rater-shaped records are not independently proven human
          annotations in this checkout, so they are useful for regression tests but do not establish judge validity. The pipeline scales to thousands
          (Postgres table <code className="text-xs">benchmark_corpus</code>) once provenance is recorded.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-xl border border-[var(--rule)] bg-surface-2 p-3">
              <p className="font-medium">Labelled fixtures (offline)</p>
              <p className="tabular text-ink3">n={statsFixture.n} · Fleiss κ={statsFixture.fleissKappa.toFixed(3)} · α={statsFixture.krippendorffAlpha.toFixed(3)}</p>
              <p className="tabular text-ink3">Cohen κ (mean pairwise)={cohenMean === null ? "—" : cohenMean.toFixed(3)}</p>
              <p className="tabular text-ink3">Labels: a={statsFixture.labelDist.a} b={statsFixture.labelDist.b} tie={statsFixture.labelDist.tie}</p>
              <p className="mt-1 text-amber-700">Provenance: {HUMAN_CORPUS_AUDIT.status}; human-validity claim: {HUMAN_CORPUS_AUDIT.canClaimHumanValidity ? "allowed" : "not established"}</p>
          </div>
          <div className="rounded-xl border border-[var(--rule)] bg-surface-2 p-3">
            <p className="font-medium">Synthetic scaffold (200, seed 42)</p>
            <p className="tabular text-ink3">n={statsSyn.n} · Fleiss κ={statsSyn.fleissKappa.toFixed(3)} · α={statsSyn.krippendorffAlpha.toFixed(3)}</p>
            <p className="tabular text-ink3">Illustrates κ≈{kappaHint.toFixed(2)} on medium-agreement synthetic (not reported as real)</p>
          </div>
        </div>
        <p className="mt-2 text-xs text-ink3">
          Reliability: Fleiss κ (N raters), pairwise Cohen κ, and Krippendorff α are computed over the same rating matrix and reported together.
          Judge-vs-human correlation is Pearson + Spearman over encoded labels (a=1, b=−1, tie=0) plus raw agreement. Calibration is ECE + Brier over
          score-gap bins (see <code className="text-xs">humanCorpus.calibrationReport</code>).
        </p>
      </section>

      <section className="surface-card p-5">
        <h2 className="text-sm font-semibold">Invariance & bias probes (offline mock)</h2>
        <p className="mt-1 text-xs text-ink3">Deterministic mock judge over the {TRANSCRIPTS.length} fixtures — all 10 probes must show 0 flips before live-model runs.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-ink3">
              <tr><th className="pb-2 font-medium">Probe</th><th className="pb-2">Flips</th><th className="pb-2">p</th><th className="pb-2">OK</th></tr>
            </thead>
            <tbody className="tabular">
              {probes.map((r) => (
                <tr key={r.probeId} className="border-t border-[var(--rule)]">
                  <td className="py-2 pr-2">{r.label}</td>
                  <td className="py-2">{r.flips}/{r.n}</td>
                  <td className="py-2">{r.pValue.toFixed(3)}</td>
                  <td className="py-2">{r.ok ? "✓" : "✗"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink3">
          Live: the same probes call OpenRouter + Anthropic twice per transcript (transformed vs original) and report flip-rate + exact binomial p-value with
          effect size. Run <code className="text-xs">node scripts/benchmark-judges.mjs --bias</code> with keys set.
        </p>
      </section>

      <section className="surface-card p-5">
        <h2 className="text-sm font-semibold">Ensemble & uncertainty</h2>
        <p className="mt-1 text-sm text-ink3">
          When both judges are configured, the live verdict is an ensemble: majority winner, averaged scores, tie threshold {5} points, and explicit confidence
          (from gap + agreement) with a 95% CI over the gap and a posterior over winner. Tiny gaps are reported as ties — no false precision.
        </p>
        <p className="mt-2 text-xs text-ink3">Single-judge fallback is unchanged; the public report shows per-judge latencies and whether the ensemble was used.</p>
      </section>

      <section className="surface-card p-5">
        <h2 className="text-sm font-semibold">Evidence & graph</h2>
        <p className="mt-1 text-sm text-ink3">
          Every cited/strong evidence node must carry a real-institution citation (offline allowlist + live homepage fetch). Judge-time verification checks
          reachability, freshness (stale &gt;3y), distortion (claim stronger than evidence), cherry-picking (broad claim / single source), and supports vs
          tangential vs unsupported at the claim→citation level. Scores are tiered by source quality (peer-reviewed &gt; think-tank &gt; unknown).
        </p>
        <p className="mt-2 text-sm text-ink3">
          Fallacies use an evaluated classifier (precision/recall against the labeled mini-corpus), not just a lexicon. The graph tracks dropped arguments
          (auto-detected), concessions, contradictions, burden shifts, and argument evolution across rounds; the UI lets you patch the graph and keeps an
          audit trail (<code className="text-xs">graphEnrichers.applyGraphEdits</code>).
        </p>
      </section>

      <section className="surface-card p-5">
        <h2 className="text-sm font-semibold">Fallacy detector (offline evaluation)</h2>
        <p className="mt-1 text-xs text-ink3">
          Precision / recall / F1 over the {fallacyReport.cases}-case labelled set — one honest known false positive ({fallacyReport.falsePositiveRate.toFixed(2)} FPR on
          clean text: a genuine request for evidence reads as whataboutism). A rule change that catches more at the cost of crying wolf fails here.
        </p>
        <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
          <div className="rounded-xl border border-[var(--rule)] bg-surface-2 p-3">
            <p className="font-medium">Macro-F1</p>
            <p className="tabular text-ink3">{fallacyReport.macroF1.toFixed(3)}</p>
          </div>
          <div className="rounded-xl border border-[var(--rule)] bg-surface-2 p-3">
            <p className="font-medium">Exact accuracy</p>
            <p className="tabular text-ink3">{fallacyReport.accuracy.toFixed(3)}</p>
          </div>
          <div className="rounded-xl border border-[var(--rule)] bg-surface-2 p-3">
            <p className="font-medium">FPR (clean text)</p>
            <p className="tabular text-ink3">{fallacyReport.falsePositiveRate.toFixed(3)}</p>
          </div>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-ink3">
              <tr><th className="pb-2 font-medium">Label</th><th className="pb-2">P</th><th className="pb-2">R</th><th className="pb-2">F1</th><th className="pb-2">TP/FP/FN</th></tr>
            </thead>
            <tbody className="tabular">
              {fallacyReport.perLabel.map((m) => (
                <tr key={m.label} className="border-t border-[var(--rule)]">
                  <td className="py-2 pr-2">{m.label}</td>
                  <td className="py-2">{m.precision.toFixed(2)}</td>
                  <td className="py-2">{m.recall.toFixed(2)}</td>
                  <td className="py-2">{m.f1.toFixed(2)}</td>
                  <td className="py-2 text-ink3">{m.tp}/{m.fp}/{m.fn}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="surface-card p-5">
        <h2 className="text-sm font-semibold">Evaluation pipeline (synthetic scaffold)</h2>
        <p className="mt-1 text-xs text-ink3">
          The six-dimension rubric — evidence quality, reasoning, relevance, rebuttal quality, logical validity,
          source quality — runs through the full pipeline: inter-rater reliability first, then system-vs-human
          comparison, calibration, and bias detection. Numbers below come from the deterministic synthetic corpus
          and mock judge; they prove the pipeline works, not that the live judge is valid.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div className="rounded-xl border border-[var(--rule)] bg-surface-2 p-3">
            <p className="font-medium">Reliability gate</p>
            <p className="tabular text-ink3">{evalReport.reliability.gatePassed ? "passed ✓" : "failed ✗"}</p>
            <p className="tabular text-ink3">ICC per dimension; failing: {evalReport.reliability.failingDimensions.length}</p>
          </div>
          <div className="rounded-xl border border-[var(--rule)] bg-surface-2 p-3">
            <p className="font-medium">System vs human</p>
            <p className="tabular text-ink3">Pearson mean={meanPearson(evalReport)}</p>
            <p className="tabular text-ink3">MAE mean={meanMae(evalReport)}</p>
          </div>
          <div className="rounded-xl border border-[var(--rule)] bg-surface-2 p-3">
            <p className="font-medium">Calibration</p>
            <p className="tabular text-ink3">slope≈{evalReport.calibration[0]?.slope.toFixed(2) ?? "—"} · intercept≈{evalReport.calibration[0]?.intercept.toFixed(2) ?? "—"}</p>
            <p className="tabular text-ink3">MAE {evalReport.calibration[0]?.maeBefore.toFixed(2) ?? "—"} → {evalReport.calibration[0]?.maeAfter.toFixed(2) ?? "—"} after linear fit</p>
          </div>
          <div className="rounded-xl border border-[var(--rule)] bg-surface-2 p-3">
            <p className="font-medium">Bias probes</p>
            <p className="tabular text-ink3">neutral judge: verbosity {evalReport.bias.verbosity.detected ? "flagged" : "clear"} · style {evalReport.bias.style.detected ? "flagged" : "clear"}</p>
            <p className="tabular text-ink3">verbosity-tilted judge: {tiltedReport.bias.verbosity.detected ? "flagged ✓" : "missed ✗"} (partial r={tiltedReport.bias.verbosity.pooledPartialR.toFixed(2)})</p>
          </div>
        </div>
      </section>

      <section className="surface-card p-5">
        <h2 className="text-sm font-semibold">What&apos;s next</h2>
        <ul className="mt-2 list-disc pl-4 text-sm text-ink3">
          <li>Import hundreds/thousands of moderated annotations with provenance (migration 005) before reporting κ/α or judge-vs-human agreement as human-validity evidence.</li>
          <li>Run live bias harness across both judges and publish model-by-model deltas; ensemble where it improves reliability.</li>
          <li>Wire live fetch into the judge route and surface the per-claim evidence report in the verdict panel.</li>
        </ul>
      </section>
    </AppShell>
  );
}

