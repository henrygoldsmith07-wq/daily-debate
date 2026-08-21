import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppHeader from "@/components/AppHeader";
import DebateRoom from "@/components/DebateRoom";
import type { SoloDebate, SoloDebateTurn } from "@/lib/types";

export default async function DebatePage({ params }: { params: Promise<{ debateId: string }> }) {
  const { debateId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: debate } = await supabase
    .from("solo_debates")
    .select("*")
    .eq("id", debateId)
    .eq("user_id", user.id)
    .single();
  if (!debate) notFound();

  const { data: topic } = await supabase.from("daily_topics").select("*").eq("id", debate.topic_id).single();
  if (!topic) notFound();

  const { data: turns } = await supabase
    .from("solo_debate_turns")
    .select("*")
    .eq("debate_id", debateId)
    .order("round_number", { ascending: true });

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-8">
        <DebateRoom
          debate={debate as unknown as SoloDebate}
          topic={topic}
          initialTurns={(turns ?? []) as unknown as SoloDebateTurn[]}
        />
      </main>
    </div>
  );
}
