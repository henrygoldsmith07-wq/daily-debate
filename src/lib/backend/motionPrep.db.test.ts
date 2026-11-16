import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { applyTestMigrations } from "../../../tests/helpers/applyTestMigrations";

/**
 * Prep cards (migration 052), against real Postgres: generated once per
 * motion and stored write-once, so every later request reads the cache and
 * no learner triggers a second AI call. The provider is the e2e mock.
 */

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const d = databaseUrl && process.env.DATABASE_URL?.trim() ? describe : describe.skip;

let pool: pg.Pool;
let topicId: string;
const TOPIC_DATE = "1999-12-26";

d("Motion prep cache (migration 052)", () => {
  beforeAll(async () => {
    vi.stubEnv("E2E_MOCK_AI", "1");
    pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
    await applyTestMigrations(pool);
    await pool.query(
      `INSERT INTO daily_topics (topic_date, title, prompt) VALUES ($1, 'Prep topic', 'motionPrep.db.test')
       ON CONFLICT (topic_date) DO NOTHING`,
      [TOPIC_DATE],
    );
    topicId = (await pool.query<{ id: string }>("SELECT id FROM daily_topics WHERE topic_date = $1", [TOPIC_DATE])).rows[0].id;
    await pool.query("DELETE FROM motion_prep WHERE topic_id = $1", [topicId]);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await pool.query("DELETE FROM motion_prep WHERE topic_id = $1", [topicId]);
    await pool.end();
  });

  it("generates once, stores it, and serves the stored prep afterwards", async () => {
    const { getMotionPrep } = await import("../motionPrepServer");

    const first = await getMotionPrep(topicId);
    expect(first?.for.strongest).toMatch(/strongest|benefit/i);
    const stored = await pool.query("SELECT content FROM motion_prep WHERE topic_id = $1", [topicId]);
    expect(stored.rowCount).toBe(1);

    // Once stored, the stored prep is served: change it in place and the next
    // request returns the change, so nothing was generated again.
    const replacement = { ...first, for: { ...first!.for, strongest: "Stored prep is what everyone sees." } };
    await pool.query("UPDATE motion_prep SET content = $2::jsonb WHERE topic_id = $1", [topicId, JSON.stringify(replacement)]);
    const second = await getMotionPrep(topicId);
    expect(second?.for.strongest).toBe("Stored prep is what everyone sees.");
  });

  it("returns null for a motion that does not exist", async () => {
    const { getMotionPrep } = await import("../motionPrepServer");
    expect(await getMotionPrep("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
