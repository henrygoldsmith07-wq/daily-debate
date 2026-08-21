import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { debateOpening } from "@/lib/gemini";
import type { DebateSide } from "@/lib/types";

export async function POST(request: Request) {
  const limited = await checkRateLimit(request, { name: "solo-start", limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const topicId = typeof body?.topicId === "string" ? body.topicId : null;
  const side: DebateSide | null = body?.side === "for" || body?.side === "against" ? body.side : null;
  if (!topicId || !side) {
    return NextResponse.json({ error: "topicId and side are required." }, { status: 400 });
  }

  const { data: topic, error: topicError } = await supabase
    .from("daily_topics")
    .select("*")
    .eq("id", topicId)
    .single();
  if (topicError || !topic) return NextResponse.json({ error: "Topic not found." }, { status: 404 });

  const { data: debate, error: debateError } = await supabase
    .from("solo_debates")
    .insert({ user_id: user.id, topic_id: topicId, side, round_count: 1 })
    .select("*")
    .single();
  if (debateError || !debate) {
    console.error("Failed to create solo debate:", debateError);
    return NextResponse.json({ error: "Failed to start debate." }, { status: 500 });
  }

  const aiSide: DebateSide = side === "for" ? "against" : "for";
  let aiMessage: string;
  try {
    aiMessage = await debateOpening({ topicTitle: topic.title, topicPrompt: topic.prompt, aiSide });
  } catch (error) {
    console.error("Failed to generate opening:", error);
    return NextResponse.json({ error: "Failed to generate AI opening." }, { status: 502 });
  }

  const { data: turn, error: turnError } = await supabase
    .from("solo_debate_turns")
    .insert({ debate_id: debate.id, round_number: 1, ai_message: aiMessage })
    .select("*")
    .single();
  if (turnError || !turn) {
    console.error("Failed to create opening turn:", turnError);
    return NextResponse.json({ error: "Failed to start debate." }, { status: 500 });
  }

  return NextResponse.json({ debate, turn });
}
