// REAL-POSTGRES proof of the request-time fallback path (P2.2).
//
// The generator-side write-once proof runs in the CI topic-pipeline job; the
// race semantics of the APP writer are pinned by dailyTopic.test.ts against a
// contract double. What neither covered is the real SQL: getTodayTopic() ->
// insertCanonicalTopicOnce() against an actual migrated Postgres must
// converge on ONE canonical row per UTC date (fingerprint + provenance
// present) and a second call must be a no-op returning the identical row.
//
// Skipped without TEST_DATABASE_URL + DATABASE_URL (CI e2e provisions both;
// DATABASE_URL is the URL src/lib/backend/sql.ts uses for the app client).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { applyTestMigrations } from "../../tests/helpers/applyTestMigrations";
import { topicFingerprint } from "../../scripts/generate-topics.mjs";
import { getTodayTopic } from "./dailyTopic";

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const d = databaseUrl && process.env.DATABASE_URL?.trim() ? describe : describe.skip;

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** node-postgres returns `date` columns as JS Date objects — normalise like
 *  the ops-health read boundary does before any string comparison. */
function asDateString(value: unknown): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
}

let pool: pg.Pool;

async function clearToday(): Promise<void> {
  await pool.query(
    "DELETE FROM topic_evidence WHERE topic_id IN (SELECT id FROM daily_topics WHERE topic_date = $1::date)",
    [todayUtc()],
  );
  await pool.query("DELETE FROM daily_topics WHERE topic_date = $1::date", [todayUtc()]);
}

d("request-time fallback write-once (real Postgres)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL?.trim(), max: 4 });
    await applyTestMigrations(pool);
  });

  afterAll(async () => {
    await clearToday();
    await pool.end();
  });

  beforeEach(clearToday);

  it("persists exactly one canonical row, and a second call returns the identical row", async () => {
    const first = await getTodayTopic();
    expect(asDateString(first.topic_date)).toBe(todayUtc());

    const stored = await pool.query<{
      id: string;
      title: string;
      prompt: string;
      category: string;
      generation_source: string;
      generation_reason: string | null;
      topic_fingerprint: string | null;
    }>(
      `SELECT id, title, prompt, category, generation_source, generation_reason, topic_fingerprint
         FROM daily_topics WHERE topic_date = $1::date`,
      [todayUtc()],
    );
    expect(stored.rowCount).toBe(1);
    const row = stored.rows[0];
    // Full canonical shape: provenance AND reason AND a recomputable fingerprint.
    expect(row.generation_source).toBe("fallback");
    expect(row.generation_reason).toBe("request-time-fallback");
    expect(row.topic_fingerprint).toBe(
      topicFingerprint({ topicDate: todayUtc(), title: row.title, prompt: row.prompt, category: row.category }),
    );

    const second = await getTodayTopic();
    expect(second.id).toBe(first.id);
    expect(second.title).toBe(first.title);
    expect(asDateString(second.topic_date)).toBe(asDateString(first.topic_date));

    const count = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM daily_topics WHERE topic_date = $1::date",
      [todayUtc()],
    );
    expect(count.rows[0].n).toBe(1);
  });

  it("never replaces an existing row — a scheduled/AI topic wins the date", async () => {
    const seeded = await pool.query<{ id: string }>(
      `INSERT INTO daily_topics (topic_date, title, prompt, category, sources, generation_source, generation_reason, topic_fingerprint)
       VALUES ($1::date, 'AI scheduled topic', 'An AI-generated prompt.', 'Technology', '[]'::jsonb, 'ai', 'ai', $2)
       RETURNING id`,
      [
        todayUtc(),
        topicFingerprint({
          topicDate: todayUtc(),
          title: "AI scheduled topic",
          prompt: "An AI-generated prompt.",
          category: "Technology",
        }),
      ],
    );

    const got = await getTodayTopic();
    expect(got.id).toBe(seeded.rows[0].id);
    expect(got.generation_source).toBe("ai");
    const count = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM daily_topics WHERE topic_date = $1::date",
      [todayUtc()],
    );
    expect(count.rows[0].n).toBe(1);
  });
});
