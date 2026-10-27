import { NextResponse } from "next/server";
import { createClient } from "@/lib/backend/server";
import { checkRateLimit } from "@/lib/rateLimit";
import type { PvpMatch, PvpTurn } from "@/lib/types";

// Participant-only snapshot of a match + its turns. Powers the room's
// reconnect/rejoin path when polling was interrupted or the tab missed updates.
export async function GET(request: Request, { params }: { params: Promise<{ matchId: string }> }) {
  // The reconnect path polls; bound it so a stuck tab cannot hammer the
  // database with full-transcript reads.
  const limited = await checkRateLimit(request, { name: "pvp-match-read", limit: 120, windowMs: 60_000 });
  if (limited) return limited;

  const { matchId } = await params;
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: match, error: matchError } = await db.from("pvp_matches").select("*").eq("id", matchId).maybeSingle();
  // A failed read is not "no such match": a 404 here makes the room treat a
  // transient outage as a deleted match and drop the player out of it.
  if (matchError) {
    console.error("pvp match read failed:", matchError);
    return NextResponse.json({ error: "Could not load the match. Try again." }, { status: 503 });
  }
  if (!match || (match.player_a !== user.id && match.player_b !== user.id)) {
    return NextResponse.json({ error: "Match not found." }, { status: 404 });
  }

  const { data: turns, error: turnsError } = await db
    .from("pvp_turns")
    .select("*")
    .eq("match_id", matchId)
    .order("round_number", { ascending: true })
    .order("created_at", { ascending: true });

  // An empty transcript from a failed read would overwrite the room's
  // already-rendered turns on reconnect; fail instead.
  if (turnsError) {
    console.error("pvp turns read failed:", turnsError);
    return NextResponse.json({ error: "Could not load the match. Try again." }, { status: 503 });
  }

  return NextResponse.json(
    { match: match as unknown as PvpMatch, turns: (turns ?? []) as unknown as PvpTurn[] },
    { headers: { "Cache-Control": "no-store" } },
  );
}
