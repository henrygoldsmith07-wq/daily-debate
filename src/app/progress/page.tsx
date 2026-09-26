import Link from "next/link";
import { createServiceClient } from "@/lib/backend/server";
import { buildLedgerForUser } from "@/lib/skillLedgerServer";
import { METRIC_KEYS, METRIC_LABELS, HIGHER_IS_BETTER } from "@/lib/skillLedger";
import { buildProgressSummary } from "@/lib/progressSummary";
import { buildCoachingGoal } from "@/lib/coachingGoal";
import AppShell from "@/components/AppShell";
import SignedOut from "@/components/SignedOut";
import PageHeader from "@/components/PageHeader";
import CoachToday from "@/components/CoachToday";
import PageViewEvent from "@/components/PageViewEvent";
import { computeLoopStatuses, type DrillAssignmentLite, type LoopStage } from "@/lib/coachLoop";
import { successfulRepairRetestAnchors } from "@/lib/repairRetestServer";
import { pendingRepairRetests } from "@/lib/repairRetest";
import { latestDrillOutcomes } from "@/lib/adaptiveCoachServer";
import { getCurrentUser } from "@/lib/currentViewer";

export const dynamic = "force-dynamic";

export const metadata = { title: "Your progress" };

function fmt(v: number | null | undefined, pctLike: boolean): string {
  if (v === null || v === undefined) return "—";
  return pctLike ? `${Math.round(v * 100)}%` : String(v);
}

const PCT_LIKE = new Set(["unsupportedClaimRate", "rebuttalCoverage", "rebuttalTargeting", "evidenceGrounding", "impactHandling", "steelmanQuality", "fallacyRate", "uncitedEvidenceRate", "clarity"]);

const TREND_GLYPH: Record<string, { glyph: string; tone: string }> = {
  up: { glyph: "↑", tone: "text-[var(--success)]" },
  down: { glyph: "↓", tone: "text-[var(--bad)]" },
  flat: { glyph: "→", tone: "text-ink3" },
  "no-data": { glyph: "·", tone: "text-ink3" },
};

const LOOP_STAGE_ORDER: LoopStage[] = [
  "detected",
  "practised",
  "improved_in_debate",
  "retained",
];

const LOOP_STAGE_LABEL: Record<LoopStage, string> = {
  detected: "Detected",
  practised: "Drilled",
  improved_in_debate: "Debate improved",
  retained: "Retained",
};

function loopCta(stage: LoopStage): { href: string; label: string } {
  if (stage === "detected") return { href: "#daily-drill", label: "Do the drill →" };
  if (stage === "retained") return { href: "/history", label: "Review the debates →" };
  return { href: "/", label: stage === "improved_in_debate" ? "Test it again →" : "Test it in a debate →" };
}

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
  const user = await getCurrentUser();

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

  const [ledger, repairAnchors] = await Promise.all([
    buildLedgerForUser(user.id),
    successfulRepairRetestAnchors(user.id),
  ]);
  const drillOutcomes = await latestDrillOutcomes(user.id, ledger.points);
  const pendingRetest = pendingRepairRetests(ledger.points, repairAnchors)[0] ?? null;
  const service = createServiceClient();
  const { data: drillRows } = await service
    .from("drill_assignments")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(30);
  const drillAssignments: DrillAssignmentLite[] = (drillRows ?? []).map((row) => ({
    id: row.id,
    dimension: row.dimension,
    assignedDate: row.assigned_date,
    createdAt: row.created_at,
    minutes: row.minutes,
    beforeScore: row.before_score,
    attemptText: row.attempt_text,
    attemptScore: row.attempt_score,
    movement: row.movement,
    status: row.status,
  }));
  const loopStatuses = computeLoopStatuses(ledger.points, drillAssignments)
    .sort((a, b) => (b.drillAssignedAt ?? "").localeCompare(a.drillAssignedAt ?? ""))
    .slice(0, 3);

  const summary = buildProgressSummary(ledger.points);
  const goal = buildCoachingGoal(
    ledger.points,
    null,
    drillOutcomes,
    pendingRetest?.dimension ?? null,
  );
  const focusLabel = goal?.dimension
    ? (summary.skills.find((s) => s.key === goal.dimension)?.label ?? goal.dimension)
    : null;

  return (
    <AppShell width="narrow">
      <PageViewEvent name="progress_viewed" />
      <PageHeader
        eyebrow="Your argument skills"
        title="Progress"
        description={`Built from ${ledger.debates} completed debate${ledger.debates === 1 ? "" : "s"} — headline reads show observed direction and relative focus; raw metrics are available below.`}
      />

      {/* ── The seven skills: evidence-backed direction, no synthetic rating ── */}
      <section className="surface-card p-5" aria-label="Skill signals">
        <div className="flex flex-col gap-2.5" data-testid="skill-list">
          {summary.skills.map((skill) => {
            const { glyph, tone } = TREND_GLYPH[skill.trend];
            return (
              <div key={skill.key} className="grid grid-cols-[1fr_auto] items-center gap-3" data-skill={skill.key}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium">{skill.label}</span>
                  <span className="text-xs text-ink3">{skill.trendLabel}</span>
                </div>
                <span className={`tabular text-sm ${tone}`} title={skill.trendLabel} aria-label={`${skill.label}: ${skill.trendLabel}`}>
                  {glyph}
                </span>
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-[var(--rule)] pt-3 text-xs text-ink3">
          {summary.strongest && <span>Stronger current signal: <span className="font-medium text-ink2">{summary.strongest.label}</span></span>}
          {summary.weakest && <span>Current coaching gap: <span className="font-medium text-ink2">{summary.weakest.label}</span></span>}
        </div>
        <p className="mt-3 text-[11px] leading-5 text-ink3">
          Trends need repeated observable opportunities before they are useful. {summary.debatesAnalysed < summary.minDebatesForStableScores && `You have ${summary.debatesAnalysed} debate${summary.debatesAnalysed === 1 ? "" : "s"} so far, so treat these as early signals.`}
        </p>
      </section>

      {/* ── Current training focus ─────────────────────────────────────────── */}
      <section className="surface-card p-5" aria-labelledby="focus-heading" data-testid="focus-card">
        <p className="text-xs uppercase tracking-[0.14em] text-[var(--accent)]">
          {pendingRetest ? "Retest after repair" : "Focus this week"}
        </p>
        <h2 id="focus-heading" className="mt-1 text-lg font-semibold">{focusLabel ?? "Complete a debate to unlock your focus"}</h2>
        {goal?.goalLine && (
          <p className="mt-2 rounded-lg border border-[var(--rule)] bg-surface-2 px-3 py-2 text-sm text-ink2">
            {goal.goalLine}
            {pendingRetest && goal.lastLine ? (
              <span className="mt-1 block text-xs text-ink3">{goal.lastLine}</span>
            ) : null}
          </p>
        )}
        {focusLabel && (
          <Link
            href="/"
            className="btn btn-primary mt-4 w-full px-4 py-2.5 text-center text-sm sm:w-auto"
            data-testid="practice-focus"
          >
            {pendingRetest ? "Retest" : "Practice"} {focusLabel.toLowerCase()} in today&apos;s debate →
          </Link>
        )}
      </section>

      {/* ── Closed learning loop: weakness → drill → retest → retention ─────── */}
      {loopStatuses.length > 0 && (
        <section className="surface-card p-5" aria-labelledby="learning-loop-heading" data-testid="learning-loop">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-[var(--accent)]">Learning loop</p>
              <h2 id="learning-loop-heading" className="mt-1 text-lg font-semibold">Prove the fix sticks</h2>
            </div>
            <span className="text-xs text-ink3">
              {loopStatuses.length} recent skill{loopStatuses.length === 1 ? "" : "s"}
            </span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-ink3">
            A drill is practice, not proof of improvement. Daily Debate checks the same skill in later debates, then
            waits for repeated evidence before calling it retained.
          </p>

          <div className="mt-4 flex flex-col gap-3">
            {loopStatuses.map((status) => {
              const currentIndex = LOOP_STAGE_ORDER.indexOf(status.stage);
              const cta = loopCta(status.stage);
              return (
                <article key={status.dimension} className="rounded-xl border border-[var(--rule)] bg-surface-2 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold">{status.label}</h3>
                    <span className="text-xs font-medium text-[var(--accent)]">{LOOP_STAGE_LABEL[status.stage]}</span>
                  </div>
                  <div
                    className="mt-3 grid grid-cols-4 gap-1"
                    aria-label={`${status.label} learning loop: ${LOOP_STAGE_LABEL[status.stage]}`}
                  >
                    {LOOP_STAGE_ORDER.map((stage, index) => (
                      <span
                        key={stage}
                        className={`h-1.5 rounded-full ${index <= currentIndex ? "bg-[var(--accent)]" : "bg-[var(--rule)]"}`}
                        title={LOOP_STAGE_LABEL[stage]}
                        aria-hidden="true"
                      />
                    ))}
                  </div>
                  <p className="mt-3 text-sm text-ink2">{status.summary}</p>
                  <Link href={cta.href} className="mt-3 inline-block text-xs font-medium underline underline-offset-2">
                    {cta.label}
                  </Link>
                </article>
              );
            })}
          </div>

          <p className="mt-4 text-[11px] leading-5 text-ink3">
            These are observational skill trajectories from your debate history, not proof that a drill caused the
            change. A skill only reaches “retained” after improvement persists across later measurements.
          </p>
        </section>
      )}

      {/* The drill system: same focus, one concrete exercise */}
      <div id="daily-drill">
        <CoachToday showProfile={false} />
      </div>

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
