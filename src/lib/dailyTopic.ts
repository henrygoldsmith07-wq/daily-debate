import { createServiceClient } from "./supabase/server";
import { generateDailyTopic } from "./gemini";
import type { DailyTopic } from "./types";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Returns today's topic, generating and persisting one via Gemini the first
// time it's requested each day. Uses the service client so any signed-in
// user can trigger generation without needing elevated RLS permissions.
export async function getOrCreateTodayTopic(): Promise<DailyTopic> {
  const supabase = createServiceClient();
  const date = todayIso();

  const { data: existing } = await supabase
    .from("daily_topics")
    .select("*")
    .eq("topic_date", date)
    .maybeSingle();

  if (existing) return existing as unknown as DailyTopic;

  const { data: recent } = await supabase
    .from("daily_topics")
    .select("title")
    .order("topic_date", { ascending: false })
    .limit(14);

  const generated = await generateDailyTopic((recent ?? []).map((row) => row.title as string));

  const { data: inserted, error } = await supabase
    .from("daily_topics")
    .insert({
      topic_date: date,
      title: generated.title,
      prompt: generated.prompt,
      category: generated.category,
      sources: generated.sources,
    })
    .select("*")
    .single();

  // Another request may have generated the topic concurrently — fall back to
  // reading it instead of erroring out.
  if (error) {
    const { data: fallback } = await supabase
      .from("daily_topics")
      .select("*")
      .eq("topic_date", date)
      .single();
    if (fallback) return fallback as unknown as DailyTopic;
    throw error;
  }

  return inserted as unknown as DailyTopic;
}
