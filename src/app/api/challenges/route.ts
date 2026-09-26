import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/backend/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { getOrCreateTodayTopic } from "@/lib/dailyTopic";
import { CHALLENGE_EXPIRY_DAYS, opponentSideOf } from "@/lib/friendChallenge";
import { recordProductEventForUser } from "@/lib/productEvents";
import type { DebateSide } from "@/lib/types";

interface CreatedChallengeRow {
  result: "created" | "reused";
  id: string;
  code: string;
  expires_at: string;
}

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

  const created = await service.rpc("create_friend_challenge_v2", {
    p_challenger: user.id,
    p_topic_id: topic.id,
    p_challenger_side: side,
    p_expiry_days: CHALLENGE_EXPIRY_DAYS,
  });
  const invite = Array.isArray(created.data)
    ? (created.data[0] as unknown as CreatedChallengeRow | undefined) ?? null
    : null;
  if (created.error || !invite) {
    console.error("Failed to create challenge invite:", created.error);
    return NextResponse.json({ error: "Failed to create the challenge." }, { status: 500 });
  }

  if (invite.result === "created") {
    await recordProductEventForUser(user.id, "challenge_link_created", { side });
  }

  return NextResponse.json({
    invite: { id: invite.id, code: invite.code, expires_at: invite.expires_at },
    topic: { id: topic.id, title: topic.title },
    challengerSide: side,
    opponentSide: opponentSideOf(side),
    url: `/challenge/${invite.code}`,
    reused: invite.result === "reused",
  });
}
