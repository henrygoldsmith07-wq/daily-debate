import "server-only";

import { isDatabaseConfigured } from "./backend/env";
import { queryRows } from "./backend/sql";
import { parseMotionPrep, type MotionPrep } from "./motionPrep";
import { generateMotionPrep } from "./openrouter";

/**
 * Prep for a stored motion: the cached row, or one generated now and stored
 * write-once (052). Returns null when the motion is unknown. Throws when it
 * has to generate and cannot (provider down, spend cap); the route turns that
 * into a quiet "prep is not available" rather than a failed page.
 */
export async function getMotionPrep(topicId: string): Promise<MotionPrep | null> {
  if (!isDatabaseConfigured()) return null;
  const [topic] = await queryRows<{ title: string; prompt: string; content: unknown }>(
    `SELECT t.title, t.prompt, p.content
       FROM daily_topics t LEFT JOIN motion_prep p ON p.topic_id = t.id
      WHERE t.id = $1`,
    [topicId],
  );
  if (!topic) return null;
  const cached = parseMotionPrep(topic.content);
  if (cached) return cached;

  const generated = await generateMotionPrep({ topicTitle: topic.title, topicPrompt: topic.prompt });
  // Write-once: if another request stored prep first, everyone sees that one.
  const [stored] = await queryRows<{ content: unknown }>(
    `WITH ins AS (
       INSERT INTO motion_prep (topic_id, content) VALUES ($1, $2::jsonb)
       ON CONFLICT (topic_id) DO NOTHING RETURNING content
     )
     SELECT content FROM ins UNION ALL SELECT content FROM motion_prep WHERE topic_id = $1 LIMIT 1`,
    [topicId, JSON.stringify(generated)],
  );
  return parseMotionPrep(stored?.content) ?? generated;
}
