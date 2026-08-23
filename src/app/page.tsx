import { createClient } from "@/lib/supabase/server";
import { getOrCreateTodayTopic } from "@/lib/dailyTopic";
import AppHeader from "@/components/AppHeader";
import TopicCard from "@/components/TopicCard";

// Generates today's topic via the OpenRouter API on first request each day —
// not something that can be prerendered at build time.
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

  const { data: activeDebate } = user
    ? await supabase
        .from("solo_debates")
        .select("*")
        .eq("user_id", user.id)
        .eq("topic_id", topic.id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <main id="main" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
        <div>
          <p className="text-xs uppercase tracking-wide text-ink3">Today&apos;s topic</p>
          <h1 className="text-2xl font-semibold tracking-tight">{topic.title}</h1>
        </div>
        <TopicCard topic={topic} activeDebateId={activeDebate?.id ?? null} />
      </main>
    </div>
  );
}
