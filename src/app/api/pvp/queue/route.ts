import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/backend/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { getOrCreateTodayTopic } from "@/lib/dailyTopic";
import { PVP_ROUNDS } from "@/lib/types";

// Join the day's PvP matchmaking queue. Match creation happens in a single
// atomic SQL statement (claim_pvp_opponent_and_create_match): the oldest
// queued, unmatched opponent is locked with FOR UPDATE SKIP LOCKED, the match
// is inserted, and both queue rows are cleared. Partial unique indexes on
// pvp_matches guarantee at most one active match per player, so the
// double-match race the previous two-step implementation accepted can no
// longer occur.
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

  // Best-effort housekeeping: queue rows older than a day are stale (their
  // owners left without cancelling) and would accumulate forever.
  const staleCutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  await service.from("pvp_queue").delete().lt("joined_at", staleCutoff);

  // Duplicate join: if already queued or already in active match, return waiting/active without double-join
  const { data: existingQueue } = await service.from("pvp_queue").select("*").eq("user_id", user.id).maybeSingle();
  if (existingQueue) return NextResponse.json({ waiting: true, duplicate: true });
  const { data: activeMatch } = await service
    .from("pvp_matches")
    .select("*")
    .or(`player_a.eq.${user.id},player_b.eq.${user.id}`)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (activeMatch) return NextResponse.json({ match: activeMatch, alreadyMatched: true });

  // Atomic claim: locks the oldest queued, unmatched opponent (SKIP LOCKED),
  // inserts the match, and clears both queue rows in one statement. Empty
  // result means nobody was waiting (or the joiner was matched concurrently).
  const claim = await service.rpc("claim_pvp_opponent_and_create_match", {
    p_joiner: user.id,
    p_topic_id: topic.id,
    p_round_limit: PVP_ROUNDS,
  });
  if (claim.error) {
    console.error("Failed to claim PvP opponent:", claim.error);
    return NextResponse.json({ error: "Failed to create match." }, { status: 500 });
  }

  const rows = (claim.data ?? []) as Record<string, unknown>[];
  if (rows.length > 0) return NextResponse.json({ match: rows[0] });

  // Concurrency guard: the claim can come back empty because the joiner was
  // matched in a parallel request after the activeMatch check above.
  const { data: racedMatch } = await service
    .from("pvp_matches")
    .select("*")
    .or(`player_a.eq.${user.id},player_b.eq.${user.id}`)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (racedMatch) return NextResponse.json({ match: racedMatch, alreadyMatched: true });

  // Nobody waiting: enqueue (only succeeds while still unmatched). `queued`
  // is a real boolean; false only in the concurrent-match race, in which case
  // the re-check below finds the match the parallel request created.
  const queued = await service.rpc("enqueue_pvp_if_unmatched", {
    p_user: user.id,
    p_topic_id: topic.id,
  });
  if (queued.error) {
    console.error("Failed to enqueue for PvP:", queued.error);
    return NextResponse.json({ error: "Failed to join queue." }, { status: 500 });
  }
  return NextResponse.json({ waiting: queued.data });
}

export async function GET() {
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

export async function DELETE() {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await db.from("pvp_queue").delete().eq("user_id", user.id);
  return NextResponse.json({ ok: true });
}
