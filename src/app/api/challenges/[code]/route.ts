import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/backend/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { isValidChallengeCode, opponentSideOf } from "@/lib/friendChallenge";
import { PVP_ROUNDS } from "@/lib/types";
import { recordProductEvent } from "@/lib/productEvents";

interface RouteParams {
  params: Promise<{ code: string }>;
}

/** The invite row with its joined topic title and challenger username. */
interface InviteWithJoins {
  id: string;
  code: string;
  status: string;
  challenger_id: string;
  challenger_side: string;
  expires_at: string;
  topic_id: string;
  daily_topics: { title: string } | null;
  profiles: { username: string | null } | null;
}

const INVITE_SELECT = "id, code, status, challenger_side, expires_at, topic_id, daily_topics(title), profiles!challenge_invites_challenger_id_fkey(username)";

/** View a challenge by code (no auth needed to preview; accept requires login). */
export async function GET(request: Request, { params }: RouteParams) {
  const limited = await checkRateLimit(request, { name: "challenge-view", limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const { code } = await params;
  if (!isValidChallengeCode(code)) return NextResponse.json({ error: "Invalid challenge link." }, { status: 400 });

  const service = createServiceClient();
  const { data: inviteRow } = await service
    .from("challenge_invites")
    .select(INVITE_SELECT)
    .eq("code", code)
    .maybeSingle();
  if (!inviteRow) return NextResponse.json({ error: "Challenge not found." }, { status: 404 });

  const invite = inviteRow as unknown as InviteWithJoins;
  const expired = new Date(invite.expires_at).getTime() < Date.now();
  return NextResponse.json({
    invite: {
      code: invite.code,
      status: expired && invite.status === "open" ? "expired" : invite.status,
      challengerSide: invite.challenger_side,
      opponentSide: opponentSideOf(invite.challenger_side),
      expiresAt: invite.expires_at,
      motion: invite.daily_topics?.title ?? null,
      challengerName: invite.profiles?.username ?? "A debater",
    },
  });
}

/**
 * Accept a challenge: creates the PvP match with sides fixed by the invite.
 * The challenger takes the opening turn, so nobody has to be online at the
 * same time. The one-active-match invariant still holds (partial unique index
 * on pvp_matches), and expired/cancelled invites are refused.
 */
export async function POST(request: Request, { params }: RouteParams) {
  const limited = await checkRateLimit(request, { name: "challenge-accept", limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  const { code } = await params;
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to accept this challenge." }, { status: 401 });

  if (!isValidChallengeCode(code)) return NextResponse.json({ error: "Invalid challenge link." }, { status: 400 });

  const service = createServiceClient();
  const { data: inviteRow } = await service
    .from("challenge_invites")
    .select("*")
    .eq("code", code)
    .maybeSingle();
  if (!inviteRow) return NextResponse.json({ error: "Challenge not found." }, { status: 404 });
  const invite = inviteRow as unknown as InviteWithJoins;
  if (invite.challenger_id === user.id) {
    return NextResponse.json({ error: "You can't accept your own challenge — share the link with a friend." }, { status: 409 });
  }
  if (invite.status !== "open" || new Date(invite.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "This challenge is no longer open." }, { status: 409 });
  }

  const { data: activeMatch } = await service
    .from("pvp_matches")
    .select("id")
    .or(`player_a.eq.${user.id},player_b.eq.${user.id}`)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (activeMatch) {
    return NextResponse.json({ error: "Finish your active PvP match before accepting a challenge." }, { status: 409 });
  }

  // Claim the invite atomically: only the first concurrent accept wins.
  const { data: claimed, error: claimError } = await service
    .from("challenge_invites")
    .update({ status: "accepted", opponent_id: user.id })
    .eq("id", invite.id)
    .eq("status", "open")
    .select("id");
  if (claimError) {
    console.error("Failed to claim challenge invite:", claimError);
    return NextResponse.json({ error: "Failed to accept the challenge." }, { status: 500 });
  }
  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ error: "This challenge is no longer open." }, { status: 409 });
  }

  const { data: match, error: matchError } = await service
    .from("pvp_matches")
    .insert({
      topic_id: invite.topic_id,
      player_a: invite.challenger_id,
      player_b: user.id,
      player_a_side: invite.challenger_side,
      round_limit: PVP_ROUNDS,
      current_turn_player: invite.challenger_id, // challenger opens the debate
      turn_started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (matchError || !match) {
    console.error("Failed to create challenge match:", matchError);
    await service.from("challenge_invites").update({ status: "open", opponent_id: null }).eq("id", invite.id);
    return NextResponse.json({ error: matchError?.code === "23505" ? "Finish your active PvP match before accepting a challenge." : "Failed to accept the challenge." }, { status: matchError?.code === "23505" ? 409 : 500 });
  }

  await service.from("challenge_invites").update({ match_id: match.id }).eq("id", invite.id);

  void recordProductEvent("challenge_link_accepted", { side: opponentSideOf(invite.challenger_side) });

  return NextResponse.json({ matchId: match.id, opponentSide: opponentSideOf(invite.challenger_side) });
}
