import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/backend/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { getOrCreateTodayTopic } from "@/lib/dailyTopic";
import { PVP_ROUNDS } from "@/lib/types";
import { readPosition } from "@/lib/motionPositions";

// Join today's PvP queue through one convergent database transaction.
// join_pvp_queue_by_position (041) serializes matchmaking per topic, pairs only
// opposite positions, and the database trigger enforces one active match per
// player across BOTH player columns. A learner argues the side they actually
// hold, so they must state a position on today's motion before queueing.
export async function POST(request: Request) {
  const limited = await checkRateLimit(request, { name: "pvp-queue", limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const topic = await getOrCreateTodayTopic();
  const service = createServiceClient();

  let side: Awaited<ReturnType<typeof readPosition>>;
  try {
    side = await readPosition(user.id, topic.id);
  } catch (error) {
    console.error("PvP queue position read failed:", error);
    return NextResponse.json({ error: "Could not load your position. Try again." }, { status: 503 });
  }
  if (!side) {
    return NextResponse.json(
      { error: "Say where you stand on today's motion first.", needsPosition: true },
      { status: 409 },
    );
  }

  // Best-effort housekeeping: queue rows older than a day are stale (their
  // owners left without cancelling) and would accumulate forever.
  //
  // Scoped to the CALLER'S OWN rows. This used to be a service-role DELETE
  // of every queue row older than 24h, triggered by any authenticated user:
  // a write outside the caller's scope, repeated on every queue join, and a
  // write-amplification lever against a shared table. Each user now clears
  // their own stale entries, which is enough for them to leave the queue.
  const staleCutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  await service.from("pvp_queue").delete().eq("user_id", user.id).lt("joined_at", staleCutoff);

  // One database transaction now owns the entire join lifecycle:
  // active-match recovery, enqueue, opponent claim and match creation. This
  // avoids the old claim→enqueue gap where two near-simultaneous joiners could
  // both end up waiting forever.
  const joined = await service.rpc("join_pvp_queue_by_position", {
    p_joiner: user.id,
    p_topic_id: topic.id,
    p_side: side,
    p_round_limit: PVP_ROUNDS,
  });
  if (joined.error) {
    console.error("Failed to join PvP queue:", joined.error);
    return NextResponse.json({ error: "Failed to join queue." }, { status: 500 });
  }

  const rows = (joined.data ?? []) as Record<string, unknown>[];
  if (rows.length > 0) {
    return NextResponse.json({ match: rows[0] });
  }
  return NextResponse.json({ waiting: true });

}

export async function GET(request: Request) {
  const limited = await checkRateLimit(request, { name: "pvp-queue-read", limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: match } = await db
    .from("pvp_matches")
    .select("*")
    .or(`player_a.eq.${user.id},player_b.eq.${user.id}`)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (match) return NextResponse.json({ match });

  const { data: queueRow } = await db.from("pvp_queue").select("*").eq("user_id", user.id).maybeSingle();
  return NextResponse.json({ waiting: Boolean(queueRow) });
}

export async function DELETE(request: Request) {
  const limited = await checkRateLimit(request, { name: "pvp-queue-leave", limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await db.from("pvp_queue").delete().eq("user_id", user.id);
  return NextResponse.json({ ok: true });
}
