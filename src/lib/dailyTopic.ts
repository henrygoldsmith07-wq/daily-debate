// Daily topic resolution — zero AI calls at request time.
//
// Architecture:
//   20:00-02:15 UTC  scripts/generate-topics.mjs runs on the retry ladder:
//                    generates 3-5 candidates → scores them on 9 dimensions →
//                    picks the strongest → stores for TOMORROW's date.
//   00:00 UTC  tomorrow's stored topic becomes today's automatically.
//
// This module only READS the pre-stored topic. If none exists (pipeline down,
// fresh deployment, missed run) it falls back to a curated local motion —
// never an AI call. The dashboard can therefore never fail due to provider
// unavailability.
//
// CANONICAL PERSISTENCE: every durable daily_topics write in the app goes
// through insertCanonicalTopicOnce() — one write-once helper, one canonical
// row shape (topic_date, title, prompt, category, sources, generation_source,
// generation_reason, topic_fingerprint). There is no overwrite path: the
// scheduled pipeline, scheduled fallbacks, and request-time persisted
// fallbacks all converge on the same immutable shape via ON CONFLICT DO
// NOTHING. Only the pipeline's deliberate corruption-repair may replace
// content, and it runs transactionally over there — never here.

import { createServiceClient } from "./backend/server";
import { pickFallbackExcluding } from "./topicFallbacks";
import { topicFingerprint } from "../../scripts/generate-topics.mjs";
import type { DailyTopic } from "./types";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * THE canonical durable topic write for application code. Write-once:
 * `insertIgnore(..., { onConflict: "topic_date" })` generates
 * `INSERT ... ON CONFLICT (topic_date) DO NOTHING RETURNING *`, so a
 * request-time fallback can never replace a scheduled topic. The conflict is
 * not an error: zero rows returned means another writer won the date, and we
 * re-read ITS row — losing the insert race must return the stored winner,
 * never an in-memory divergence. The row carries the full canonical shape,
 * including the content fingerprint: an unfingerprinted row would re-create
 * the legacy state that made stale evidence undetectable.
 *
 * Returns the stored row (either freshly inserted or the pre-existing
 * winner), or null when the write path is unavailable.
 */
async function insertCanonicalTopicOnce(
  db: ReturnType<typeof createServiceClient>,
  targetDate: string,
  topic: { title: string; prompt: string; category: string; sources: unknown[] },
  generationSource: "ai" | "fallback",
  generationReason: "ai" | "fallback-provider-failure" | "fallback-policy" | "request-time-fallback",
): Promise<DailyTopic | null> {
  const fingerprint = topicFingerprint({
    topicDate: targetDate,
    title: topic.title,
    prompt: topic.prompt,
    category: topic.category,
  });
  const { data, error } = await db
    .from("daily_topics")
    .insertIgnore(
      {
        topic_date: targetDate,
        title: topic.title,
        prompt: topic.prompt,
        category: topic.category,
        sources: topic.sources,
        generation_source: generationSource,
        generation_reason: generationReason,
        topic_fingerprint: fingerprint,
      },
      { onConflict: "topic_date" },
    )
    .select("*")
    .maybeSingle();
  if (error) {
    console.error("Canonical topic insert failed:", error.message);
    return null;
  }
  if (data) return data as unknown as DailyTopic;
  // DO NOTHING skipped the write (another writer won the date — a normal
  // outcome, not a failure): read THEIR row so every caller converges on the
  // one stored topic.
  const { data: winner } = await db
    .from("daily_topics")
    .select("*")
    .eq("topic_date", targetDate)
    .maybeSingle();
  return (winner as unknown as DailyTopic) ?? null;
}

/**
 * Absolute last resort (store unreadable or unresponsive): serve the curated
 * fallback in-memory without persisting. NOT stored, so the topic pipeline's
 * freshness/ladder logic never mistakes it for a generated row; it carries
 * no fingerprint and contributes to no proof (availability protection only).
 */
function inMemoryFallback(date: string, recentTitles: string[] = []): DailyTopic {
  const fb = pickFallbackExcluding(date, recentTitles);
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
 * Returns today's topic from the pre-generated store. Never triggers an AI
 * call; falls back to a curated motion when nothing is stored. This function
 * must NEVER throw: the dashboard contract is that a degraded store degrades
 * the topic source, not the product.
 */
export async function getTodayTopic(): Promise<DailyTopic> {
  const date = todayIso();

  try {
    const db = createServiceClient();

    const { data: existing } = await db
      .from("daily_topics")
      .select("*")
      .eq("topic_date", date)
      .maybeSingle();

    if (existing) return existing as unknown as DailyTopic;

    // No pre-stored topic — serve a curated fallback and persist it so all
    // users see the same one today (not just the first visitor). Persistence
    // goes through the canonical write-once helper: same row shape as the
    // scheduled pipeline, WITH fingerprint and reason.
    const { data: recent } = await db
      .from("daily_topics")
      .select("title")
      .order("topic_date", { ascending: false })
      .limit(14);
    const recentTitles = (recent ?? []).map((r) => r.title as string);

    const fb = pickFallbackExcluding(date, recentTitles);
    const persisted = await insertCanonicalTopicOnce(
      db,
      date,
      { title: fb.title, prompt: fb.prompt, category: fb.category, sources: [] },
      "fallback",
      "request-time-fallback",
    );

    if (persisted) return persisted;

    // Insert unavailable (constraint/rate/write failure): serve in-memory,
    // keeping the exclusion list so the served fallback stays fresh.
    return inMemoryFallback(date, recentTitles);
  } catch (error) {
    console.error("Daily topic store unavailable — serving curated fallback in-memory:", error);
    return inMemoryFallback(date);
  }
}

// Legacy alias kept so existing imports don't break during migration.
export const getOrCreateTodayTopic = getTodayTopic;
