import Link from "next/link";
import { createClient } from "@/lib/backend/server";
import { buildLedgerForUser } from "@/lib/skillLedgerServer";
import { METRIC_KEYS, METRIC_LABELS, HIGHER_IS_BETTER } from "@/lib/skillLedger";
import { buildProgressSummary } from "@/lib/progressSummary";
import { buildCoachingGoal } from "@/lib/coachingGoal";
import AppShell from "@/components/AppShell";
import SignedOut from "@/components/SignedOut";
import PageHeader from "@/components/PageHeader";
import CoachToday from "@/components/CoachToday";
import { recordProductEvent } from "@/lib/productEvents";

export const dynamic = "force-dynamic";

export const metadata = { title: "Your progress" };

function fmt(v: number | null | undefined, pctLike: boolean): string {
  if (v === null || v === undefined) return "—";
  return pctLike ? `${Math.round(v * 100)}%` : String(v);
}

const PCT_LIKE = new Set(["unsupportedClaimRate", "rebuttalCoverage", "evidenceGrounding", "impactHandling", "steelmanQuality", "fallacyRate", "uncitedEvidenceRate", "clarity"]);

const TREND_GLYPH: Record<string, { glyph: string; tone: string }> = {
  up: { glyph: "↑", tone: "text-[var(--success)]" },
  down: { glyph: "↓", tone: "text-[var(--bad)]" },
  flat: { glyph: "→", tone: "text-ink3" },
  "no-data": { glyph: "·", tone: "text-ink3" },
};

function Sparkline({ values }: { values: Array<number | null> }) {
  const pts = values.filter((v): v is number => v !== null);
  if (pts.length < 2) return <span className="text-xs text-ink3">not enough debates</span>;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const coords = pts.map((v, i) => `${(i / (pts.length - 1)) * 100},${28 - ((v - min) / span) * 24 - 2}`).join(" ");
  return (
    <svg viewBox="0 0 100 28" className="h-7 w-full" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={coords} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
    </svg>
  );
}

export default async function ProgressPage() {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    return (
      <AppShell width="narrow">
        <SignedOut
          title="Sign in to see your skill trajectory"
          description="Progress is computed from the argument graphs of debates saved to your account."
        />
      </AppShell>
    );
  }

  void recordProductEvent("progress_viewed");

  const ledger = await buildLedgerForUser(user.id);
  const summary = buildProgressSummary(ledger.points);
  const goal = buildCoachingGoal(ledger.points, null);
  const focusLabel = goal?.dimension
    ? (summary.skills.find((s) => s.key === goal.dimension)?.label ?? goal.dimension)
    : null;

  return (
    <AppShell width="narrow">
      <PageHeader
        eyebrow="Your argument skills"
        title="Progress"
        description={`Built from ${ledger.debates} completed debate${ledger.debates === 1 ? "" : "s"} — every score is recomputed from the arguments you actually made.`}
      />

      {/* ── The seven skills: score + simple trend ─────────────────────────── */}
      <section className="surface-card p-5" aria-label="Skill scores">
        <div className="flex flex-col gap-2.5" data-testid="skill-list">
          {summary.skills.map((skill) => {
            const { glyph, tone } = TREND_GLYPH[skill.trend];
            return (
              <div key={skill.key} className="grid grid-cols-[1fr_auto] items-center gap-3" data-skill={skill.key}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium">{skill.label}</span>
                  <span className="tabular text-sm font-semibold">{skill.score ?? "—"}</span>
                </div>
                <span className={`tabular text-sm ${tone}`} title={skill.trendLabel} aria-label={`${skill.label} ${skill.score ?? "no data"}, ${skill.trendLabel}`}>
                  {glyph}
                </span>
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-[var(--rule)] pt-3 text-xs text-ink3">
          {summary.strongest && <span>Strongest: <span className="font-medium text-ink2">{summary.strongest.label}</span></span>}
          {summary.weakest && <span>Weakest: <span className="font-medium text-ink2">{summary.weakest.label}</span></span>}
        </div>
        <p className="mt-3 text-[11px] leading-5 text-ink3">
          Scores settle after a few debates — early numbers move around a lot. {summary.debatesAnalysed < summary.minDebatesForStableScores && `You have ${summary.debatesAnalysed} so far.`}
        </p>
      </section>

      {/* ── Current training focus ─────────────────────────────────────────── */}
      <section className="surface-card p-5" aria-labelledby="focus-heading" data-testid="focus-card">
        <p className="text-xs uppercase tracking-[0.14em] text-[var(--accent)]">Focus this week</p>
        <h2 id="focus-heading" className="mt-1 text-lg font-semibold">{focusLabel ?? "Complete a debate to unlock your focus"}</h2>
        {goal?.headline && (
          <p className="mt-2 rounded-lg border border-[var(--rule)] bg-surface-2 px-3 py-2 text-sm text-ink2">{goal.headline}</p>
        )}
        {focusLabel && (
          <Link
            href="/"
            className="btn btn-primary mt-4 w-full px-4 py-2.5 text-center text-sm sm:w-auto"
            data-testid="practice-focus"
          >
            Practice {focusLabel.toLowerCase()} in today&apos;s debate →
          </Link>
        )}
      </section>

      {/* The drill system: same focus, one concrete exercise */}
      <CoachToday showProfile={false} />

      {/* ── How this was calculated (progressive disclosure) ──────────────── */}
      <details className="surface-card p-5">
        <summary className="cursor-pointer text-sm font-semibold">How this was calculated</summary>

        <div className="mt-4 flex flex-col gap-6 text-sm">
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink3">Metric trajectories</h3>
            <div className="mt-3 flex flex-col gap-4">
              {METRIC_KEYS.map((k) => {
                const t = ledger.trajectories[k];
                const good = t.goodnessDelta;
                const tone =
                  good === null ? "text-ink3" : good > 0.02 ? "text-[var(--accent)]" : good < -0.02 ? "text-[var(--bad)]" : "text-ink3";
                const direction = HIGHER_IS_BETTER[k] ? "higher is better" : "lower is better";
                return (
                  <div key={k} className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-[var(--rule)] pb-3 last:border-0 last:pb-0">
                    <div>
                      <p className="text-xs font-medium">{METRIC_LABELS[k]}</p>
                      <p className={`tabular text-xs ${tone}`}>
                        {fmt(t.first, PCT_LIKE.has(k))} → {fmt(t.last, PCT_LIKE.has(k))}
                        {t.slopePerDebate !== null && ` · slope ${(t.slopePerDebate * 100).toFixed(1)}/debate`}
                        <span className="text-ink3"> · {direction}</span>
                      </p>
                    </div>
                    <div className="w-28">
                      <Sparkline values={t.series.map((s) => s.value)} />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {ledger.benchmarkBaseline && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink3">Versus fixed benchmark opponent</h3>
              <p className="mt-1 text-xs text-ink3">
                A canonical deterministic reference debate, scored by the identical pipeline. Positive = you beat the
                benchmark on that metric.
              </p>
              <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs tabular sm:grid-cols-3">
                {METRIC_KEYS.filter((k) => ledger.versusBaseline[k] !== undefined).map((k) => {
                  const v = ledger.versusBaseline[k];
                  const tone = v === null || v === undefined ? "" : v > 0 ? "text-[var(--accent)]" : v < 0 ? "text-[var(--bad)]" : "";
                  return (
                    <li key={k} className={tone}>
                      {METRIC_LABELS[k]}: {v === null || v === undefined ? "—" : `${v > 0 ? "+" : ""}${v}`}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <p className="text-xs leading-relaxed text-ink3">
            Observational trajectories from your own debate history — direction per metric as labelled. Sprint debates
            are included in these calculations but are noisier (3 rounds vs 5–12). Causal claims require the rated
            benchmark corpus. ({summary.skills.length} skill dimensions, {METRIC_KEYS.length} underlying metrics.)
          </p>
        </div>
      </details>

      <div className="flex gap-3">
        <Link href="/" className="btn btn-primary px-4 py-2 text-sm">
          Today&apos;s debate
        </Link>
        <Link href="/history" className="btn btn-ghost px-4 py-2 text-sm">
          Debate history
        </Link>
      </div>
    </AppShell>
  );
}
