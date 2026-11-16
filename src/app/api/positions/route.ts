import { NextResponse } from "next/server";
import { createClient } from "@/lib/backend/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { getOrCreateTodayTopic } from "@/lib/dailyTopic";
import { countPositions, readPosition, writePosition } from "@/lib/motionPositions";
import { isMotionPosition, positionTallyView } from "@/lib/positionTally";

// Where the signed-in learner stands on today's motion, and the split across
// everyone once enough people have answered (positionTally.ts). Stating a
// position comes before PvP matchmaking, which only pairs opposite positions.

async function currentUserId(): Promise<string | null> {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  return user?.id ?? null;
}

export async function GET(request: Request) {
  const limited = await checkRateLimit(request, { name: "positions-read", limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const topic = await getOrCreateTodayTopic();
    const [position, counts] = await Promise.all([readPosition(userId, topic.id), countPositions(topic.id)]);
    // The split is shown only once the learner has given their own view, so
    // the crowd cannot pull a position before it is stated.
    return NextResponse.json({ topicId: topic.id, position, tally: position ? positionTallyView(counts) : null });
  } catch (error) {
    console.error("positions read failed:", error);
    return NextResponse.json({ error: "Could not load positions. Try again." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const limited = await checkRateLimit(request, { name: "positions-write", limit: 20, windowMs: 60_000 });
  if (limited) return limited;
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { position?: unknown } | null;
  if (!isMotionPosition(body?.position)) {
    return NextResponse.json({ error: "Position must be for or against." }, { status: 400 });
  }

  try {
    const topic = await getOrCreateTodayTopic();
    await writePosition(userId, topic.id, body.position);
    const counts = await countPositions(topic.id);
    return NextResponse.json({ topicId: topic.id, position: body.position, tally: positionTallyView(counts) });
  } catch (error) {
    console.error("positions write failed:", error);
    return NextResponse.json({ error: "Could not save your position. Try again." }, { status: 503 });
  }
}
