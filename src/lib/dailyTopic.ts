// Daily topic resolution — zero AI calls at request time.
//
// Architecture:
//   02:00 UTC  scripts/generate-topics.mjs runs as a scheduled job:
//              generates 3-5 candidates → scores them on 9 dimensions →
//              picks the strongest → stores for TOMORROW's date.
//   00:00 UTC  tomorrow's stored topic becomes today's automatically.
//
// This module only READS the pre-stored topic. If none exists (pipeline down,
// fresh deployment, missed run) it falls back to a curated local motion —
// never an AI call. The dashboard can therefore never fail due to provider
// unavailability.

import { createServiceClient } from "./backend/server";
import { pickFallbackExcluding } from "./topicFallbacks";
import type { DailyTopic } from "./types";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Returns today's topic from the pre-generated store. Never triggers an AI
 * call; falls back to a curated motion when nothing is stored.
 */
export async function getTodayTopic(): Promise<DailyTopic> {
  const db = createServiceClient();
  const date = todayIso();

  const { data: existing } = await db
    .from("daily_topics")
    .select("*")
    .eq("topic_date", date)
    .maybeSingle();

  if (existing) return existing as unknown as DailyTopic;

  // No pre-stored topic — serve a curated fallback and persist it so all
  // users see the same one today (not just the first visitor).
  const { data: recent } = await db
    .from("daily_topics")
    .select("title")
    .order("topic_date", { ascending: false })
    .limit(14);
  const recentTitles = (recent ?? []).map((r) => r.title as string);

  const fb = pickFallbackExcluding(date, recentTitles);

  const { data: inserted } = await db
    .from("daily_topics")
    .insert({
      topic_date: date,
      title: fb.title,
      prompt: fb.prompt,
      category: fb.category,
      sources: [], // curated fallbacks have known-good institutions baked into their prompts
    })
    .select("*")
    .single();

  if (inserted) return inserted as unknown as DailyTopic;

  // Concurrent insert race: another instance already wrote it — read theirs.
  const { data: concurrent } = await db
    .from("daily_topics")
    .select("*")
    .eq("topic_date", date)
    .single();
  if (concurrent) return concurrent as unknown as DailyTopic;

  // Absolute last resort (DB completely unreachable): return in-memory without persisting.
  return {
    id: "fallback-in-memory",
    topic_date: date,
    title: fb.title,
    prompt: fb.prompt,
    category: fb.category,
    sources: [],
    created_at: new Date().toISOString(),
  };
}

/**
 * Store a pre-generated topic for a future date. Called by the scheduled
 * generation script, never by request handlers.
 */
export async function storePreGeneratedTopic(
  targetDate: string,
  topic: { title: string; prompt: string; category: string; sources: Array<{ name: string; homepage: string; angle: string }> },
): Promise<{ ok: boolean; error?: string }> {
  const db = createServiceClient();

  // Upsert: overwrite any previous candidate for this date.
  const { error } = await db
    .from("daily_topics")
    .upsert(
      {
        topic_date: targetDate,
        title: topic.title,
        prompt: topic.prompt,
        category: topic.category,
        sources: topic.sources,
      },
      { onConflict: "topic_date" }
    );

  if (error) return { ok: false, error: error.message };

  // Retrieve evidence cards for the stored topic (best-effort).
  try {
    const { data: stored } = await db
      .from("daily_topics")
      .select("id, title, prompt")
      .eq("topic_date", targetDate)
      .single();

    if (stored) {
      const { buildTopicEvidenceCards } = await import("./topicEvidence");
      const { cards } = await buildTopicEvidenceCards(
        { title: stored.title, prompt: stored.prompt },
        { maxCards: 3 }
      );
      if (cards.length) {
        await db.from("topic_evidence").insert(
          cards.map((c) => ({
            topic_id: stored.id,
            claim: c.claim,
            source_name: c.sourceName,
            source_type: c.sourceType,
            url: c.url,
            title: c.title ?? null,
            passage: c.passage,
            published_date: c.publishedDate,
            checks: c.checks,
          }))
        );
      }
    }
  } catch (evidenceError) {
    console.error("Evidence retrieval failed during pre-generation:", evidenceError);
  }

  return { ok: true };
}

// Legacy alias kept so existing imports don't break during migration.
export const getOrCreateTodayTopic = getTodayTopic;
