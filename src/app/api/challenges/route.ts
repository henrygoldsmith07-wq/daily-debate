import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/backend/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { getOrCreateTodayTopic } from "@/lib/dailyTopic";
import { generateChallengeCode, challengeExpiry, opponentSideOf } from "@/lib/friendChallenge";
import { recordProductEvent } from "@/lib/productEvents";
import type { DebateSide } from "@/lib/types";

/** Create a shareable friend challenge on today's motion. */
export async function POST(request: Request) {
  const limited = await checkRateLimit(request, { name: "challenge-create", limit: 6, windowMs: 60_000 });
  if (limited) return limited;

  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const side: DebateSide | null = body?.side === "for" || body?.side === "against" ? body.side : null;
  if (!side) return NextResponse.json({ error: "side must be 'for' or 'against'." }, { status: 400 });

  const topic = await getOrCreateTodayTopic();
  const service = createServiceClient();

  // One open invite per challenger at a time keeps the share surface simple.
  const { data: openInvite } = await service
    .from("challenge_invites")
    .select("code")
    .eq("challenger_id", user.id)
    .eq("status", "open")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  const { data: invite, error } = await service
    .from("challenge_invites")
    .insert({
      code: generateChallengeCode(),
      challenger_id: user.id,
      topic_id: topic.id,
      challenger_side: side,
      expires_at: challengeExpiry().toISOString(),
    })
    .select("id, code, expires_at")
    .single();
  if (error || !invite) {
    console.error("Failed to create challenge invite:", error);
    return NextResponse.json({ error: "Failed to create the challenge." }, { status: 500 });
  }

  // Superseded invite: cancel the older open one so stale links fail cleanly.
  if (openInvite && openInvite.code !== invite.code) {
    await service.from("challenge_invites").update({ status: "cancelled" }).eq("code", openInvite.code);
  }

  void recordProductEvent("challenge_link_created", { side });

  return NextResponse.json({
    invite,
    topic: { id: topic.id, title: topic.title },
    challengerSide: side,
    opponentSide: opponentSideOf(side),
    url: `/challenge/${invite.code}`,
  });
}
