import Link from "next/link";
import { createClient } from "@/lib/backend/server";
import { getTodayTopic } from "@/lib/dailyTopic";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import GuestArena from "@/components/GuestArena";
import PageViewEvent from "@/components/PageViewEvent";
import TopicCard, { type EvidenceCardView } from "@/components/TopicCard";
import { loadChallengeAssignment } from "@/lib/solo/challengeSide";
import type { ChallengePreview } from "@/lib/challengeMe";
import SkillProfileBars from "@/components/SkillProfileBars";
import SkillRadar from "@/components/SkillRadar";
import WeekStreak from "@/components/WeekStreak";
import { streakDays, weekDays } from "@/lib/weekStreak";
import { computeSkillProfile, MIN_PROFILE_DEBATES } from "@/lib/skillProfile";
import { buildCoachingGoal, pickFocusDimension, type CoachingSnapshot } from "@/lib/coachingGoal";
import { NEUTRAL_GOAL_LINE, skillsUnderTest } from "@/lib/retestDisclosure";
import RetestStartButton from "@/components/RetestStartButton";
import { nextDueRecheck, planRecheck, recheckCopy, recheckStatus } from "@/lib/spacedRecheck";
import { GUEST_MOTIONS } from "@/lib/guestMotions";
import { continueKicker, isRetestHero } from "@/lib/retestHero";
import { lapsedRetestNotice } from "@/lib/lapsedRetestNotice";
import { buildJourneyInputsForUser } from "@/lib/skillJourneyServer";
import { SKILL_DIMENSIONS, SKILL_ORDER } from "@/lib/skillTaxonomy";
import { buildLearnerModel } from "@/lib/learnerModel";
import { buildLoopThread } from "@/lib/loopThread";
import LoopThread from "@/components/LoopThread";
import ClearGuestLoopHandoff from "@/components/ClearGuestLoopHandoff";
import InlineDrillAttempt from "@/components/InlineDrillAttempt";
import { DRILL_FEEDBACK_COPY, drillSignalsFromAttempt } from "@/lib/drillFeedback";
import { isDatabaseConfigured } from "@/lib/backend/env";
import { loadCoachingContext } from "@/lib/coachingContextServer";
import { asRepairAttemptLite, latestUnfinishedRepair } from "@/lib/repairResume";
import { getCurrentUser, getProfileSummary } from "@/lib/currentViewer";
import { getGuestContext } from "@/lib/guestContextServer";
import { loadJudgeValidation } from "@/lib/judgeValidationServer";
import { resolvePracticeMotion, type DueRetest } from "@/lib/practiceMotion";
import { pickPriority } from "@/lib/dailyFocus";
import { canonicalSkillKey } from "@/lib/skillTaxonomy";
import { homeHeaderPills } from "@/lib/homeHeaderPills";
import { dateKeyInTimeZone } from "@/lib/timeZone";
import { firstFocusView, guestKindToDimension, guestSeededFocus, motionFocusWithGuestSeed } from "@/lib/guestFocus";

export const dynamic = "force-dynamic";

function formatShortDate(value: string | null | undefined, timeZone: string): string {
  if (!value) return "Date unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unknown";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone }).format(date);
}

export default async function DashboardPage() {
  // The guest arena receives the guest surface's live validation state so a
  // scoreless practice flow still carries the honest judge-output label. An
  // unreadable benchmark degrades inside the module — the line reads as a
  // hole in the evidence, never as a pass.
  const guestValidation = loadJudgeValidation().surfaces["guest"];
  if (!isDatabaseConfigured()) {
    return <GuestArena validation={guestValidation} />;
  }

  const db = await createClient();
  const user = await getCurrentUser();

  if (!user) {
    return <GuestArena validation={guestValidation} />;
  }

  // getTodayTopic never throws — it falls back to a curated motion when
  // nothing is pre-stored, so the dashboard always has content. Motion
  // personalisation then picks (and explains) the best motion for this user,
  // enforcing the retest different-topic rule at the motion layer.
  // The journey read depends only on the user, so start it now and let it
  // overlap the topic + coaching-context round-trips instead of trailing them.
  const journeyInputsPromise = buildJourneyInputsForUser(user.id);
  journeyInputsPromise.catch(() => undefined); // awaited (and surfaced) below
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
  // One focus for today, shared by the motion bonus, the visible coaching
  // goal and the training target — so no two of them can name different
  // skills on the same screen.
  const accountFocus = pickFocusDimension(
    coachingContext.ledger?.points ?? [],
    coachingContext.drillOutcomes,
    skillsUnderTest(coachingContext.pendingRetests),
    coachingContext.reRepairDimensions,
    coachingContext.repairedDimensions,
  );
  // A brand-new account has no focus of its own; its first debate is coached
  // on the guest-seeded focus, so steer the motion by that same skill. Read
  // only when the account has no evidence (the common case skips the query).
  const ledgerPoints = coachingContext.ledger?.points ?? [];
  const earlyGuestContext =
    !accountFocus && ledgerPoints.length === 0 ? await getGuestContext(user.id).catch(() => null) : null;
  const focusDimension = motionFocusWithGuestSeed({
    accountFocus,
    guestContext: earlyGuestContext,
    completedDebates: coachingContext.ledger?.debates ?? 0,
    ledgerPointCount: ledgerPoints.length,
    excluded: skillsUnderTest(coachingContext.pendingRetests),
  });
  const motion = await resolvePracticeMotion({
    userId: user.id,
    shared: sharedTopic,
    dueRetest,
    // When no retest is due, steer motion personalisation toward today's coached
    // focus so the motion still surfaces the weakest skill (agrees with
    // CoachToday/Progress; buildCoachingGoal uses the same selector). The retest
    // branch above already retargets the motion to a different topic, so this
    // only affects ordinary practice days. Computed from the ledger + drill
    // outcomes (both already loaded) so it precedes the motion selection.
    //
    // The excluded skills are the PENDING retests' skills, not the
    // topic-eligible one: the focus feeds the per-skill topic bonus, so
    // steering today's motion toward a skill under silent test would leak
    // it. Every other surface uses skillsUnderTest(pendingRetests) — one rule.
    focus: focusDimension,
  });
  const topic = motion.topic;

  const [{ data: activeDebate }, { data: profile }, { data: evidenceRows }, previousDebateBundle, openDrillRow, challengePreview] =
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
      // Bundle previous-debate + its topic title + the guest-context fallback
      // into ONE branch: the title lookup and the guest context both depend on
      // previousDebate, so chaining them inside the branch keeps the page's
      // critical path flat instead of adding two post-parallel sequential
      // round-trips. (Loop latency: every extra await delays first paint.)
      (async () => {
        const { data: previousDebate } = await db
          .from("solo_debates")
          .select("id, topic_id, side, total_score, performance_score, bonus_xp, round_count, created_at, completed_at, format, coaching")
          .eq("user_id", user.id)
          .eq("status", "completed")
          .order("completed_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const [topicResult, guestResult] = await Promise.all([
          previousDebate?.topic_id
            ? db.from("daily_topics").select("title").eq("id", previousDebate.topic_id).maybeSingle()
            : Promise.resolve({ data: null }),
          previousDebate
            ? Promise.resolve(null)
            : getGuestContext(user.id),
        ]);
        return { previousDebate, previousDebateTitle: topicResult.data?.title ?? null, guestContext: guestResult };
      })(),
      // Today's open drill assignment (coach/today owns creation/retargeting;
      // the dashboard only reads the row to surface priority #3 — an
      // unattempted drill above today's debate, with its prompt rendered
      // inline so completing it needs no navigation). Runs in parallel with
      // the other reads instead of a second sequential await (loop latency:
      // every extra round-trip delays first paint). Degrades to null on any
      // DB error so a transient read failure never hides the debate, and
      // never invents a drill for another dimension.
      (async () => {
        try {
          const profileRow = await getProfileSummary(user.id);
          const { data: openRow } = await db
            .from("drill_assignments")
            .select("id, title, minutes, prompt, status, dimension, attempt_text")
            .eq("user_id", user.id)
            .eq("assigned_date", dateKeyInTimeZone(profileRow?.timezone ?? "UTC"))
            .in("status", ["open", "attempted"])
            .maybeSingle();
          return openRow
            ? {
                id: openRow.id,
                title: openRow.title,
                minutes: typeof openRow.minutes === "number" ? openRow.minutes : null,
                prompt: typeof openRow.prompt === "string" ? openRow.prompt : null,
                status: openRow.status === "attempted" ? "attempted" : "open",
                dimension: typeof openRow.dimension === "string" ? openRow.dimension : null,
                attemptText: typeof openRow.attempt_text === "string" ? openRow.attempt_text : null,
              }
            : null;
        } catch {
          return null;
        }
      })(),
      // "Challenge me" reveal: resolve the side NOW with the same resolver the
      // start route uses (same history, same seeded coin flip), so the learner
      // sees which side they'll argue — and why — before committing. Any
      // failure degrades to the old "we'll show it when you start" note
      // rather than blocking the dashboard.
      loadChallengeAssignment({ db, userId: user.id, topicId: topic.id })
        .then((assignment): ChallengePreview => ({
          side: assignment.side,
          reason: assignment.reason,
          rule: assignment.rule,
        }))
        .catch(() => null),
    ]);
  // Unpack the previous-debate bundle fired inside the parallel block above.
  const previousDebate = previousDebateBundle.previousDebate;
  const previousDebateTitle = previousDebateBundle.previousDebateTitle;
  const guestContext = previousDebateBundle.guestContext;

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

  // Guest practice carried through signup. Shown ONLY until this account has
  // its own completed debate: once real observed evidence exists, a single
  // unauthenticated guest rep is no longer the most useful thing to lead with.
  // It never enters the ledger or a score — see guestContextServer.ts.
  // (The guest context was loaded inside the previous-debate parallel branch
  // above so the value is already resolved; only the short-circuit lives here.)
  const guestDimension = guestContext ? guestKindToDimension(guestContext.weaknessKind) : null;
  const guestSkillKey = guestDimension ? canonicalSkillKey(guestDimension) : null;
  // The guest repair pre-selects the first signed-in focus (guestFocus.ts):
  // same eligibility rule the start route applies, so the focus shown here is
  // the focus the debate is started with.
  const underTest = skillsUnderTest(coachingContext.pendingRetests);
  const guestFocus = guestSeededFocus({
    guestContext,
    hasCompletedDebate: !!previousDebate,
    ledgerPointCount: coachingContext.ledger ? coachingContext.ledger.points.length : 1,
    excluded: underTest,
  });
  const firstFocus = firstFocusView(guestFocus, underTest);
  const guestCarryover = guestContext
    ? {
        label: guestSkillKey ? SKILL_DIMENSIONS[guestSkillKey].label : guestContext.weaknessLabel || "One move",
        motion: guestContext.motion,
        repaired: guestContext.repairState === "repair_demonstrated",
        observed: guestContext.retestOutcome === "observed",
        seedsFocus: !!guestFocus,
      }
    : null;

  const lapsedSkillKey = coachingContext.lapsedRetests[0]
    ? canonicalSkillKey(coachingContext.lapsedRetests[0].dimension)
    : null;

  const skillProfile = ledger ? computeSkillProfile(ledger.points) : null;
  // "Improving" needs more than a two-debate delta to be worth printing:
  // hold the label until scores have started to settle.
  const improving = ledger && ledger.debates >= MIN_PROFILE_DEBATES ? ledger.improvements : [];
  const improvementKey = improving[0];

  // Daily coaching goal: one focus, grounded in the previous debate's
  // observed behaviour (not a wall of metrics — one line of evidence).
  const lastCoaching = (previousDebate?.coaching ?? null) as { snapshot?: CoachingSnapshot | null } | null;
  // The OLDEST PENDING retest, not the topic-eligible one: today's motion can
  // be the very topic the learner repaired, in which case the app retargets
  // the motion to a different topic and this debate becomes the test. The
  // dashboard must not name the skill on exactly that day
  // (retestDisclosure.ts).
  const pendingRetest = coachingContext.pendingRetests[0] ?? null;
  const goal = buildCoachingGoal(
    ledger?.points ?? [],
    lastCoaching?.snapshot ?? null,
    drillOutcomes,
    // The pending retest's skill is EXCLUDED from the visible coaching goal,
    // not forced into it: the goal line is an instruction, and an instruction
    // for the skill under silent test would prompt the very behaviour the
    // retest is meant to measure (retestDisclosure.ts).
    skillsUnderTest(coachingContext.pendingRetests),
    coachingContext.reRepairDimensions,
    coachingContext.repairedDimensions,
  );

  // The drill row was loaded in the parallel block above (loop latency: no
  // second sequential await on the dashboard's critical path). An ATTEMPTED
  // drill is read too, so the feedback survives the refresh that follows the
  // submission: the rubric is deterministic, so the server can reproduce the
  // same observable signals from the stored attempt text. Without this the
  // learner submits a drill, the page refreshes, the component unmounts, and
  // the acknowledgement of what was observed disappears.
  const openDrill =
    openDrillRow && openDrillRow.status === "open"
      ? {
          title: openDrillRow.title,
          ...(openDrillRow.minutes !== null ? { minutes: openDrillRow.minutes } : {}),
          ...(openDrillRow.prompt !== null ? { prompt: openDrillRow.prompt } : {}),
          assignmentId: openDrillRow.id,
        }
      : null;
  const drillFeedback =
    openDrillRow && openDrillRow.status === "attempted" && openDrillRow.attemptText
      ? {
          title: openDrillRow.title,
          signals: drillSignalsFromAttempt(openDrillRow.dimension, openDrillRow.attemptText),
        }
      : null;
  const journeyInputs = await journeyInputsPromise;
  // Spaced re-check (M9): a stored skill-observed retest schedules a 7-day
  // durability check. Today only states it; nothing is inferred from scores.
  const recheckNow = new Date();
  const recheckRows = journeyInputs.repairs.map((r) => ({
    retest_outcome: r.retest_outcome,
    retest_completed_at: r.retest_completed_at,
  }));
  const recheckDue = nextDueRecheck(recheckRows, recheckNow);
  // Preview only: which fresh motion the due re-check would use. Starting it
  // needs the recheck_debate_id migration (held for Henry), so no link yet.
  const recheckPlan = planRecheck(
    journeyInputs.repairs.map((r) => ({
      id: (r as { id?: string }).id ?? "",
      retest_outcome: r.retest_outcome,
      retest_completed_at: r.retest_completed_at,
    })),
    GUEST_MOTIONS.map((m) => m.motion),
    {},
    recheckNow,
  );
  const recheckLine = recheckCopy(
    recheckDue
      ? recheckStatus(recheckDue, recheckNow)
      : (recheckRows
          .map((r) => recheckStatus(r, recheckNow))
          .filter((st) => st.state === "waiting")
          .sort((a, b) => (a.daysUntilDue ?? 0) - (b.daysUntilDue ?? 0))[0] ?? {
          state: "not-scheduled",
          dueAt: null,
          daysUntilDue: null,
        }),
  );
  // Canonical learner model — the same intelligence that drives Progress, so
  // Today leads with what to practise and why rather than a wall of cards.
  // Built from the same stored debates/repairs; a repair is practice, not mastery.
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
    // The skills under silent test stay off the visible coaching: the same
    // queue and the same rule every other surface uses.
    excludeSkills: skillsUnderTest(coachingContext.pendingRetests),
    // The training target follows the coaching line, so the target card and
    // the goal line describe one instruction.
    preferSkill: focusDimension,
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
    dueRetest:
      motion.servesRetest && pendingRetest
        ? // No skill label: the priority card states the loop without naming
          // the skill under silent test (retestDisclosure.ts). A label here
          // would also be the WRONG one — the visible goal is by definition a
          // different skill — so the field is removed rather than fixed.
          { attemptedAt: pendingRetest.attemptedAt }
        : null,
    openDrill,
    debateAvailable: !activeDebate,
  });

  const today = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: profile?.timezone ?? "UTC",
  }).format(new Date());

  const headerPills = homeHeaderPills(profile);
  const todayKey = dateKeyInTimeZone(profile?.timezone ?? "UTC");
  const week = profile ? weekDays(todayKey, streakDays(profile.current_streak, profile.last_activity_date, todayKey)) : [];

  return (
    <AppShell>
      <PageViewEvent name="daily_viewed" />
      <PageHeader
        eyebrow="Daily practice"
        title="Today"
        description={today}
        actions={
          headerPills.length > 0 && (
            <>
              {headerPills.map((pill) => (
                <span key={pill} className="pill tabular">{pill}</span>
              ))}
            </>
          )
        }
      />

      {/* ── Carried over from guest practice: why this account started non-empty ── */}
      {guestCarryover && (
        <section
          className="surface-card p-4"
          aria-labelledby="guest-carryover-heading"
          data-testid="guest-carryover"
        >
          {/* The server has already read this summary off the profile, so the
              browser copy is spent and can be dropped. */}
          <ClearGuestLoopHandoff />
          <p className="text-xs uppercase tracking-[0.14em] text-[var(--accent)]">
            Carried over from guest practice
          </p>
          <h2 id="guest-carryover-heading" className="mt-1 text-base font-semibold">
            Your first rep starts from {guestCarryover.label.toLowerCase()}
          </h2>
          <p className="mt-2 text-sm leading-6 text-ink2">
            Before signing up you practised {guestCarryover.motion ? `“${guestCarryover.motion}”` : "a motion"} and
            the loop flagged <strong>{guestCarryover.label}</strong> as the move to work on.
            {guestCarryover.repaired
              ? guestCarryover.observed
                ? " You repaired it, and it showed up again in the guest retest."
                : " You repaired it in the rewrite, though it did not reappear in the guest retest."
              : " You have not fully repaired it yet."}
            {guestCarryover.seedsFocus
              ? " It is pre-selected as your first debate’s focus below — change it there if you’d rather work on something else."
              : " Your first debate here starts without a set focus; the coach will flag one weakness from your own arguments."}
          </p>
          <p className="mt-2 rounded-lg border border-[var(--rule)] bg-surface-2 px-3 py-2 text-xs leading-4 text-ink3">
            A guest rep is one local practice run, not measured evidence — it is not counted in your
            skill scores, and it is not a deliberate retest or an improvement. At most it suggests what
            your first debate focuses on; your own completed debates are what build the profile.
          </p>
        </section>
      )}

      {/* ── Today's motion and the Start button lead: it is the one thing this
          screen is for. The training target and the loop explain it, so they
          follow (they used to push Start ~1,450px down a phone screen). ── */}
      <WeekStreak days={week} />

      <TopicCard
        topic={topic}
        activeDebateId={activeDebate?.id ?? null}
        evidenceCards={(evidenceRows ?? []) as unknown as EvidenceCardView[]}
        // The goal line is the day's VISIBLE coaching. When a retest is
        // pending it must not be the instruction for the skill under silent
        // test (retestDisclosure.ts) — `buildCoachingGoal` excludes that skill
        // already, and the fallback below is deliberately skill-agnostic.
        goalLine={goal?.goalLine ?? (pendingRetest ? NEUTRAL_GOAL_LINE : "Use evidence for major claims.")}
        lastLine={goal?.lastLine ?? null}
        whyLine={goal?.whyLine ?? null}
        focusLabel="Today's focus"
        motionReason={motion.reasonLine}
        isFirstVisit={!previousDebate}
        challengePreview={challengePreview}
        firstFocus={firstFocus}
      />
      {lapsedSkillKey && (
        <p
          className="rounded-lg border border-[var(--rule)] bg-surface-2 px-3 py-2 text-xs leading-5 text-ink3"
          role="status"
          data-testid="lapsed-retest-notice"
        >
          {lapsedRetestNotice(
            SKILL_DIMENSIONS[lapsedSkillKey].label,
            coachingContext.lapsedRetests.length,
          )}
        </p>
      )}
      {coachingContext.status !== "ok" && (
        <p className="text-xs text-ink3" role="status">
          Coaching context is temporarily {coachingContext.status}; today&apos;s debate is still available without treating missing data as progress.
        </p>
      )}

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
          <p className="mt-3 rounded-lg border border-[var(--rule)] bg-surface-2 px-3 py-2 text-xs leading-4 text-ink3">
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

      {recheckLine && (
        <p className="text-xs text-ink3" role="status" data-testid="recheck-note">
          {recheckLine}
          {recheckPlan && (
            <span data-testid="recheck-plan">
              {" "}
              Planned fresh motion: “{recheckPlan.motion}” ({recheckPlan.label}).
            </span>
          )}
        </p>
      )}

      {/* ── The loop: where you are in practice → diagnose → repair → retest → demonstrate ── */}
      <LoopThread thread={loopThread} />

      {/* ── Continue training: the single highest-priority unfinished action ── */}
      {priority && priority.kind !== "debate" && (
        <section
          className={`surface-card flex flex-col gap-3 p-4${isRetestHero(priority.kind) ? " border-[var(--accent)]" : ""}`}
          aria-labelledby="continue-training-heading"
          data-testid="continue-training"
        >
          <div className="min-w-0">
            <p className="home-secondary-kicker">{continueKicker(priority.kind)}</p>
            <h2 id="continue-training-heading" className="mt-1 text-base font-semibold">
              {priority.title}
            </h2>
            <p className="mt-1 text-sm leading-6 text-ink3">{priority.detail}</p>
          </div>
          {/* The drill prompt renders inline so completing today's drill needs
              no navigation hop — the loop's smallest complete step stays on
              the page the learner already opened. Only the assigned, still
              open drill shows this; the server recomputes everything on
              submit, so the form cannot score a drill the coach did not
              assign today. */}
          {priority.kind === "drill" && openDrill?.prompt && openDrill.assignmentId ? (
            <>
              <p className="rounded-lg border border-[var(--rule)] bg-surface-2 p-4 text-sm leading-relaxed">
                {openDrill.prompt}
              </p>
              <InlineDrillAttempt assignmentId={openDrill.assignmentId} />
              <Link
                href={priority.href}
                className="self-start text-xs font-medium text-ink3 underline underline-offset-2 hover:text-ink"
              >
                {priority.action} on Progress →
              </Link>
            </>
          ) : priority.kind === "retest" ? (
            <RetestStartButton topicId={topic.id} label={priority.action} />
          ) : (
            <Link
              href={priority.href}
              className="btn btn-primary shrink-0 self-start px-4 py-2 text-center text-sm sm:self-auto"
              data-testid={`priority-${priority.kind}`}
            >
              {priority.action} →
            </Link>
          )}
        </section>
      )}

      {/* ── Today's drill: checked. The receipt for the loop's smallest step
          must outlive the component that produced it — the drill row flips
          from "open" to "attempted" on submit, so a client-only feedback
          panel unmounts with the refresh and the learner is left with no
          acknowledgement of what was observed. The signals are recomputed
          server-side from the stored attempt (the rubric is deterministic), so
          this survives a refresh, a reload and a return visit. ── */}
      {drillFeedback && (
        <section
          className="surface-card flex flex-col gap-1 p-4"
          aria-labelledby="drill-feedback-heading"
          data-testid="drill-feedback"
        >
          <p className="home-secondary-kicker">Today&apos;s drill: {drillFeedback.title}</p>
          <h2 id="drill-feedback-heading" className="text-base font-semibold">
            {DRILL_FEEDBACK_COPY.heading}
          </h2>
          <p className="text-xs text-ink3">{DRILL_FEEDBACK_COPY.observationLabel}</p>
          <ul className="list-inside list-disc text-xs text-ink3">
            {drillFeedback.signals.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-ink3">{DRILL_FEEDBACK_COPY.note}</p>
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
                <SkillRadar profile={skillProfile} />
                <SkillProfileBars profile={skillProfile} />
              </div>
            ) : (
              <p>
                Finish today&apos;s debate to start your profile across {SKILL_ORDER.length} reasoning skills. Each
                one stays an early read until it has {MIN_PROFILE_DEBATES} debates behind it.
              </p>
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
