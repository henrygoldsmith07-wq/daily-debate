import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { buildLedgerForUser } from "@/lib/skillLedgerServer";
import { METRIC_KEYS, METRIC_LABELS } from "@/lib/skillLedger";
import { computeSkillProfile } from "@/lib/skillProfile";
import type { SkillMetricPoint } from "@/lib/skillLedger";
import AppHeader from "@/components/AppHeader";
import CoachToday from "@/components/CoachToday";
import SkillProfileBars from "@/components/SkillProfileBars";

export const dynamic = "force-dynamic";

export const metadata = { title: "Your progress" };

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

function fmt(v: number | null | undefined, pctLike: boolean): string {
  if (v === null || v === undefined) return "—";
  return pctLike ? `${Math.round(v * 100)}%` : String(v);
}

const PCT_LIKE = new Set(["unsupportedClaimRate", "rebuttalCoverage", "evidenceGrounding", "impactHandling", "steelmanQuality", "fallacyRate", "uncitedEvidenceRate", "clarity"]);

export default async function ProgressPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col">
        <AppHeader />
        <main id="main" className="mx-auto w-full max-w-2xl px-4 py-10 text-sm text-ink3">
          Sign in to see your skill trajectory.
        </main>
      </div>
    );
  }

  const ledger = await buildLedgerForUser(user.id);
  const enoughForClaims = ledger.debates >= ledger.minimumForClaims;

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <main id="main" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
        <div>
          <p className="text-xs uppercase tracking-wide text-ink3">Skill ledger</p>
          <h1 className="text-2xl font-semibold tracking-tight">Your trajectory</h1>
          <p className="mt-2 text-sm text-ink3">
            Every metric below is recomputed deterministically from your stored argument graphs — the same pipeline that
            scores your debates. {ledger.debates} completed debate{ledger.debates === 1 ? "" : "s"} analysed.
          </p>
          {!enoughForClaims && (
            <p className="mt-2 rounded-lg border border-[var(--rule)] bg-surface-2 px-3 py-2 text-xs text-ink3">
              Trajectories appear after a few more debates — improvement claims are held until{" "}
              {ledger.minimumForClaims} debates so early noise can&apos;t masquerade as growth.
            </p>
          )}
        </div>

        {/* Argument Skill Profile — the persistent 7-bar view */}
        <section className="surface-card p-5">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-sm font-semibold">Argument skill profile</h2>
            <span className="tabular text-xs text-ink3">
              {ledger.debates} debate{ledger.debates === 1 ? "" : "s"}
            </span>
          </div>
          <SkillProfileBars profile={computeSkillProfile(ledger.points)} />
        </section>

        {ledger.improvements.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">Improving</h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {ledger.improvements.slice(0, 6).map((k) => {
                const t = ledger.trajectories[k];
                return (
                  <div key={k} className="surface-card px-4 py-3">
                    <p className="text-xs font-medium">{METRIC_LABELS[k]}</p>
                    <p className="tabular text-sm text-[var(--accent)]">
                      {fmt(t.first, PCT_LIKE.has(k))} → {fmt(t.last, PCT_LIKE.has(k))}
                    </p>
                    <Sparkline values={t.series.map((s) => s.value)} />
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <CoachToday />

        <section className="surface-card p-5">
          <h2 className="text-sm font-semibold">Metric trajectories</h2>
          <div className="mt-3 flex flex-col gap-4">
            {METRIC_KEYS.map((k) => {
              const t = ledger.trajectories[k];
              const good = t.goodnessDelta;
              const tone =
                good === null ? "text-ink3" : good > 0.02 ? "text-[var(--accent)]" : good < -0.02 ? "text-[var(--bad)]" : "text-ink3";
              return (
                <div key={k} className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-[var(--rule)] pb-3 last:border-0 last:pb-0">
                  <div>
                    <p className="text-xs font-medium">{METRIC_LABELS[k]}</p>
                    <p className={`tabular text-xs ${tone}`}>
                      {fmt(t.first, PCT_LIKE.has(k))} → {fmt(t.last, PCT_LIKE.has(k))}
                      {t.slopePerDebate !== null && ` · slope ${(t.slopePerDebate * 100).toFixed(1)}/debate`}
                    </p>
                  </div>
                  <div className="w-28">
                    <Sparkline values={t.series.map((s) => s.value)} />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-ink3">
            Observational trajectories from your own debate history — direction per metric as labelled. Causal claims
            require the rated benchmark corpus.
          </p>
        </section>

        {ledger.benchmarkBaseline && (
          <section className="surface-card p-5">
            <h2 className="text-sm font-semibold">Versus fixed benchmark opponent</h2>
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

        <div className="flex gap-3">
          <Link href="/" className="btn btn-primary px-4 py-2 text-sm">
            Today&apos;s debate
          </Link>
          <Link href="/history" className="btn btn-ghost px-4 py-2 text-sm">
            Debate history
          </Link>
        </div>
      </main>
    </div>
  );
}
