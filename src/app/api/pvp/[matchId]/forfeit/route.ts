import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/backend/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { TURN_ABANDON_MINUTES, type PvpVerdict } from "@/lib/types";

// Abandoned-match handling: when the opponent has held the turn for longer
// than the abandon window, the waiting player may claim a forfeit. The match
// completes with an explicit insufficient_evidence verdict — no points, no
// fabricated judge score, just a recorded outcome.

export async function POST(request: Request, { params }: { params: Promise<{ matchId: string }> }) {
  const limited = await checkRateLimit(request, { name: "pvp-forfeit", limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  const { matchId } = await params;
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dbService = createServiceClient();
  const { data: match } = await dbService.from("pvp_matches").select("*").eq("id", matchId).single();
  if (!match || (match.player_a !== user.id && match.player_b !== user.id)) {
    return NextResponse.json({ error: "Match not found." }, { status: 404 });
  }
  if (match.status !== "active") return NextResponse.json({ error: "Match already completed." }, { status: 409 });
  if (match.current_turn_player === user.id || !match.current_turn_player) {
    return NextResponse.json({ error: "It is your turn — nothing to forfeit." }, { status: 409 });
  }

  const turnStarted = match.turn_started_at ? new Date(match.turn_started_at).getTime() : null;
  if (!turnStarted) return NextResponse.json({ error: "Turn timing unavailable for this match." }, { status: 409 });

  const elapsed = Date.now() - turnStarted;
  if (elapsed <= TURN_ABANDON_MINUTES * 60_000) {
    const waitMinutes = Math.ceil((TURN_ABANDON_MINUTES * 60_000 - elapsed) / 60_000);
    return NextResponse.json(
      { error: `Opponent still has ${waitMinutes} min to move.` },
      { status: 409 },
    );
  }

  const winnerId = user.id;
  const verdict: PvpVerdict = {
    winner: winnerId === match.player_a ? "a" : "b",
    playerAScore: 0,
    playerBScore: 0,
    rationale: `Won by forfeit: the opponent did not respond within ${TURN_ABANDON_MINUTES} minutes.`,
    isTie: false,
    tieReason: undefined,
    scoreStatus: "insufficient_evidence",
  };

  // Concurrency guard: only the first claim completes the match.
  const { data: updated } = await dbService
    .from("pvp_matches")
    .update({
      status: "completed",
      current_turn_player: null,
      winner_id: winnerId,
      judge_verdict: verdict,
      completed_at: new Date().toISOString(),
    })
    .eq("id", matchId)
    .eq("status", "active")
    .select("id");

  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: "Match already completed." }, { status: 409 });
  }

  // scoreStatus is insufficient_evidence → no profile points are awarded.
  return NextResponse.json({ ok: true, verdict });
}
