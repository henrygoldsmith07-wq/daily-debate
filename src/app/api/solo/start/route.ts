import { NextResponse } from "next/server";
import { createClient } from "@/lib/backend/server";
import { checkRateLimit, checkRateLimitKey } from "@/lib/rateLimit";
import { resolveDebateFormat } from "@/lib/sprint";
import { resolveDifficulty, resolvePersona } from "@/lib/opponentPersona";
import { isSoloStartSideChoice, startSoloDebate } from "@/lib/solo/startDebate";

export async function POST(request: Request) {
  // Secondary network-abuse ceiling. Authenticated users get their own tighter
  // bucket below so people sharing school/home/work NATs do not throttle each other.
  const ipLimited = await checkRateLimit(request, {
    name: "solo-start-ip",
    limit: 120,
    windowMs: 60_000,
  });
  if (ipLimited) return ipLimited;

  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userLimit = await checkRateLimitKey(user.id, {
    name: "solo-start-user",
    limit: 10,
    windowMs: 60_000,
  });
  if (!userLimit.ok) {
    return NextResponse.json(
      { error: "Too many debate starts. Please wait a moment and try again." },
      {
        status: 429,
        headers: {
          "Retry-After": String(userLimit.retryAfterSeconds),
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const body = await request.json().catch(() => null);
  const topicId = typeof body?.topicId === "string" ? body.topicId : null;
  const sideChoice = body?.side;
  const format = resolveDebateFormat(body?.format);
  // Adversary controls: persona changes how the AI attacks, difficulty how
  // hard. Unknown values fall back to the legacy balanced/challenging pairing.
  const persona = resolvePersona(body?.persona);
  const difficulty = resolveDifficulty(body?.difficulty);

  if (!topicId) {
    return NextResponse.json({ error: "topicId is required." }, { status: 400 });
  }
  if (!isSoloStartSideChoice(sideChoice)) {
    return NextResponse.json(
      { error: "side must be 'for', 'against', or 'challenge'." },
      { status: 400 },
    );
  }

  const result = await startSoloDebate({
    db,
    userId: user.id,
    topicId,
    sideChoice,
    format,
    persona,
    difficulty,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.code ? { code: result.code } : {}) },
      { status: result.status },
    );
  }

  return NextResponse.json({ ...result.data, persona, difficulty });
}
