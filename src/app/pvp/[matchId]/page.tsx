import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppHeader from "@/components/AppHeader";
import PvpRoom from "@/components/PvpRoom";
import type { PvpMatch, PvpTurn } from "@/lib/types";

export default async function PvpMatchPage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: match } = await supabase.from("pvp_matches").select("*").eq("id", matchId).single();
  if (!match || (match.player_a !== user.id && match.player_b !== user.id)) notFound();

  const { data: topic } = await supabase.from("daily_topics").select("*").eq("id", match.topic_id).single();
  if (!topic) notFound();

  const { data: turns } = await supabase
    .from("pvp_turns")
    .select("*")
    .eq("match_id", matchId)
    .order("round_number", { ascending: true })
    .order("created_at", { ascending: true });

  const [{ data: playerAProfile }, { data: playerBProfile }] = await Promise.all([
    supabase.from("profiles").select("id, username").eq("id", match.player_a).single(),
    supabase.from("profiles").select("id, username").eq("id", match.player_b).single(),
  ]);

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-8">
        <PvpRoom
          match={match as unknown as PvpMatch}
          topic={topic}
          initialTurns={(turns ?? []) as unknown as PvpTurn[]}
          currentUserId={user.id}
          playerAName={playerAProfile?.username ?? "Player A"}
          playerBName={playerBProfile?.username ?? "Player B"}
        />
      </main>
    </div>
  );
}
