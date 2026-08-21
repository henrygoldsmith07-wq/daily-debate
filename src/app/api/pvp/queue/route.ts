import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { getOrCreateTodayTopic } from "@/lib/dailyTopic";
import type { DebateSide } from "@/lib/types";

// Join the day's PvP matchmaking queue. If another waiting player is found on
// the same topic, a match is created immediately and both players' queue
// entries are cleared (best-effort; a rare race can double-match a player,
// which is acceptable for this MVP matchmaker).
export async function POST(request: Request) {
  const limited = await checkRateLimit(request, { name: "pvp-queue", limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const topic = await getOrCreateTodayTopic();
  const service = createServiceClient();

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

  const { data: opponentRow } = await service
    .from("pvp_queue")
    .select("*")
    .eq("topic_id", topic.id)
    .neq("user_id", user.id)
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!opponentRow) {
    // Upsert with unique user_id prevents rare race double-enqueue
    await service.from("pvp_queue").upsert({ user_id: user.id, topic_id: topic.id, joined_at: new Date().toISOString() }, { onConflict: "user_id" });
    return NextResponse.json({ waiting: true });
  }

  const playerASide: DebateSide = Math.random() < 0.5 ? "for" : "against";
  const { data: match, error: matchError } = await service
    .from("pvp_matches")
    .insert({
      topic_id: topic.id,
      player_a: opponentRow.user_id,
      player_b: user.id,
      player_a_side: playerASide,
      current_turn_player: opponentRow.user_id,
    })
    .select("*")
    .single();

  await service.from("pvp_queue").delete().in("user_id", [opponentRow.user_id, user.id]);

  if (matchError || !match) {
    console.error("Failed to create PvP match:", matchError);
    return NextResponse.json({ error: "Failed to create match." }, { status: 500 });
  }

  return NextResponse.json({ match });
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: match } = await supabase
    .from("pvp_matches")
    .select("*")
    .or(`player_a.eq.${user.id},player_b.eq.${user.id}`)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (match) return NextResponse.json({ match });

  const { data: queueRow } = await supabase.from("pvp_queue").select("*").eq("user_id", user.id).maybeSingle();
  return NextResponse.json({ waiting: Boolean(queueRow) });
}

export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await supabase.from("pvp_queue").delete().eq("user_id", user.id);
  return NextResponse.json({ ok: true });
}
