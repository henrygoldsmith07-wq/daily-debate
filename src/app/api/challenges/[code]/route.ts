import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/backend/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { isValidChallengeCode, opponentSideOf } from "@/lib/friendChallenge";
import { PVP_ROUNDS } from "@/lib/types";
import { recordProductEventForUser } from "@/lib/productEvents";

interface RouteParams {
  params: Promise<{ code: string }>;
}

/** The invite row. Relations are fetched separately — see the note in GET. */
interface InviteRow {
  id: string;
  code: string;
  status: string;
  challenger_id: string;
  challenger_side: string;
  expires_at: string;
  topic_id: string;
}

const INVITE_SELECT = "id, code, status, challenger_id, challenger_side, expires_at, topic_id";

interface AcceptChallengeOutcome {
  result: "accepted" | "accepted_existing" | "not_found" | "self" | "closed" | "active_match";
  created_match_id: string | null;
  challenger_side: string | null;
}

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

  const invite = inviteRow as unknown as InviteRow;
  // The owned SQL builder intentionally supports only flat projections, not
  // Supabase/PostgREST relation syntax — the old single-select with
  // `daily_topics(title)` / `profiles!fkey(username)` threw in the builder's
  // identifier check, so this endpoint always returned 404. The page already
  // fetched both relations explicitly; do the same here.
  const [{ data: topic }, { data: challengerProfile }] = await Promise.all([
    service.from("daily_topics").select("title").eq("id", invite.topic_id).maybeSingle(),
    service.from("profiles").select("username").eq("id", invite.challenger_id).maybeSingle(),
  ]);
  const expired = new Date(invite.expires_at).getTime() < Date.now();
  return NextResponse.json({
    invite: {
      code: invite.code,
      status: expired && invite.status === "open" ? "expired" : invite.status,
      challengerSide: invite.challenger_side,
      opponentSide: opponentSideOf(invite.challenger_side),
      expiresAt: invite.expires_at,
      motion: topic?.title ?? null,
      challengerName: challengerProfile?.username ?? "A debater",
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
  const accepted = await service.rpc("accept_friend_challenge", {
    p_code: code,
    p_opponent: user.id,
    p_round_limit: PVP_ROUNDS,
  });
  if (accepted.error) {
    console.error("Failed to accept challenge invite:", accepted.error);
    return NextResponse.json({ error: "Failed to accept the challenge." }, { status: 500 });
  }

  const outcome = Array.isArray(accepted.data)
    ? (accepted.data[0] as unknown as AcceptChallengeOutcome | undefined) ?? null
    : null;
  if (!outcome || outcome.result === "not_found") {
    return NextResponse.json({ error: "Challenge not found." }, { status: 404 });
  }
  if (outcome.result === "self") {
    return NextResponse.json({ error: "You can't accept your own challenge — share the link with a friend." }, { status: 409 });
  }
  if (outcome.result === "active_match") {
    return NextResponse.json({ error: "Finish your active PvP match before accepting a challenge." }, { status: 409 });
  }
  if (
    (outcome.result !== "accepted" && outcome.result !== "accepted_existing") ||
    typeof outcome.created_match_id !== "string"
  ) {
    return NextResponse.json({ error: "This challenge is no longer open." }, { status: 409 });
  }

  const challengerSide = outcome.challenger_side === "for" ? "for" : "against";
  if (outcome.result === "accepted") {
    await recordProductEventForUser(user.id, "challenge_link_accepted", { side: opponentSideOf(challengerSide) });
  }

  return NextResponse.json({
    matchId: outcome.created_match_id,
    opponentSide: opponentSideOf(challengerSide),
    reused: outcome.result === "accepted_existing",
  });
}
