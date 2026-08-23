import { createClient } from "@/lib/supabase/server";
import { getOrCreateTodayTopic } from "@/lib/dailyTopic";
import AppHeader from "@/components/AppHeader";
import TopicCard from "@/components/TopicCard";
import { pointsIntoLevel, POINTS_PER_LEVEL } from "@/lib/gamification";

// Generates today's topic via the AI provider chain (NVIDIA primary) on
// first request each day — not something that can be prerendered at build time.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let topic: Awaited<ReturnType<typeof getOrCreateTodayTopic>> | null = null;
  try {
    topic = await getOrCreateTodayTopic();
  } catch (error) {
    console.error("Failed to load daily topic:", error);
  }

  if (!topic) {
    return (
      <div className="flex min-h-screen flex-col">
        <AppHeader />
        <main id="main" className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-4 px-4 py-10 text-center sm:px-6">
          <h1 className="text-2xl font-semibold tracking-tight">Today&apos;s topic isn&apos;t ready</h1>
          <p className="text-sm text-ink3">
            We couldn&apos;t generate today&apos;s debate topic. Please refresh in a moment — if it keeps failing, the
            topic service may be temporarily down.
          </p>
        </main>
      </div>
    );
  }

  const [{ data: activeDebate }, { data: profile }] = await Promise.all([
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
  ]);

  const intoLevel = profile ? pointsIntoLevel(profile.total_points) : 0;
  const levelPct = Math.round((intoLevel / POINTS_PER_LEVEL) * 100);

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <main id="main" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
        <div>
          <p className="text-xs uppercase tracking-wide text-ink3">Today&apos;s topic</p>
          <h1 className="text-2xl font-semibold tracking-tight">{topic.title}</h1>
        </div>
        {profile && (
          <div className="surface-card flex items-center gap-4 px-4 py-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs text-ink3">
                <span className="font-medium text-[var(--foreground)]">Level {profile.level}</span>
                <span className="tabular">
                  {intoLevel}/{POINTS_PER_LEVEL} pts to Level {profile.level + 1}
                </span>
              </div>
              <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={POINTS_PER_LEVEL}
                aria-valuenow={intoLevel}
                aria-label={`Level ${profile.level} progress`}
              >
                <div className="h-full rounded-full bg-[var(--accent)] transition-all" style={{ width: `${levelPct}%` }} />
              </div>
            </div>
            <p className="tabular shrink-0 text-sm text-ink3" title="Daily streak">
              🔥 {profile.current_streak}
            </p>
          </div>
        )}
        <TopicCard topic={topic} activeDebateId={activeDebate?.id ?? null} />
      </main>
    </div>
  );
}
