import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getTodayTopic } from "@/lib/dailyTopic";
import AppHeader from "@/components/AppHeader";
import GuestArena from "@/components/GuestArena";
import TopicCard, { type EvidenceCardView } from "@/components/TopicCard";
import SkillProfileBars from "@/components/SkillProfileBars";
import { buildLedgerForUser } from "@/lib/skillLedgerServer";
import { computeSkillProfile } from "@/lib/skillProfile";
import { METRIC_LABELS, type MetricKey } from "@/lib/skillLedger";
import { isSupabaseConfigured } from "@/lib/supabase/env";

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
  if (!isSupabaseConfigured()) {
    return <GuestArena />;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <GuestArena />;
  }

  // getTodayTopic never throws — it falls back to a curated motion when
  // nothing is pre-stored, so the dashboard always has content.
  const topic = await getTodayTopic();

  const [{ data: activeDebate }, { data: profile }, { data: evidenceRows }, { data: previousDebate }, ledger] =
    await Promise.all([
      supabase
        .from("solo_debates")
        .select("*")
        .eq("user_id", user.id)
        .eq("topic_id", topic.id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("profiles").select("total_points, level, current_streak").eq("id", user.id).single(),
      supabase
        .from("topic_evidence")
        .select("*")
        .eq("topic_id", topic.id)
        .order("created_at", { ascending: true })
        .limit(4),
      supabase
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
    const { data: previousTopic } = await supabase
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

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <main id="main" className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
        <TopicCard
          topic={topic}
          activeDebateId={activeDebate?.id ?? null}
          evidenceCards={(evidenceRows ?? []) as unknown as EvidenceCardView[]}
          coachingFocus={coachingFocus}
        />

        <section className="home-secondary-grid" aria-label="Continue your practice">
          <article className="home-secondary-card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-ink3">Skill progress</p>
                <h2>Build your argument profile</h2>
              </div>
              {skillProfile?.overallScore != null && (
                <span className="tabular text-lg font-bold">{skillProfile.overallScore}<span className="text-xs font-medium text-ink3">/100</span></span>
              )}
            </div>
            {skillProfile ? (
              <div className="mt-1 overflow-hidden">
                <SkillProfileBars profile={skillProfile} />
              </div>
            ) : (
              <p>Complete a debate to start seeing your reasoning strengths and gaps.</p>
            )}
            {profile && (
              <p className="home-secondary-meta">Level {profile.level} · {profile.total_points} points · 🔥 {profile.current_streak}-day streak</p>
            )}
            <Link href="/progress" className="home-secondary-action">Open progress →</Link>
          </article>

          <article className="home-secondary-card">
            <p className="text-xs uppercase tracking-wide text-ink3">Previous debate</p>
            <h2>{previousDebateTitle ?? "Your first rep is waiting"}</h2>
            {previousDebate ? (
              <p className="home-secondary-meta">
                {formatShortDate(previousDebate.completed_at ?? previousDebate.created_at)} · arguing {previousDebate.side} · {previousDebate.total_score ?? "—"}/100
              </p>
            ) : (
              <p>After your first debate, this is where you can jump back into the reasoning.</p>
            )}
            <Link href={previousDebate ? `/debate/${previousDebate.id}` : "/history"} className="home-secondary-action">
              {previousDebate ? "Review debate →" : "See history →"}
            </Link>
          </article>

          <article className="home-secondary-card">
            <p className="text-xs uppercase tracking-wide text-ink3">Coaching details</p>
            <h2>One move for today</h2>
            <p className="home-secondary-meta">{coachingMetric ? `Based on ${coachingMetric.toLowerCase()}` : "A clear target for your next rep"}</p>
            <div className="home-secondary-highlight">
              <span className="home-coaching-label">Focus</span>
              <br />
              {coachingFocus}
              <p className="mt-2 text-xs text-ink3">Finish the debate to unlock a one-minute repair for this kind of move.</p>
            </div>
            <Link href="/dna" className="home-secondary-action">See Argument DNA →</Link>
          </article>

          <article className="home-secondary-card">
            <p className="text-xs uppercase tracking-wide text-ink3">Rankings &amp; history</p>
            <h2>Keep your place</h2>
            <p>See your streak, past calls, and where you land among other debaters.</p>
            <div className="home-secondary-links">
              <Link href="/leaderboard">Rankings ↗</Link>
              <Link href="/history">History ↗</Link>
            </div>
          </article>
        </section>
      </main>
    </div>
  );
}
