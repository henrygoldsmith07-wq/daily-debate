import { createClient } from "@/lib/supabase/server";
import { getOrCreateTodayTopic } from "@/lib/dailyTopic";
import AppHeader from "@/components/AppHeader";
import TopicCard from "@/components/TopicCard";

// Generates today&apos;s topic via the Anthropic API on first request each day —
// not something that can be prerendered at build time.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const topic = await getOrCreateTodayTopic();

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
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
        <div>
          <p className="text-xs uppercase tracking-wide text-ink3">Today&apos;s topic</p>
          <h1 className="text-2xl font-semibold tracking-tight">{topic.title}</h1>
        </div>
        <TopicCard topic={topic} activeDebateId={activeDebate?.id ?? null} />
      </main>
    </div>
  );
}
