import Link from "next/link";
import { createClient } from "@/lib/backend/server";
import { getTodayTopic } from "@/lib/dailyTopic";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import GuestArena from "@/components/GuestArena";
import TopicCard, { type EvidenceCardView } from "@/components/TopicCard";
import SkillProfileBars from "@/components/SkillProfileBars";
import { buildLedgerForUser } from "@/lib/skillLedgerServer";
import { computeSkillProfile } from "@/lib/skillProfile";
import { METRIC_LABELS, type MetricKey } from "@/lib/skillLedger";
import { isDatabaseConfigured } from "@/lib/backend/env";

export const dynamic = "force-dynamic";

const COACHING_FOCUS: Record<MetricKey, string> = {
  unsupportedClaimRate: "Use evidence for major claims.",
  rebuttalCoverage: "Answer the strongest point before adding a new one.",
  evidenceGrounding: "Tie each major claim to a source.",
  droppedArguments: "Close the loop on every claim you introduce.",
  contradictions: "Keep your position consistent as the debate shifts.",
  impactHandling: "Explain why your evidence changes the decision.",
  steelmanQuality: "State the opposing case in its strongest form.",
  fallacyRate: "Check the reasoning step between facts and conclusions.",
  causalOverclaims: "Make the causal bridge explicit.",
  fakePrecisionHits: "Use precise numbers only when the source supports them.",
  uncitedEvidenceRate: "Name the source when you use evidence.",
  clarity: "Make the claim and its reason easy to follow.",
};

function focusFor(key: string | undefined): string {
  return key && key in COACHING_FOCUS
    ? COACHING_FOCUS[key as MetricKey]
    : "Use evidence for major claims.";
}

function formatShortDate(value: string | null | undefined): string {
  if (!value) return "Date unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unknown";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(date);
}

export default async function DashboardPage() {
  if (!isDatabaseConfigured()) {
    return <GuestArena />;
  }

  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    return <GuestArena />;
  }

  // getTodayTopic never throws — it falls back to a curated motion when
  // nothing is pre-stored, so the dashboard always has content.
  const topic = await getTodayTopic();

  const [{ data: activeDebate }, { data: profile }, { data: evidenceRows }, { data: previousDebate }, ledger] =
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
      db.from("profiles").select("total_points, level, current_streak").eq("id", user.id).single(),
      db
        .from("topic_evidence")
        .select("*")
        .eq("topic_id", topic.id)
        .order("created_at", { ascending: true })
        .limit(4),
      db
        .from("solo_debates")
        .select("id, topic_id, side, total_score, round_count, created_at, completed_at")
        .eq("user_id", user.id)
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      buildLedgerForUser(user.id),
    ]);

  let previousDebateTitle: string | null = null;
  if (previousDebate?.topic_id) {
    const { data: previousTopic } = await db
      .from("daily_topics")
      .select("title")
      .eq("id", previousDebate.topic_id)
      .maybeSingle();
    previousDebateTitle = previousTopic?.title ?? null;
  }

  const improving = ledger?.improvements ?? [];
  const regressions = ledger?.regressions ?? [];
  const weaknessKey =
    regressions[0] ??
    Object.entries(ledger?.trajectories ?? {})
      .filter(([, trajectory]) => trajectory.last !== null && trajectory.improved === false)
      .sort(([, a], [, b]) => (a.goodnessDelta ?? 0) - (b.goodnessDelta ?? 0))[0]?.[0];
  const improvementKey = improving[0];
  const skillProfile = ledger ? computeSkillProfile(ledger.points) : null;
  const coachingKey = weaknessKey ?? improvementKey;
  const coachingMetric = coachingKey ? METRIC_LABELS[coachingKey as MetricKey] : null;
  const coachingFocus = focusFor(coachingKey);

  const today = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  return (
    <AppShell>
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

      <TopicCard
        topic={topic}
        activeDebateId={activeDebate?.id ?? null}
        evidenceCards={(evidenceRows ?? []) as unknown as EvidenceCardView[]}
        coachingFocus={coachingFocus}
      />

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
              {skillProfile?.overallScore != null && (
                <span className="tabular text-lg font-bold">
                  {skillProfile.overallScore}
                  <span className="text-xs font-medium text-ink3">/100</span>
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
                {formatShortDate(previousDebate.completed_at ?? previousDebate.created_at)} · arguing{" "}
                {previousDebate.side} · {previousDebate.total_score ?? "—"}/100
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
            <p className="home-secondary-kicker">Coaching</p>
            <h3>One move for today</h3>
            <p className="home-secondary-meta">
              {coachingMetric ? `Based on ${coachingMetric.toLowerCase()}` : "A clear target for your next rep"}
            </p>
            <div className="home-secondary-highlight">
              <span className="home-coaching-label">Focus</span>
              <br />
              {coachingFocus}
            </div>
            <Link href="/dna" className="home-secondary-action">
              See Argument DNA →
            </Link>
          </article>

          <article className="home-secondary-card">
            <p className="home-secondary-kicker">Rankings &amp; history</p>
            <h3>Keep your place</h3>
            <p>See your streak, past calls, and where you land among other debaters.</p>
            <div className="home-secondary-links">
              <Link href="/leaderboard">Rankings ↗</Link>
              <Link href="/history">History ↗</Link>
            </div>
          </article>
        </div>
      </section>
    </AppShell>
  );
}
