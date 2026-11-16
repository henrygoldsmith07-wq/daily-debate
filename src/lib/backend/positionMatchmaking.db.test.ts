import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import pg from "pg";
import { applyTestMigrations } from "../../../tests/helpers/applyTestMigrations";

/**
 * Position-aware matchmaking (migration 041): the queue pairs a For only with
 * an Against, the waiting player keeps the side they queued with, and a row
 * queued without a side (the previous build) is never claimed.
 *
 * Runs only with TEST_DATABASE_URL. Uses its own users AND its own topic date,
 * so the older matchmaking suite (whose function ignores sides) can never
 * claim a row this suite queued, or the other way round.
 */

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const d = databaseUrl ? describe : describe.skip;

let pool: pg.Pool;
let topicId: string;
const emails = ["pos-a@test.local", "pos-b@test.local", "pos-c@test.local"];
const ids = new Map<string, string>();
const TOPIC_DATE = "1999-12-31";

async function ensureUser(email: string): Promise<string> {
  const existing = await pool.query<{ id: string }>("SELECT id FROM app_users WHERE email = $1", [email]);
  if (existing.rows.length) return existing.rows[0].id;
  const inserted = await pool.query<{ id: string }>(
    `WITH new_user AS (
       INSERT INTO app_users (email, password_hash) VALUES ($1, 'test')
       RETURNING id
     )
     INSERT INTO profiles (id, username) SELECT id, $2 FROM new_user RETURNING id`,
    [email, email.split("@")[0]],
  );
  return inserted.rows[0].id;
}

function user(index: number): string {
  return ids.get(emails[index])!;
}

async function reset() {
  const own = [...ids.values()];
  if (!own.length) return;
  await pool.query(
    "DELETE FROM pvp_turns WHERE match_id IN (SELECT id FROM pvp_matches WHERE player_a = ANY($1::uuid[]) OR player_b = ANY($1::uuid[]))",
    [own],
  );
  await pool.query("DELETE FROM pvp_matches WHERE player_a = ANY($1::uuid[]) OR player_b = ANY($1::uuid[])", [own]);
  await pool.query("DELETE FROM pvp_queue WHERE user_id = ANY($1::uuid[])", [own]);
  await pool.query("DELETE FROM motion_positions WHERE user_id = ANY($1::uuid[])", [own]);
}

function join(joiner: string, side: string | null) {
  return pool.query("SELECT * FROM join_pvp_queue_by_position($1, $2, $3, $4)", [joiner, topicId, side, 5]);
}

d("position-aware PvP matchmaking (migration 041)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
    await applyTestMigrations(pool);
    for (const email of emails) ids.set(email, await ensureUser(email));
    await pool.query(
      `INSERT INTO daily_topics (topic_date, title, prompt)
       VALUES ($1, 'Position matchmaking topic', 'Used by positionMatchmaking.db.test')
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

  it("pairs a For with an Against and keeps each player's side", async () => {
    expect((await join(user(0), "for")).rows).toHaveLength(0);
    const joined = await join(user(1), "against");
    expect(joined.rows).toHaveLength(1);
    const match = joined.rows[0];
    expect(match.player_a).toBe(user(0));
    expect(match.player_b).toBe(user(1));
    // player_a is the waiting For; player_b therefore argues Against.
    expect(match.player_a_side).toBe("for");
    const queue = await pool.query("SELECT 1 FROM pvp_queue WHERE user_id = ANY($1::uuid[])", [[user(0), user(1)]]);
    expect(queue.rows).toHaveLength(0);
  });

  it("never pairs two people who hold the same position", async () => {
    expect((await join(user(0), "for")).rows).toHaveLength(0);
    expect((await join(user(1), "for")).rows).toHaveLength(0);
    const queued = await pool.query<{ side: string }>(
      "SELECT side FROM pvp_queue WHERE user_id = ANY($1::uuid[]) ORDER BY side",
      [[user(0), user(1)]],
    );
    expect(queued.rows.map((r) => r.side)).toEqual(["for", "for"]);
    const matches = await pool.query("SELECT 1 FROM pvp_matches WHERE player_a = ANY($1::uuid[]) OR player_b = ANY($1::uuid[])", [[user(0), user(1)]]);
    expect(matches.rows).toHaveLength(0);
  });

  it("passes over a same-side waiter and pairs with the earliest opposite one", async () => {
    // Two Fors wait; an Against joins and must take the EARLIER For.
    await join(user(0), "for");
    await join(user(1), "for");
    const match = (await join(user(2), "against")).rows[0];
    expect(match.player_a).toBe(user(0));
    expect(match.player_b).toBe(user(2));
    expect(match.player_a_side).toBe("for");
    // The other For is still waiting for someone who disagrees.
    const waiting = await pool.query<{ side: string }>("SELECT side FROM pvp_queue WHERE user_id = $1", [user(1)]);
    expect(waiting.rows).toEqual([{ side: "for" }]);
  });

  it("never claims a row queued without a side", async () => {
    await pool.query("INSERT INTO pvp_queue (user_id, topic_id) VALUES ($1, $2)", [user(0), topicId]);
    expect((await join(user(1), "against")).rows).toHaveLength(0);
    expect((await join(user(2), "for")).rows).toHaveLength(1);
  });

  it("refuses a missing or unknown side", async () => {
    await expect(join(user(0), null)).rejects.toThrow(/side must be for or against/);
    await expect(join(user(0), "challenge")).rejects.toThrow(/side must be for or against/);
  });

  it("returns the active match instead of queueing a player who already has one", async () => {
    await join(user(0), "for");
    const first = (await join(user(1), "against")).rows[0];
    const again = await join(user(0), "for");
    expect(again.rows[0].id).toBe(first.id);
  });

  it("stores one changeable position per learner and motion", async () => {
    await pool.query("INSERT INTO motion_positions (user_id, topic_id, position) VALUES ($1, $2, 'for')", [user(0), topicId]);
    await pool.query(
      `INSERT INTO motion_positions (user_id, topic_id, position) VALUES ($1, $2, 'against')
       ON CONFLICT (user_id, topic_id) DO UPDATE SET position = excluded.position, updated_at = now()`,
      [user(0), topicId],
    );
    const rows = await pool.query("SELECT position FROM motion_positions WHERE user_id = $1 AND topic_id = $2", [user(0), topicId]);
    expect(rows.rows).toEqual([{ position: "against" }]);
    await expect(
      pool.query("INSERT INTO motion_positions (user_id, topic_id, position) VALUES ($1, $2, 'maybe')", [user(1), topicId]),
    ).rejects.toThrow();
  });
});
