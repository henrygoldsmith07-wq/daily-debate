import { NextResponse } from "next/server";
import { createClient } from "@/lib/backend/server";
import type { PvpMatch, PvpTurn } from "@/lib/types";

// Participant-only snapshot of a match + its turns. Powers the room's
// reconnect/rejoin path when polling was interrupted or the tab missed updates.
export async function GET(_request: Request, { params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: match } = await db.from("pvp_matches").select("*").eq("id", matchId).single();
  if (!match || (match.player_a !== user.id && match.player_b !== user.id)) {
    return NextResponse.json({ error: "Match not found." }, { status: 404 });
  }

  const { data: turns } = await db
    .from("pvp_turns")
    .select("*")
    .eq("match_id", matchId)
    .order("round_number", { ascending: true })
    .order("created_at", { ascending: true });

  return NextResponse.json(
    { match: match as unknown as PvpMatch, turns: (turns ?? []) as unknown as PvpTurn[] },
    { headers: { "Cache-Control": "no-store" } },
  );
}
