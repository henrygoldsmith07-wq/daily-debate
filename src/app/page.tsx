import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getTodayTopic } from "@/lib/dailyTopic";
import AppHeader from "@/components/AppHeader";
import GuestArena from "@/components/GuestArena";
import TopicCard, { type EvidenceCardView } from "@/components/TopicCard";
import { buildLedgerForUser } from "@/lib/skillLedgerServer";
import { METRIC_LABELS } from "@/lib/skillLedger";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
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

  const [{ data: activeDebate }, { data: profile }, { data: evidenceRows }, ledger] = await Promise.all([
    user
      ? supabase
          .from("solo_debates")
          .select("*")
          .eq("user_id", user.id)
          .eq("topic_id", topic.id)
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    user
      ? supabase.from("profiles").select("total_points, level, current_streak").eq("id", user.id).single()
      : Promise.resolve({ data: null }),
    supabase
      .from("topic_evidence")
      .select("*")
      .eq("topic_id", topic.id)
      .order("created_at", { ascending: true })
      .limit(4),
    user ? buildLedgerForUser(user.id) : Promise.resolve(null),
  ]);

  // Coaching signals
  const improving = ledger?.improvements ?? [];
  const regressions = ledger?.regressions ?? [];
  const weaknessKey = regressions[0] ?? Object.entries(ledger?.trajectories ?? {})
    .filter(([, t]) => t.last !== null && t.improved === false)
    .sort(([, a], [, b]) => (a.goodnessDelta ?? 0) - (b.goodnessDelta ?? 0))[0]?.[0];
  const improvementKey = improving[0];
  const skillRating = ledger?.points.length
    ? Math.round(
        Object.values(ledger.trajectories)
          .map(t => t.last ?? 50)
          .reduce((s, v) => s + v, 0) / METRIC_KEYS_COUNT * 100
      )
    : null;

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <main id="main" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
        <div>
          <p className="text-xs uppercase tracking-wide text-ink3">Today&apos;s debate</p>
          <h1 className="text-2xl font-semibold tracking-tight">{topic.title}</h1>
        </div>

        {/* Coaching signals — the hero content */}
        {(weaknessKey || improvementKey || skillRating !== null) && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {weaknessKey && (
              <div className="surface-card px-4 py-3 text-center">
                <p className="text-xs uppercase tracking-wide text-[var(--bad)]">Current weakness</p>
                <p className="mt-1 text-sm font-medium">{METRIC_LABELS[weaknessKey as keyof typeof METRIC_LABELS]}</p>
              </div>
            )}
            {improvementKey && (
              <div className="surface-card px-4 py-3 text-center">
                <p className="text-xs uppercase tracking-wide text-[var(--accent)]">Recent improvement</p>
                <p className="mt-1 text-sm font-medium">{METRIC_LABELS[improvementKey as keyof typeof METRIC_LABELS]}</p>
              </div>
            )}
            {skillRating !== null && (
              <div className="surface-card px-4 py-3 text-center">
                <p className="text-xs uppercase tracking-wide text-ink3">Skill rating</p>
                <p className="tabular mt-1 text-lg font-bold">{skillRating}</p>
              </div>
            )}
          </div>
        )}

        {/* Level + streak — secondary, compact */}
        {profile && (
          <div className="flex items-center justify-between px-4 py-2 rounded-lg bg-surface-2 text-xs text-ink3">
            <span>Level {profile.level} · {profile.total_points} pts</span>
            <span>🔥 {profile.current_streak}-day streak</span>
            <Link href="/dna" className="font-medium text-[var(--accent)] hover:underline">Argument DNA →</Link>
          </div>
        )}

        <TopicCard topic={topic} activeDebateId={activeDebate?.id ?? null} evidenceCards={(evidenceRows ?? []) as unknown as EvidenceCardView[]} />
      </main>
    </div>
  );
}

const METRIC_KEYS_COUNT = 11;
