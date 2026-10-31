import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import pg from "pg";
import { applyTestMigrations } from "../../../tests/helpers/applyTestMigrations";

/**
 * Explore reports (migration 043), against real Postgres: one report per
 * reader per published debate, a participant cannot report their own, and
 * three reports from distinct accounts take a debate off Explore (unpublished
 * and stamped so its author cannot put it back). Own users and topic date, so
 * no other suite collides.
 */

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const d = databaseUrl ? describe : describe.skip;

let pool: pg.Pool;
let topicId: string;
const emails = ["xr-owner@test.local", "xr-rival@test.local", "xr-r1@test.local", "xr-r2@test.local", "xr-r3@test.local"];
const ids = new Map<string, string>();
const TOPIC_DATE = "1999-12-29";

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
  await pool.query("DELETE FROM debate_reports WHERE reporter_id = ANY($1::uuid[])", [own]);
  await pool.query("DELETE FROM pvp_matches WHERE player_a = ANY($1::uuid[]) OR player_b = ANY($1::uuid[])", [own]);
  await pool.query("DELETE FROM solo_debates WHERE user_id = ANY($1::uuid[])", [own]);
}

async function publishedSolo(): Promise<string> {
  const row = await pool.query<{ id: string }>(
    `INSERT INTO solo_debates (user_id, topic_id, side, status, published_at)
     VALUES ($1, $2, 'for', 'completed', now()) RETURNING id`,
    [user(0), topicId],
  );
  return row.rows[0].id;
}

async function publishedMatch(): Promise<string> {
  const row = await pool.query<{ id: string }>(
    `INSERT INTO pvp_matches (topic_id, player_a, player_b, player_a_side, status, completed_at, player_a_publish, player_b_publish)
     VALUES ($1, $2, $3, 'for', 'completed', now(), true, true) RETURNING id`,
    [topicId, user(0), user(1)],
  );
  return row.rows[0].id;
}

const report = (reporter: string, kind: string, debate: string, reason = "abuse") =>
  pool
    .query<{ outcome: string }>("SELECT report_debate($1, $2, $3, $4) AS outcome", [reporter, kind, debate, reason])
    .then((r) => r.rows[0].outcome);

d("Explore reports (migration 043)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
    await applyTestMigrations(pool);
    for (const email of emails) ids.set(email, await ensureUser(email));
    await pool.query(
      `INSERT INTO daily_topics (topic_date, title, prompt) VALUES ($1, 'Explore report topic', 'exploreReports.db.test')
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

  it("records one report per reader and leaves the debate up below the threshold", async () => {
    const debate = await publishedSolo();
    expect(await report(user(2), "solo", debate)).toBe("recorded");
    expect(await report(user(2), "solo", debate, "spam")).toBe("already_reported");
    expect(await report(user(3), "solo", debate)).toBe("recorded");
    const row = await pool.query("SELECT published_at IS NOT NULL AS live, explore_blocked_at FROM solo_debates WHERE id = $1", [debate]);
    expect(row.rows[0]).toEqual({ live: true, explore_blocked_at: null });
  });

  it("refuses a participant reporting their own debate", async () => {
    expect(await report(user(0), "solo", await publishedSolo())).toBe("own_debate");
    const match = await publishedMatch();
    expect(await report(user(0), "pvp", match)).toBe("own_debate");
    expect(await report(user(1), "pvp", match)).toBe("own_debate");
  });

  it("takes a solo debate off Explore at three distinct reporters and keeps it off", async () => {
    const debate = await publishedSolo();
    expect(await report(user(1), "solo", debate)).toBe("recorded");
    expect(await report(user(2), "solo", debate)).toBe("recorded");
    expect(await report(user(3), "solo", debate, "personal_info")).toBe("taken_down");
    const row = await pool.query("SELECT published_at, explore_blocked_at IS NOT NULL AS blocked FROM solo_debates WHERE id = $1", [debate]);
    expect(row.rows[0]).toEqual({ published_at: null, blocked: true });
    // Unpublished, so it is no longer reportable or votable.
    expect(await report(user(4), "solo", debate)).toBe("not_public");
    expect(
      (await pool.query("SELECT cast_debate_vote($1, 'solo', $2, 'for') AS o", [user(4), debate])).rows[0].o,
    ).toBe("not_public");
  });

  it("takes a PvP match off Explore by withdrawing both players' yes", async () => {
    const match = await publishedMatch();
    await report(user(2), "pvp", match);
    await report(user(3), "pvp", match);
    expect(await report(user(4), "pvp", match)).toBe("taken_down");
    const row = await pool.query(
      "SELECT player_a_publish, player_b_publish, explore_blocked_at IS NOT NULL AS blocked FROM pvp_matches WHERE id = $1",
      [match],
    );
    expect(row.rows[0]).toEqual({ player_a_publish: false, player_b_publish: false, blocked: true });
  });

  it("refuses unpublished debates and unknown reasons or kinds", async () => {
    const draft = await pool.query<{ id: string }>(
      `INSERT INTO solo_debates (user_id, topic_id, side, status) VALUES ($1, $2, 'for', 'completed') RETURNING id`,
      [user(0), topicId],
    );
    expect(await report(user(2), "solo", draft.rows[0].id)).toBe("not_public");
    const debate = await publishedSolo();
    await expect(report(user(2), "solo", debate, "dislike")).rejects.toThrow(/unknown reason/);
    await expect(report(user(2), "essay", debate)).rejects.toThrow(/kind must be solo or pvp/);
  });

  it("removes a reporter's reports with their profile", async () => {
    const fk = await pool.query(
      `SELECT confdeltype FROM pg_constraint WHERE conrelid = 'debate_reports'::regclass AND contype = 'f'
         AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'debate_reports'::regclass AND attname = 'reporter_id')]`,
    );
    expect(fk.rows[0].confdeltype).toBe("c");
  });
});
