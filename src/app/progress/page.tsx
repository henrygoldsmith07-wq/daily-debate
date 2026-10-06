import Link from "next/link";
import { createServiceClient } from "@/lib/backend/server";
import { METRIC_KEYS, METRIC_LABELS, HIGHER_IS_BETTER } from "@/lib/skillLedger";
import { buildProgressSummary } from "@/lib/progressSummary";
import { bestWorstTopics } from "@/lib/topicInsights";
import {
  buildTrainingProgress,
  MIN_MODE_TREND_DEBATES,
  MIN_MODE_TREND_TURNS,
  type ModeTrainingProgress,
} from "@/lib/trainingProgress";
import { DEBATE_MODES, type DebateModeId } from "@/lib/debateModes";
import { buildCoachingGoal } from "@/lib/coachingGoal";
import AppShell from "@/components/AppShell";
import SignedOut from "@/components/SignedOut";
import PageHeader from "@/components/PageHeader";
import CoachToday from "@/components/CoachToday";
import PageViewEvent from "@/components/PageViewEvent";
import { computeLoopStatuses, type DrillAssignmentLite, type LoopStage } from "@/lib/coachLoop";
import { loadCoachingContext } from "@/lib/coachingContextServer";
import { getCurrentUser } from "@/lib/currentViewer";
import { getTodayTopic } from "@/lib/dailyTopic";
import { buildJourneyInputsForUser } from "@/lib/skillJourneyServer";
import { buildSkillJourney, buildRecentlyImproved, journeyObservationsFor } from "@/lib/skillJourney";
import { buildMilestones } from "@/lib/milestones";
import { FORMATIVE_STATE_LABELS } from "@/lib/retest";

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

  const topic = await getTodayTopic();
  const coachingContext = await loadCoachingContext(user.id, { currentTopicId: topic.id });
  const ledger = coachingContext.ledger;
  if (!ledger) {
    return (
      <AppShell width="narrow">
        <PageHeader
          eyebrow="Your argument skills"
          title="Progress temporarily unavailable"
          description="Your saved debates are safe, but the coaching ledger could not be read right now. No zero or reset progress is being inferred."
        />
      </AppShell>
    );
  }
  const drillOutcomes = coachingContext.drillOutcomes;
  const pendingRetest = coachingContext.selectedRetest;
  const service = createServiceClient();
  const { data: drillRows, error: drillRowsError } = await service
    .from("drill_assignments")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(30);
  const drillAssignments: DrillAssignmentLite[] = drillRowsError ? [] : (drillRows ?? []).map((row) => ({
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
  const loopStatuses = drillRowsError
    ? []
    : computeLoopStatuses(ledger.points, drillAssignments)
        .sort((a, b) => (b.drillAssignedAt ?? "").localeCompare(a.drillAssignedAt ?? ""))
        .slice(0, 3);

  const summary = buildProgressSummary(ledger.points);
  const training = buildTrainingProgress(ledger.points);
  const journeyInputs = await buildJourneyInputsForUser(user.id);
  const journey = buildSkillJourney(journeyInputs.repairs, journeyInputs.weaknessRows);
  const recentlyImproved = buildRecentlyImproved(journey);
  const milestones = buildMilestones({
    repairs: journeyInputs.repairs,
    observationsByKind: Object.fromEntries(
      journeyInputs.repairs.map((r) => [r.target_kind, journeyObservationsFor(r.target_kind, journeyInputs.weaknessRows)]),
    ),
    completedLoops: journeyInputs.repairs.filter((r) => r.retest_completed_at).length,
  });
  const sourceWindow = ledger.sourceWindow;
  const progressDescription =
    sourceWindow.truncated === true && sourceWindow.totalCompletedDebates !== null
      ? `Current signals analyze ${ledger.debates} debate${ledger.debates === 1 ? "" : "s"} with usable assessment data from your latest ${sourceWindow.completedDebatesLoaded} of ${sourceWindow.totalCompletedDebates} completed debates — older debates remain in History but are outside the active coaching window.`
      : sourceWindow.truncated === null
        ? `Current signals analyze ${ledger.debates} debate${ledger.debates === 1 ? "" : "s"} with usable assessment data from a bounded latest-${sourceWindow.limit} debate window. Your lifetime completed-debate total is temporarily unavailable.`
        : `Built from ${ledger.debates} completed debate${ledger.debates === 1 ? "" : "s"} with usable assessment data — headline reads show observed direction and relative focus; raw metrics are available below.`;
  const goal = buildCoachingGoal(
    ledger.points,
    null,
    drillOutcomes,
    pendingRetest?.dimension ?? null,
  );
  const focusLabel = goal?.dimension
    ? (summary.skills.find((s) => s.key === goal.dimension)?.label ?? goal.dimension)
    : null;

  // Best/worst topic: observational aggregation over scored debates, joined to
  // their topic categories. Conservative by design (see topicInsights.ts).
  const { data: scoredDebates } = await db
    .from("solo_debates")
    .select("total_score, topic_id")
    .eq("user_id", user.id)
    .eq("status", "completed")
    .not("total_score", "is", null)
    .order("completed_at", { ascending: false })
    .limit(100);
  const topicIds = [...new Set((scoredDebates ?? []).map((d) => d.topic_id))];
  const { data: topicCategories } = topicIds.length
    ? await db.from("daily_topics").select("id, category").in("id", topicIds)
    : { data: [] };
  const categoryById = new Map((topicCategories ?? []).map((t) => [t.id, t.category as string | null]));
  const topicInsights = bestWorstTopics(
    (scoredDebates ?? []).map((d) => ({
      category: categoryById.get(d.topic_id) ?? null,
      totalScore: d.total_score as number | null,
    })),
  );

  return (
    <AppShell width="narrow">
      <PageViewEvent name="progress_viewed" />
      <PageHeader
        eyebrow="Your argument skills"
        title="Progress"
        description={progressDescription}
      />
      {coachingContext.status === "partial" && (
        <p className="text-xs text-ink3" role="status">
          Some coaching context is temporarily unavailable; saved progress remains intact and no missing signal is being treated as zero.
        </p>
      )}
      {drillRowsError && (
        <p className="text-xs text-ink3" role="status">
          Drill history is temporarily unavailable; learning-loop cards are hidden rather than treating missing assignments as zero practice.
        </p>
      )}

      {/* ── Recently improved: 1–3 real changes, no metric wall ──────────── */}
      {recentlyImproved.length > 0 && (
        <section className="surface-card p-5" aria-labelledby="recent-improved" data-testid="recently-improved">
          <p className="text-xs uppercase tracking-[0.14em] text-[var(--accent)]">Recently improved</p>
          <ul className="mt-2 flex flex-col gap-2">
            {recentlyImproved.map((item) => (
              <li key={item.label} className="text-sm leading-6 text-ink2">
                <span className="font-semibold text-ink">{item.label}:</span> {item.line}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-4 text-ink3">
            Observable changes from your own debate history, with their sample size. Not a verdict on ability.
          </p>
        </section>
      )}

      {/* ── Skill Journey: the improvement stories, evidence behind them ─── */}
      {journey.length > 0 && (
        <section aria-labelledby="skill-journey">
          <div className="section-heading">
            <h2 id="skill-journey">Skill journey</h2>
            <span className="section-heading-note">weakness → repair → retest → evidence</span>
          </div>
          <div className="flex flex-col gap-3">
            {journey.map((entry) => (
              <article key={entry.dimension} className="rounded-xl border border-[var(--rule)] bg-surface-2 p-4" data-testid={`journey-${entry.dimension}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-sm font-semibold">{entry.label}</h3>
                  <span className="text-xs text-ink3">{entry.evidence.note}</span>
                </div>
                <p className="mt-2 text-sm leading-6 text-ink2" data-testid="journey-story">
                  {entry.story ?? entry.currentState}
                </p>
                <ol className="mt-3 flex flex-col gap-1.5 text-xs text-ink3">
                  {entry.trigger && (
                    <li><span className="font-medium text-ink2">Weakness:</span> {entry.trigger.detail}</li>
                  )}
                  {entry.repair && (
                    <li>
                      <span className="font-medium text-ink2">Repair:</span>{" "}
                      {FORMATIVE_STATE_LABELS[entry.repair.state as keyof typeof FORMATIVE_STATE_LABELS] ?? entry.repair.state}
                      {" — "}one rewrite of the flagged move.
                    </li>
                  )}
                  {entry.retest && (
                    <li data-testid="journey-retest">
                      <span className="font-medium text-ink2">Retest:</span> {entry.retest.label}
                    </li>
                  )}
                  {entry.laterObservations.length > 0 && (
                    <li>
                      <span className="font-medium text-ink2">Since:</span>{" "}
                      {entry.evidence.opportunitiesMet} of {entry.evidence.opportunitiesObserved} chances met across{" "}
                      {entry.evidence.eligibleDebates} eligible {entry.evidence.eligibleDebates === 1 ? "debate" : "debates"}.
                    </li>
                  )}
                </ol>
                {!entry.evidence.sufficient && (
                  <p className="mt-2 text-[11px] leading-4 text-ink3">
                    Evidence is still too limited for a strong claim — this is what has been observed so far, not a verdict.
                  </p>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

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

      {training.debatesWithTrainingData > 0 && (
        <section className="surface-card p-5" aria-labelledby="training-mode-progress">
          <p className="text-xs uppercase tracking-[0.14em] text-[var(--accent)]">Training modes</p>
          <h2 id="training-mode-progress" className="mt-1 text-lg font-semibold">Pressure and delivery signals</h2>
          <p className="mt-2 text-sm leading-6 text-ink3">
            These timing and speech observations stay separate from your argument-skill trajectory. They describe how you performed under the selected training conditions, not overall debating ability.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {(Object.entries(training.modeTurns) as Array<[DebateModeId, number]>).map(([mode, count]) => (
              <span key={mode} className="pill">
                {DEBATE_MODES[mode].label}: {count} turn{count === 1 ? "" : "s"}
              </span>
            ))}
          </div>

          {training.spokenTurns > 0 && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-[var(--rule)] bg-surface-2 p-3">
                <p className="text-xs text-ink3">All spoken modes · pace</p>
                <p className="mt-1 tabular text-base font-semibold">
                  {training.avgPaceWpm === null ? "—" : `${training.avgPaceWpm} WPM`}
                </p>
              </div>
              <div className="rounded-lg border border-[var(--rule)] bg-surface-2 p-3">
                <p className="text-xs text-ink3">All spoken modes · delivery</p>
                <p className="mt-1 tabular text-base font-semibold">
                  {training.avgSpeechQuality === null ? "—" : `${training.avgSpeechQuality}/100`}
                </p>
              </div>
            </div>
          )}

          {(Object.entries(training.perMode) as Array<[DebateModeId, ModeTrainingProgress]>)
            .filter(([mode]) => mode !== "text").length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-semibold">Within-mode signals</h3>
              <p className="mt-1 text-xs leading-5 text-ink3">
                Compare each mode with itself. A rapid rebuttal and a prepared speech are different tasks, so their raw values are not treated as interchangeable.
              </p>
              <div className="mt-3 grid gap-3">
                {(Object.entries(training.perMode) as Array<[DebateModeId, ModeTrainingProgress]>)
                  .filter(([mode]) => mode !== "text")
                  .map(([mode, stats]) => (
                    <article key={mode} className="rounded-lg border border-[var(--rule)] bg-surface-2 p-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm font-semibold">{DEBATE_MODES[mode].label}</p>
                        <p className="text-[11px] text-ink3">{stats.debates} debate{stats.debates === 1 ? "" : "s"} · {stats.turns} turn{stats.turns === 1 ? "" : "s"}</p>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                        <div><span className="text-ink3">Pace</span><p className="mt-0.5 font-semibold tabular">{stats.avgPaceWpm === null ? "—" : `${stats.avgPaceWpm} WPM`}</p></div>
                        <div><span className="text-ink3">Delivery</span><p className="mt-0.5 font-semibold tabular">{stats.avgSpeechQuality === null ? "—" : `${stats.avgSpeechQuality}/100`}</p></div>
                        <div><span className="text-ink3">Fillers</span><p className="mt-0.5 font-semibold tabular">{stats.avgFillerDensity === null ? "—" : `${stats.avgFillerDensity}/100w`}</p></div>
                        <div><span className="text-ink3">Response</span><p className="mt-0.5 font-semibold tabular">{stats.avgResponseSeconds === null ? "—" : `${stats.avgResponseSeconds}s`}</p></div>
                      </div>
                      {(stats.speechQualityChange !== null || stats.responseTimeChangeSeconds !== null) && (
                        <p className="mt-3 text-[11px] leading-5 text-ink3">
                          First → latest observed debate in this mode:
                          {stats.speechQualityChange !== null ? ` delivery ${stats.speechQualityChange > 0 ? "+" : ""}${stats.speechQualityChange}` : ""}
                          {stats.speechQualityChange !== null && stats.responseTimeChangeSeconds !== null ? " ·" : ""}
                          {stats.responseTimeChangeSeconds !== null ? ` response time ${stats.responseTimeChangeSeconds > 0 ? "+" : ""}${stats.responseTimeChangeSeconds}s` : ""}.
                          Observed change only; not a causal claim.
                        </p>
                      )}
                      {stats.speechQualityChange === null && stats.responseTimeChangeSeconds === null && (
                        <p className="mt-3 text-[11px] leading-5 text-ink3">
                          More observations are needed before showing change. Trends require at least {MIN_MODE_TREND_DEBATES} debates and {MIN_MODE_TREND_TURNS} measured turns in this mode.
                        </p>
                      )}
                    </article>
                  ))}
              </div>
            </div>
          )}

          <p className="mt-3 text-[11px] leading-5 text-ink3">
            Based on {training.debatesWithTrainingData} debate{training.debatesWithTrainingData === 1 ? "" : "s"} with mode metadata{training.spokenTurns > 0 ? ` and ${training.spokenTurns} spoken turn${training.spokenTurns === 1 ? "" : "s"}` : ""}.
          </p>
        </section>
      )}

      {/* ── Topic map: where the user argues strongest / weakest ───────────── */}
      {(topicInsights.best || topicInsights.worst) && (
        <section className="surface-card p-5" aria-label="Topic performance" data-testid="topic-insights">
          <p className="text-xs uppercase tracking-[0.14em] text-[var(--accent)]">Where you argue</p>
          <div className="mt-2 flex flex-col gap-1.5 text-sm">
            {topicInsights.best && (
              <p>
                <span className="text-ink3">Strongest topic:</span>{" "}
                <span className="font-semibold">{topicInsights.best.category}</span>{" "}
                <span className="text-ink3">
                  · {Math.round(topicInsights.best.averageScore)} avg over {topicInsights.best.debates} debates
                </span>
              </p>
            )}
            {topicInsights.worst && (
              <p>
                <span className="text-ink3">Weakest topic:</span>{" "}
                <span className="font-semibold">{topicInsights.worst.category}</span>{" "}
                <span className="text-ink3">
                  · {Math.round(topicInsights.worst.averageScore)} avg over {topicInsights.worst.debates} debates
                </span>
              </p>
            )}
          </div>
          <p className="mt-3 text-[11px] leading-5 text-ink3">
            {topicInsights.note ?? "Observational averages from your own debates — topic mix and difficulty vary, so treat this as a hint about what to practise, not a verdict."}

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

      {/* ── Milestones: behaviour that actually happened ───────────────────── */}
      <section className="surface-card p-5" aria-labelledby="milestones-heading" data-testid="milestones">
        <h2 id="milestones-heading" className="text-sm font-semibold">Practice milestones</h2>
        <p className="mt-1 text-xs text-ink3">Based on what you actually did — not points.</p>
        <ul className="mt-3 flex flex-col gap-2">
          {milestones.map((m) => (
            <li key={m.id} className="flex items-start gap-2 text-sm" data-testid={`milestone-${m.id}`}>
              <span className={m.achieved ? "text-[var(--success)]" : "text-ink3"} aria-hidden="true">
                {m.achieved ? "✓" : "○"}
              </span>
              <span>
                <span className={m.achieved ? "font-medium text-ink" : "text-ink2"}>{m.title}</span>
                <span className="block text-xs leading-5 text-ink3">
                  {m.detail}
                  {m.remaining && !m.achieved && ` ${m.remaining}`}
                  {m.achievedAt && ` (${m.achievedAt})`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>

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
