import Link from "next/link";
import { createClient } from "@/lib/backend/server";
import { getTodayTopic } from "@/lib/dailyTopic";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import GuestArena from "@/components/GuestArena";
import PageViewEvent from "@/components/PageViewEvent";
import TopicCard, { type EvidenceCardView } from "@/components/TopicCard";
import SkillProfileBars from "@/components/SkillProfileBars";
import { computeSkillProfile, MIN_PROFILE_DEBATES } from "@/lib/skillProfile";
import { buildCoachingGoal, type CoachingSnapshot } from "@/lib/coachingGoal";
import { buildJourneyInputsForUser } from "@/lib/skillJourneyServer";
import { buildLearnerModel } from "@/lib/learnerModel";
import { buildLoopThread } from "@/lib/loopThread";
import LoopThread from "@/components/LoopThread";
import { isDatabaseConfigured } from "@/lib/backend/env";
import { loadCoachingContext } from "@/lib/coachingContextServer";
import { asRepairAttemptLite, latestUnfinishedRepair } from "@/lib/repairResume";
import { getCurrentUser, getProfileSummary } from "@/lib/currentViewer";
import { resolvePracticeMotion, type DueRetest } from "@/lib/practiceMotion";
import { pickPriority } from "@/lib/dailyFocus";

export const dynamic = "force-dynamic";

const RETEST_SKILL_LABEL: Record<string, string> = {
  evidence: "Evidence",
  rebuttal: "Rebuttal",
  logic: "Logic",
  // Named after what is measured — see the note in skillTaxonomy.ts.
  clarity: "Engagement",
  impact: "Impact",
  steelmanning: "Steelmanning",
  structure: "Structure",
};

function pendingRetestLabel(dimension: string): string {
  return RETEST_SKILL_LABEL[dimension] ?? dimension;
}

function formatShortDate(value: string | null | undefined, timeZone: string): string {
  if (!value) return "Date unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unknown";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone }).format(date);
}

export default async function DashboardPage() {
  if (!isDatabaseConfigured()) {
    return <GuestArena />;
  }

  const db = await createClient();
  const user = await getCurrentUser();

  if (!user) {
    return <GuestArena />;
  }

  // getTodayTopic never throws — it falls back to a curated motion when
  // nothing is pre-stored, so the dashboard always has content. Motion
  // personalisation then picks (and explains) the best motion for this user,
  // enforcing the retest different-topic rule at the motion layer.
  const sharedTopic = await getTodayTopic();

  const coachingContext = await loadCoachingContext(user.id, { currentTopicId: sharedTopic.id });

  // Motion personalisation: the shared daily motion stays the default; a
  // different motion is served only when it clearly helps — above all when a
  // due retest needs a genuinely different topic from the repaired debate.
  const oldestPending = coachingContext.pendingRetests[0] ?? null;
  const dueRetest: DueRetest | null = oldestPending
    ? {
        topicId: oldestPending.topicId,
        attemptedAt: oldestPending.attemptedAt,
        dimension: oldestPending.dimension,
      }
    : null;
  const motion = await resolvePracticeMotion({
    userId: user.id,
    shared: sharedTopic,
    dueRetest,
    focus: null,
  });
  const topic = motion.topic;

  const [{ data: activeDebate }, { data: profile }, { data: evidenceRows }, { data: previousDebate }] =
    await Promise.all([
      db
        .from("solo_debates")
        .select("*")
        .eq("user_id", user.id)
        .eq("topic_id", topic.id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      getProfileSummary(user.id).then((data) => ({ data })),
      db
        .from("topic_evidence")
        .select("*")
        .eq("topic_id", topic.id)
        .order("created_at", { ascending: true })
        .limit(4),
      db
        .from("solo_debates")
        .select("id, topic_id, side, total_score, performance_score, bonus_xp, round_count, created_at, completed_at, format, coaching")
        .eq("user_id", user.id)
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
  const ledger = coachingContext.ledger;
  const { data: repairAttempts } = await db
    .from("repair_results")
    .select("debate_id, target_kind, score, succeeded, signals, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  const unfinishedRepair = latestUnfinishedRepair(
    (repairAttempts ?? [])
      .map((attempt) =>
        asRepairAttemptLite({
          debateId: attempt.debate_id,
          targetKind: attempt.target_kind,
          score: attempt.score,
          succeeded: attempt.succeeded,
          createdAt: attempt.created_at,
          signals: attempt.signals,
        }),
      )
      .filter((attempt): attempt is NonNullable<typeof attempt> => attempt !== null),
  );

  const drillOutcomes = coachingContext.drillOutcomes;

  let previousDebateTitle: string | null = null;
  if (previousDebate?.topic_id) {
    const { data: previousTopic } = await db
      .from("daily_topics")
      .select("title")
      .eq("id", previousDebate.topic_id)
      .maybeSingle();
    previousDebateTitle = previousTopic?.title ?? null;
  }

  const skillProfile = ledger ? computeSkillProfile(ledger.points) : null;
  // "Improving" needs more than a two-debate delta to be worth printing:
  // hold the label until scores have started to settle.
  const improving = ledger && ledger.debates >= MIN_PROFILE_DEBATES ? ledger.improvements : [];
  const improvementKey = improving[0];

  // Daily coaching goal: one focus, grounded in the previous debate's
  // observed behaviour (not a wall of metrics — one line of evidence).
  const lastCoaching = (previousDebate?.coaching ?? null) as { snapshot?: CoachingSnapshot | null } | null;
  const pendingRetest = coachingContext.selectedRetest;
  const goal = buildCoachingGoal(
    ledger?.points ?? [],
    lastCoaching?.snapshot ?? null,
    drillOutcomes,
    pendingRetest?.dimension ?? null,
  );
  // Canonical learner model — the same intelligence that drives Progress, so
  // Today leads with what to practise and why rather than a wall of cards.
  // Built from the same stored debates/repairs; a repair is practice, not mastery.
  const journeyInputs = await buildJourneyInputsForUser(user.id);
  const learnerModel = buildLearnerModel({
    points: ledger?.points ?? [],
    repairs: journeyInputs.repairs.map((r) => ({
      targetKind: r.target_kind,
      debateId: r.debate_id,
      createdAt: r.created_at,
      succeeded: r.succeeded,
    })),
    retests: journeyInputs.repairs.flatMap((r) =>
      r.retest_debate_id && r.retest_completed_at
        ? [
            {
              targetKind: r.target_kind,
              repairDebateId: r.debate_id,
              assignedDebateId: r.retest_debate_id,
              completedAt: r.retest_completed_at,
              observable:
                r.retest_outcome === "skill-observed" || r.retest_outcome === "skill-not-observed",
              demonstrated:
                r.retest_outcome === "skill-observed"
                  ? true
                  : r.retest_outcome === "skill-not-observed"
                    ? false
                    : null,
            },
          ]
        : [],
    ),
  });

  // The training loop as a visible thread: practice → diagnose → repair →
  // retest → demonstrate, with the learner's current position marked. Derived
  // from the same learner model as the hero — no second source of truth.
  const loopThread = buildLoopThread(learnerModel);

  // ── Continue training: one priority action, never competing cards ────────
  const priority = pickPriority({
    unfinishedRepair: unfinishedRepair
      ? {
          debateId: unfinishedRepair.debateId,
          label: unfinishedRepair.label,
          nextCue: unfinishedRepair.nextCue,
        }
      : null,
    dueRetest: motion.servesRetest && pendingRetest ? { label: goal?.dimension ? pendingRetestLabel(goal.dimension) : "the repaired skill" } : null,
    openDrill: null,
    debateAvailable: !activeDebate,
  });

  const today = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: profile?.timezone ?? "UTC",
  }).format(new Date());

  return (
    <AppShell>
      <PageViewEvent name="daily_viewed" />
      <PageHeader
        eyebrow="Daily practice"
        title="Today"
        description={today}
        actions={
          profile && (
            <>
              <span className="pill tabular">🔥 {profile.current_streak}-day streak</span>
              <span className="pill tabular">Level {profile.level}</span>
              <span className="pill tabular">{profile.total_points} pts</span>
            </>
          )
        }
      />

      {/* ── Today's training target: what to practise, why, and what we'll watch ── */}
      {learnerModel.nextPractice && (
        <section
          className="surface-card p-5"
          aria-labelledby="today-target-heading"
          data-testid="today-target"
        >
          <p className="text-xs uppercase tracking-[0.14em] text-[var(--accent)]">
            Today&apos;s training target
          </p>
          <h2 id="today-target-heading" className="mt-1 text-xl font-semibold">
            {learnerModel.nextPractice.label}
          </h2>
          <p className="mt-2 text-sm leading-6 text-ink2">{learnerModel.nextPractice.reason}</p>
          <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
            <div>
              <dt className="font-medium text-ink2">Today, watch for</dt>
              <dd className="text-ink3">{learnerModel.nextPractice.observable}</dd>
            </div>
            <div>
              <dt className="font-medium text-ink2">How long</dt>
              <dd className="text-ink3">Daily Sprint ≈4 min, or a Full Debate (5–12 rounds).</dd>
            </div>
          </dl>
          <p className="mt-3 rounded-lg border border-[var(--rule)] bg-surface-2 px-3 py-2 text-[11px] leading-4 text-ink3">
            {learnerModel.nextPractice.evidence} {learnerModel.nextPractice.caveat}
          </p>
          <Link
            href="/progress"
            className="mt-3 inline-block text-xs font-medium text-[var(--accent)] underline underline-offset-2"
          >
            How we picked this →
          </Link>
        </section>
      )}

      {/* ── The loop: where you are in practice → diagnose → repair → retest → demonstrate ── */}
      <LoopThread thread={loopThread} />

      <TopicCard
        topic={topic}
        activeDebateId={activeDebate?.id ?? null}
        evidenceCards={(evidenceRows ?? []) as unknown as EvidenceCardView[]}
        goalLine={goal?.goalLine ?? "Use evidence for major claims."}
        lastLine={goal?.lastLine ?? null}
        focusLabel={motion.servesRetest && pendingRetest ? "Retest after repair" : "Today's focus"}
        motionReason={motion.reasonLine}
        retestMode={motion.servesRetest}
        isFirstVisit={!previousDebate}
      />
      {coachingContext.status !== "ok" && (
        <p className="text-xs text-ink3" role="status">
          Coaching context is temporarily {coachingContext.status}; today&apos;s debate is still available without treating missing data as progress.
        </p>
      )}

      {/* ── Continue training: the single highest-priority unfinished action ── */}
      {priority && priority.kind !== "debate" && (
        <section
          className="surface-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
          aria-labelledby="continue-training-heading"
          data-testid="continue-training"
        >
          <div className="min-w-0">
            <p className="home-secondary-kicker">Continue training</p>
            <h2 id="continue-training-heading" className="mt-1 text-base font-semibold">
              {priority.title}
            </h2>
            <p className="mt-1 text-sm leading-6 text-ink3">{priority.detail}</p>
          </div>
          <Link
            href={priority.href}
            className="btn btn-primary shrink-0 px-4 py-2 text-center text-sm"
            data-testid={`priority-${priority.kind}`}
          >
            {priority.action} →
          </Link>
        </section>
      )}

      <section aria-labelledby="continue-heading">
        <div className="section-heading">
          <h2 id="continue-heading">Your practice</h2>
          <Link href="/progress" className="section-heading-note underline underline-offset-2 hover:text-ink">
            All progress →
          </Link>
        </div>

        <div className="home-secondary-grid">
          <article className="home-secondary-card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="home-secondary-kicker">Skill progress</p>
                <h3>Argument profile</h3>
              </div>
              {skillProfile && (
                <span className="tabular text-xs font-medium text-ink3">
                  {skillProfile.debatesAnalysed} debate{skillProfile.debatesAnalysed === 1 ? "" : "s"} observed
                </span>
              )}
            </div>
            {skillProfile ? (
              <div className="mt-1 overflow-hidden">
                <SkillProfileBars profile={skillProfile} />
              </div>
            ) : (
              <p>Complete a debate to start seeing your reasoning strengths and gaps.</p>
            )}
            <Link href="/progress" className="home-secondary-action">
              Open progress →
            </Link>
          </article>

          <article className="home-secondary-card">
            <p className="home-secondary-kicker">Previous debate</p>
            <h3>{previousDebateTitle ?? "Your first rep is waiting"}</h3>
            {previousDebate ? (
              <p className="home-secondary-meta">
                {formatShortDate(previousDebate.completed_at ?? previousDebate.created_at, profile?.timezone ?? "UTC")} · arguing{" "}
                {previousDebate.side} · {previousDebate.performance_score ?? "—"}/100 performance
                {improvementKey ? <span className="block text-[var(--accent)]">Improving: {improvementKey.replace(/([A-Z])/g, " $1").toLowerCase()}</span> : null}
              </p>
            ) : (
              <p>After your first debate, this is where you can jump back into the reasoning.</p>
            )}
            <Link
              href={previousDebate ? `/debate/${previousDebate.id}` : "/history"}
              className="home-secondary-action"
            >
              {previousDebate ? "Review debate →" : "See history →"}
            </Link>
          </article>

          <article className="home-secondary-card">
            <p className="home-secondary-kicker">Deep dive</p>
            <h3>Argument DNA</h3>
            <p className="home-secondary-meta">
              The structure behind your scores — claims, evidence and rebuttals, and how they connect.
            </p>
            <Link href="/dna" className="home-secondary-action">
              See Argument DNA →
            </Link>
          </article>
        </div>
      </section>
    </AppShell>
  );
}
