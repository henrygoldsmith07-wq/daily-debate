import { NextResponse } from "next/server";
import { createClient } from "@/lib/backend/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { isDebateId, isExploreBlocked, setPvpPublished, setSoloPublished } from "@/lib/explore";

// Publish or withdraw a finished debate (migration 042). Solo: the learner's
// own choice. PvP: each player's yes is recorded separately and the match is
// public only while both are yes, so either player can take it down.
export async function POST(request: Request) {
  const limited = await checkRateLimit(request, { name: "explore-publish", limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { kind?: unknown; id?: unknown; publish?: unknown } | null;
  const id = isDebateId(body?.id) ? body.id : null;
  const publish = typeof body?.publish === "boolean" ? body.publish : null;
  if (!id || publish === null || (body?.kind !== "solo" && body?.kind !== "pvp")) {
    return NextResponse.json({ error: "Say which finished debate to publish or withdraw." }, { status: 400 });
  }

  const takenDown = NextResponse.json(
    { error: "This debate was taken off Explore after reports, so it can't be published again." },
    { status: 409 },
  );

  try {
    if (body.kind === "solo") {
      const ok = await setSoloPublished(user.id, id, publish);
      if (!ok) {
        if (publish && (await isExploreBlocked("solo", id))) return takenDown;
        return NextResponse.json({ error: "Only your own finished debate can be published." }, { status: 404 });
      }
      return NextResponse.json({ published: publish });
    }
    const result = await setPvpPublished(user.id, id, publish);
    if (!result) {
      if (publish && (await isExploreBlocked("pvp", id))) return takenDown;
      return NextResponse.json({ error: "Only a finished match you played can be published." }, { status: 404 });
    }
    return NextResponse.json({ mine: result.mine, theirs: result.theirs, published: result.mine && result.theirs === true });
  } catch (error) {
    console.error("explore publish failed:", error);
    return NextResponse.json({ error: "Could not update publishing. Try again." }, { status: 503 });
  }
}
