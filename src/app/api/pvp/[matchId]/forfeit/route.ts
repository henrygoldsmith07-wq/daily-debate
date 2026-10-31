import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/backend/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { type PvpVerdict } from "@/lib/types";
import { clockLengthLabel, formatClock, turnExpired, turnMsLeft } from "@/lib/pvpTurnClock";

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
  const { data: match, error: matchError } = await dbService
    .from("pvp_matches")
    .select("*")
    .eq("id", matchId)
    .maybeSingle();
  // A failed read is not "no such match"; say so instead of a misleading 404.
  if (matchError) {
    console.error("pvp forfeit match read failed:", matchError);
    return NextResponse.json({ error: "Could not load the match. Try again." }, { status: 503 });
  }
  if (!match || (match.player_a !== user.id && match.player_b !== user.id)) {
    return NextResponse.json({ error: "Match not found." }, { status: 404 });
  }
  if (match.status !== "active") return NextResponse.json({ error: "Match already completed." }, { status: 409 });
  if (match.current_turn_player === user.id || !match.current_turn_player) {
    return NextResponse.json({ error: "It is your turn — nothing to forfeit." }, { status: 409 });
  }

  const turnStarted = match.turn_started_at ? new Date(match.turn_started_at).getTime() : null;
  if (!turnStarted) return NextResponse.json({ error: "Turn timing unavailable for this match." }, { status: 409 });

  // The same clock the turn route enforces: claimable only once the
  // opponent's turn is over by the server's reckoning (deadline + grace).
  if (!turnExpired(match.turn_started_at, Date.now())) {
    const left = turnMsLeft(match.turn_started_at, Date.now()) ?? 0;
    return NextResponse.json(
      { error: `Your opponent's turn clock still has ${formatClock(left)} on it.` },
      { status: 409 },
    );
  }

  const winnerId = user.id;
  const verdict: PvpVerdict = {
    winner: winnerId === match.player_a ? "a" : "b",
    playerAScore: 0,
    playerBScore: 0,
    rationale: `Won by forfeit: the opponent's turn clock (${clockLengthLabel()}) ran out.`,
    isTie: false,
    tieReason: undefined,
    scoreStatus: "insufficient_evidence",
  };

  // Concurrency guard: only the first claim completes the match.
  const { data: updated, error: updateError } = await dbService
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

  // A failed write is not "someone else already completed it": the claim did
  // not land and the player should retry.
  if (updateError) {
    console.error("pvp forfeit update failed:", updateError);
    return NextResponse.json({ error: "Could not record the forfeit. Try again." }, { status: 503 });
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: "Match already completed." }, { status: 409 });
  }

  // scoreStatus is insufficient_evidence → no profile points are awarded.
  return NextResponse.json({ ok: true, verdict });
}
