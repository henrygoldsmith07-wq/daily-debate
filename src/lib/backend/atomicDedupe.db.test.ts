import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { applyTestMigrations } from "../../../tests/helpers/applyTestMigrations";

/**
 * REAL-POSTGRES guards for migration 053. The two routes involved used a
 * check-then-insert pair that two concurrent requests could both pass. The
 * unique indexes are the integrity boundary; these tests prove that a
 * conflicting write returns no row instead of duplicating durable state.
 * Skipped without TEST_DATABASE_URL + DATABASE_URL (CI e2e provisions both).
 */

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const d = databaseUrl && process.env.DATABASE_URL?.trim() ? describe : describe.skip;

let pool: pg.Pool;
const email = `atomic-dedupe-${randomUUID()}@test.local`;
const topicDate = "2099-01-01";
let userId: string;
let debateId: string;

const repairInsert = `
  INSERT INTO repair_results (user_id, debate_id, target_kind, source_text, rewrite_text, score, succeeded, signals)
  VALUES ($1, $2, 'rebuttal', 'The reliability risk is real.', $3, 70, true, '[]'::jsonb)
  ON CONFLICT (user_id, debate_id, target_kind, rewrite_fingerprint) DO NOTHING
  RETURNING id`;
const corpusInsert = `
  INSERT INTO corpus_items (transcript, source_type, source_id, contributor_id, length_bucket, ability_band)
  VALUES ('A -> B -> A -> B', 'solo', $1, $2, 'medium', 'intermediate')
  ON CONFLICT (source_type, source_id) DO NOTHING
  RETURNING id`;

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL?.trim(), max: 4 });
  await applyTestMigrations(pool);
  const user = await pool.query<{ id: string }>(
    `WITH new_user AS (
       INSERT INTO app_users (email, password_hash) VALUES ($1, 'test') RETURNING id
     )
     INSERT INTO profiles (id, username) SELECT id, 'atomic-dedupe' FROM new_user RETURNING id`,
    [email],
  );
  userId = user.rows[0].id;
  await pool.query(
    `INSERT INTO daily_topics (topic_date, title, prompt)
     VALUES ($1, 'Atomic dedupe topic', 'Used by atomicDedupe.db.test')
     ON CONFLICT (topic_date) DO NOTHING`,
    [topicDate],
  );
  const topic = await pool.query<{ id: string }>("SELECT id FROM daily_topics WHERE topic_date = $1", [topicDate]);
  const debate = await pool.query<{ id: string }>(
    "INSERT INTO solo_debates (user_id, topic_id, side) VALUES ($1, $2, 'for') RETURNING id",
    [userId, topic.rows[0].id],
  );
  debateId = debate.rows[0].id;
});

afterAll(async () => {
  await pool.query("DELETE FROM corpus_items WHERE source_type = 'solo' AND source_id = $1", [debateId]);
  await pool.query("DELETE FROM app_users WHERE email = $1", [email]); // cascades to profile, debate, repairs
  await pool.query("DELETE FROM daily_topics WHERE topic_date = $1", [topicDate]);
  await pool.end();
});

d("atomic write dedupe (migration 053)", () => {
  it("concurrent identical rewrites produce one repair_result", async () => {
    const rewrite = "However, that reliability risk is answered by the measured trend.";
    const [first, second] = await Promise.all([
      pool.query(repairInsert, [userId, debateId, rewrite]),
      pool.query(repairInsert, [userId, debateId, rewrite]),
    ]);
    expect([first, second].filter((r) => r.rows.length > 0)).toHaveLength(1);
    const { rows } = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM repair_results WHERE user_id = $1 AND debate_id = $2",
      [userId, debateId],
    );
    expect(rows[0].n).toBe(1);
  });

  it("concurrent imports of one debate produce one corpus item", async () => {
    const [first, second] = await Promise.all([
      pool.query(corpusInsert, [debateId, userId]),
      pool.query(corpusInsert, [debateId, userId]),
    ]);
    expect([first, second].filter((r) => r.rows.length > 0)).toHaveLength(1);
    const { rows } = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM corpus_items WHERE source_type = 'solo' AND source_id = $1",
      [debateId],
    );
    expect(rows[0].n).toBe(1);
  });
});
