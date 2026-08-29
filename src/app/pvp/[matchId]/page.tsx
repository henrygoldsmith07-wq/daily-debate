import { notFound } from "next/navigation";
import { createClient } from "@/lib/backend/server";
import AppShell from "@/components/AppShell";
import PvpRoom from "@/components/PvpRoom";
import type { PvpMatch, PvpTurn } from "@/lib/types";

export default async function PvpMatchPage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) notFound();

  const { data: match } = await db.from("pvp_matches").select("*").eq("id", matchId).single();
  if (!match || (match.player_a !== user.id && match.player_b !== user.id)) notFound();

  const { data: topic } = await db.from("daily_topics").select("*").eq("id", match.topic_id).single();
  if (!topic) notFound();

  const { data: turns } = await db
    .from("pvp_turns")
    .select("*")
    .eq("match_id", matchId)
    .order("round_number", { ascending: true })
    .order("created_at", { ascending: true });

  const [{ data: playerAProfile }, { data: playerBProfile }] = await Promise.all([
    db.from("profiles").select("id, username").eq("id", match.player_a).single(),
    db.from("profiles").select("id, username").eq("id", match.player_b).single(),
  ]);

  return (
    <AppShell width="narrow">
      <PvpRoom
        match={match as unknown as PvpMatch}
        topic={topic}
        initialTurns={(turns ?? []) as unknown as PvpTurn[]}
        currentUserId={user.id}
        playerAName={playerAProfile?.username ?? "Player A"}
        playerBName={playerBProfile?.username ?? "Player B"}
      />
    </AppShell>
  );
}
