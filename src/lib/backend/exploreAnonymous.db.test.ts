import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { applyTestMigrations } from "../../../tests/helpers/applyTestMigrations";
import { getExploreDebate, listExplore, setSoloPublished } from "../explore";

/**
 * Anonymous publishing (migration 050), against real Postgres through the
 * app's own explore.ts. Skipped without TEST_DATABASE_URL + DATABASE_URL
 * (the app's SQL client reads DATABASE_URL; CI points both at one database).
 */

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const d = databaseUrl && process.env.DATABASE_URL?.trim() ? describe : describe.skip;

let pool: pg.Pool;
let owner: string;
let viewer: string;
let topicId: string;
const EMAILS = ["xa-owner@test.local", "xa-viewer@test.local"];
const TOPIC_DATE = "1999-12-27";

async function ensureUser(email: string, username: string): Promise<string> {
  const existing = await pool.query<{ id: string }>("SELECT id FROM app_users WHERE email = $1", [email]);
  if (existing.rows.length) return existing.rows[0].id;
  const inserted = await pool.query<{ id: string }>(
    `WITH new_user AS (INSERT INTO app_users (email, password_hash) VALUES ($1, 'test') RETURNING id)
     INSERT INTO profiles (id, username) SELECT id, $2 FROM new_user RETURNING id`,
    [email, username],
  );
  return inserted.rows[0].id;
}

async function finishedDebate(): Promise<string> {
  const row = await pool.query<{ id: string }>(
    `INSERT INTO solo_debates (user_id, topic_id, side, status, completed_at) VALUES ($1, $2, 'for', 'completed', now()) RETURNING id`,
    [owner, topicId],
  );
  await pool.query(
    `INSERT INTO solo_debate_turns (debate_id, round_number, ai_message, user_message) VALUES ($1, 1, 'Opening.', 'My answer.')`,
    [row.rows[0].id],
  );
  return row.rows[0].id;
}

d("Explore anonymous publishing (migration 050)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
    await applyTestMigrations(pool);
    owner = await ensureUser(EMAILS[0], "anon-owner-name");
    viewer = await ensureUser(EMAILS[1], "anon-viewer");
    await pool.query(
      `INSERT INTO daily_topics (topic_date, title, prompt) VALUES ($1, 'Anonymous explore topic', 'exploreAnonymous.db.test')
       ON CONFLICT (topic_date) DO NOTHING`,
      [TOPIC_DATE],
    );
    topicId = (await pool.query<{ id: string }>("SELECT id FROM daily_topics WHERE topic_date = $1", [TOPIC_DATE])).rows[0].id;
    await pool.query("DELETE FROM solo_debates WHERE user_id = $1", [owner]);
  });

  afterAll(async () => {
    await pool.query("DELETE FROM app_users WHERE email = ANY($1::text[])", [EMAILS]);
    await pool.end();
  });

  it("shows an anonymous debate as 'A debater' everywhere, and the username otherwise", async () => {
    const anonymous = await finishedDebate();
    const named = await finishedDebate();
    expect(await setSoloPublished(owner, anonymous, true, true)).toBe(true);
    expect(await setSoloPublished(owner, named, true)).toBe(true);

    const page = await getExploreDebate(viewer, "solo", anonymous);
    expect(page?.for.name).toBe("A debater");
    expect(page?.turns.find((t) => t.speaker !== "AI opponent")?.speaker).toBe("A debater");
    expect(JSON.stringify(page)).not.toContain("anon-owner-name");

    expect((await getExploreDebate(viewer, "solo", named))?.for.name).toBe("anon-owner-name");
    const feed = await listExplore(viewer, 50);
    expect(feed.find((item) => item.id === anonymous)?.for.name).toBe("A debater");
    // The owner is still the owner: they cannot vote on it, and it shows as theirs.
    expect((await getExploreDebate(owner, "solo", anonymous))?.isParticipant).toBe(true);
  });

  it("keeps the choice when withdrawn, and resets it on a named republish", async () => {
    const debate = await finishedDebate();
    await setSoloPublished(owner, debate, true, true);
    await setSoloPublished(owner, debate, false);
    const stored = await pool.query("SELECT published_anonymously FROM solo_debates WHERE id = $1", [debate]);
    expect(stored.rows[0].published_anonymously).toBe(true);
    await setSoloPublished(owner, debate, true);
    expect((await getExploreDebate(viewer, "solo", debate))?.for.name).toBe("anon-owner-name");
  });
});
