import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import pg from "pg";
import { applyTestMigrations } from "../../../tests/helpers/applyTestMigrations";

/**
 * Explore publication and votes (migration 042), against real Postgres:
 * only published, finished debates take votes; a PvP match needs BOTH
 * players' yes; participants cannot vote on their own debate; one vote per
 * viewer per debate. Own users and topic date, so no other suite collides.
 */

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const d = databaseUrl ? describe : describe.skip;

let pool: pg.Pool;
let topicId: string;
const emails = ["xp-owner@test.local", "xp-rival@test.local", "xp-viewer@test.local", "xp-viewer2@test.local"];
const ids = new Map<string, string>();
const TOPIC_DATE = "1999-12-30";

async function ensureUser(email: string): Promise<string> {
  const existing = await pool.query<{ id: string }>("SELECT id FROM app_users WHERE email = $1", [email]);
  if (existing.rows.length) return existing.rows[0].id;
  const inserted = await pool.query<{ id: string }>(
    `WITH new_user AS (INSERT INTO app_users (email, password_hash) VALUES ($1, 'test') RETURNING id)
     INSERT INTO profiles (id, username) SELECT id, $2 FROM new_user RETURNING id`,
    [email, email.split("@")[0]],
  );
  return inserted.rows[0].id;
}

const user = (i: number) => ids.get(emails[i])!;

async function reset() {
  const own = [...ids.values()];
  if (!own.length) return;
  await pool.query("DELETE FROM debate_votes WHERE voter_id = ANY($1::uuid[])", [own]);
  await pool.query("DELETE FROM pvp_matches WHERE player_a = ANY($1::uuid[]) OR player_b = ANY($1::uuid[])", [own]);
  await pool.query("DELETE FROM solo_debates WHERE user_id = ANY($1::uuid[])", [own]);
}

async function soloDebate(owner: string, status: "active" | "completed", published: boolean): Promise<string> {
  const row = await pool.query<{ id: string }>(
    `INSERT INTO solo_debates (user_id, topic_id, side, status, published_at)
     VALUES ($1, $2, 'for', $3, CASE WHEN $4 THEN now() ELSE NULL END) RETURNING id`,
    [owner, topicId, status, published],
  );
  return row.rows[0].id;
}

async function pvpMatch(aYes: boolean | null, bYes: boolean | null): Promise<string> {
  const row = await pool.query<{ id: string }>(
    `INSERT INTO pvp_matches (topic_id, player_a, player_b, player_a_side, status, completed_at, player_a_publish, player_b_publish)
     VALUES ($1, $2, $3, 'for', 'completed', now(), $4, $5) RETURNING id`,
    [topicId, user(0), user(1), aYes, bYes],
  );
  return row.rows[0].id;
}

const vote = (voter: string, kind: string, debate: string, choice: string) =>
  pool.query<{ outcome: string }>("SELECT cast_debate_vote($1, $2, $3, $4) AS outcome", [voter, kind, debate, choice]).then((r) => r.rows[0].outcome);

d("Explore publication and votes (migration 042)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
    await applyTestMigrations(pool);
    for (const email of emails) ids.set(email, await ensureUser(email));
    await pool.query(
      `INSERT INTO daily_topics (topic_date, title, prompt) VALUES ($1, 'Explore test topic', 'exploreVotes.db.test')
       ON CONFLICT (topic_date) DO NOTHING`,
      [TOPIC_DATE],
    );
    topicId = (await pool.query<{ id: string }>("SELECT id FROM daily_topics WHERE topic_date = $1", [TOPIC_DATE])).rows[0].id;
  });

  beforeEach(reset);
  afterAll(async () => {
    await reset();
    await pool.end();
  });

  it("records one vote per viewer on a published, finished solo debate", async () => {
    const debate = await soloDebate(user(0), "completed", true);
    expect(await vote(user(2), "solo", debate, "against")).toBe("recorded");
    expect(await vote(user(2), "solo", debate, "for")).toBe("already_voted");
    expect(await vote(user(3), "solo", debate, "for")).toBe("recorded");
    const tally = await pool.query("SELECT choice, count(*)::int AS n FROM debate_votes WHERE solo_debate_id = $1 GROUP BY choice ORDER BY choice", [debate]);
    expect(tally.rows).toEqual([{ choice: "against", n: 1 }, { choice: "for", n: 1 }]);
  });

  it("refuses votes on unpublished or unfinished debates", async () => {
    expect(await vote(user(2), "solo", await soloDebate(user(0), "completed", false), "for")).toBe("not_public");
    expect(await vote(user(2), "solo", await soloDebate(user(0), "active", true), "for")).toBe("not_public");
  });

  it("refuses a learner voting on their own debate", async () => {
    const debate = await soloDebate(user(0), "completed", true);
    expect(await vote(user(0), "solo", debate, "for")).toBe("own_debate");
  });

  it("treats a PvP match as public only while both players said yes", async () => {
    expect(await vote(user(2), "pvp", await pvpMatch(true, null), "for")).toBe("not_public");
    expect(await vote(user(2), "pvp", await pvpMatch(true, false), "for")).toBe("not_public");
    const both = await pvpMatch(true, true);
    expect(await vote(user(2), "pvp", both, "for")).toBe("recorded");
    expect(await vote(user(1), "pvp", both, "against")).toBe("own_debate");
    // Either player withdrawing takes it down; no further votes.
    await pool.query("UPDATE pvp_matches SET player_b_publish = false WHERE id = $1", [both]);
    expect(await vote(user(3), "pvp", both, "for")).toBe("not_public");
  });

  it("refuses an unknown side or debate kind", async () => {
    const debate = await soloDebate(user(0), "completed", true);
    await expect(vote(user(2), "solo", debate, "draw")).rejects.toThrow(/choice must be for or against/);
    await expect(vote(user(2), "essay", debate, "for")).rejects.toThrow(/kind must be solo or pvp/);
  });

  it("removes a voter's votes with their profile", async () => {
    const debate = await soloDebate(user(0), "completed", true);
    await vote(user(3), "solo", debate, "for");
    const fk = await pool.query(
      `SELECT confdeltype FROM pg_constraint WHERE conrelid = 'debate_votes'::regclass AND contype = 'f'
         AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'debate_votes'::regclass AND attname = 'voter_id')]`,
    );
    expect(fk.rows[0].confdeltype).toBe("c");
  });
});
