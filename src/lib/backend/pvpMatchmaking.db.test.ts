import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

/**
 * Integration tests for the atomic PvP matchmaking invariant (migration 003).
 *
 * These run only when TEST_DATABASE_URL points at a disposable Postgres (CI
 * provisions an ephemeral container). Without it the suite is skipped so the
 * standard unit-test run stays green.
 */

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const d = databaseUrl ? describe : describe.skip;

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../database/migrations", import.meta.url));

let pool: pg.Pool;

const userEmails = ["inv-a@test.local", "inv-b@test.local", "inv-c@test.local"];
const userIds = new Map<string, string>();

async function applyMigrations() {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    await pool.query(sql);
  }
}

async function ensureUser(email: string): Promise<string> {
  const existing = await pool.query<{ id: string }>("SELECT id FROM app_users WHERE email = $1", [email]);
  if (existing.rows.length) {
    const profile = await pool.query<{ id: string }>("SELECT id FROM profiles WHERE id = $1", [existing.rows[0].id]);
    if (profile.rows.length) return profile.rows[0].id;
  }
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

async function todayTopicId(): Promise<string> {
  // daily_topics is created by getOrCreateTodayTopic in the app; for the
  // integration test insert-or-get a row directly.
  const day = new Date().toISOString().slice(0, 10);
  const existing = await pool.query<{ id: string }>("SELECT id FROM daily_topics WHERE topic_date = $1", [day]);
  if (existing.rows.length) return existing.rows[0].id;
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO daily_topics (topic_date, title, prompt)
     VALUES ($1, 'Integration test topic', 'Used by pvpMatchmaking.db.test')
     ON CONFLICT (topic_date) DO UPDATE SET title = EXCLUDED.title
     RETURNING id`,
    [day],
  );
  return inserted.rows[0].id;
}

async function resetMatchState() {
  await pool.query("DELETE FROM pvp_turns");
  await pool.query("DELETE FROM pvp_matches");
  await pool.query("DELETE FROM pvp_queue");
  await pool.query("DELETE FROM solo_debate_turns");
  await pool.query("DELETE FROM solo_debates");
}

d("atomic PvP matchmaking (migration 003)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
    await applyMigrations();
    await resetMatchState();
    for (const email of userEmails) {
      userIds.set(email, await ensureUser(email));
    }
  });

  afterAll(async () => {
    await resetMatchState();
    await pool.end();
  });

  it("creates a match atomically when an opponent is queued and clears the queue", async () => {
    const [a, b] = ["inv-a@test.local", "inv-b@test.local"].map((e) => userIds.get(e)!);
    const topicId = await todayTopicId();
    await pool.query("INSERT INTO pvp_queue (user_id, topic_id) VALUES ($1, $2)", [a, topicId]);

    const claim = await pool.query(
      "SELECT * FROM claim_pvp_opponent_and_create_match($1, $2, $3)",
      [b, topicId, 5],
    );

    expect(claim.rows).toHaveLength(1);
    const match = claim.rows[0];
    expect([match.player_a, match.player_b].sort()).toEqual([a, b].sort());
    expect(match.status).toBe("active");
    expect(["for", "against"]).toContain(match.player_a_side);

    const queue = await pool.query("SELECT * FROM pvp_queue");
    expect(queue.rows).toHaveLength(0);
  });

  it("returns no rows when nobody is queued and enqueues the joiner instead", async () => {
    const [, b] = ["inv-a@test.local", "inv-b@test.local"].map((e) => userIds.get(e)!);
    const topicId = await todayTopicId();

    const claim = await pool.query(
      "SELECT * FROM claim_pvp_opponent_and_create_match($1, $2, $3)",
      [b, topicId, 5],
    );
    expect(claim.rows).toHaveLength(0);

    const queued = await pool.query<{ queued: boolean }>(
      "SELECT enqueue_pvp_if_unmatched($1, $2) AS queued",
      [b, topicId],
    );
    expect(queued.rows[0].queued).toBe(true);

    // Duplicate enqueue stays a single row and refreshes the topic.
    const again = await pool.query<{ queued: boolean }>(
      "SELECT enqueue_pvp_if_unmatched($1, $2) AS queued",
      [b, topicId],
    );
    expect(again.rows[0].queued).toBe(true);
    const rows = await pool.query("SELECT * FROM pvp_queue WHERE user_id = $1", [b]);
    expect(rows.rows).toHaveLength(1);
  });

  it("never double-matches two concurrent claimants racing for one opponent", async () => {
    const [a, b, c] = userEmails.map((e) => userIds.get(e)!);
    const topicId = await todayTopicId();
    await resetMatchState();
    await pool.query("INSERT INTO pvp_queue (user_id, topic_id) VALUES ($1, $2)", [a, topicId]);

    const clientB = await pool.connect();
    const clientC = await pool.connect();
    try {
      const [resultB, resultC] = await Promise.all([
        clientB.query("SELECT * FROM claim_pvp_opponent_and_create_match($1, $2, $3)", [b, topicId, 5]),
        clientC.query("SELECT * FROM claim_pvp_opponent_and_create_match($1, $2, $3)", [c, topicId, 5]),
      ]);

      const winners = [...resultB.rows, ...resultC.rows];
      expect(winners).toHaveLength(1);

      const matches = await pool.query("SELECT * FROM pvp_matches WHERE status = 'active'");
      expect(matches.rows).toHaveLength(1);
      const m = matches.rows[0];
      expect([m.player_a, m.player_b].sort()).toEqual([a, winners[0].player_b].sort());

      // The loser of the race is not silently matched anywhere.
      const loser = m.player_a === a ? (m.player_b === b ? c : b) : null;
      if (loser) {
        const loserMatches = await pool.query(
          "SELECT * FROM pvp_matches WHERE status = 'active' AND (player_a = $1 OR player_b = $1)",
          [loser],
        );
        expect(loserMatches.rows).toHaveLength(0);
      }
    } finally {
      clientB.release();
      clientC.release();
    }
  });

  it("rejects claiming for a joiner who already has an active match", async () => {
    const [a, b] = ["inv-a@test.local", "inv-b@test.local"].map((e) => userIds.get(e)!);
    const topicId = await todayTopicId();
    await resetMatchState();
    // b is already matched with c.
    const c = userIds.get("inv-c@test.local")!;
    await pool.query(
      `INSERT INTO pvp_matches (topic_id, player_a, player_b, player_a_side, round_limit, current_turn_player, turn_started_at)
       VALUES ($1, $2, $3, 'for', 5, $2, now())`,
      [topicId, c, b],
    );
    await pool.query("INSERT INTO pvp_queue (user_id, topic_id) VALUES ($1, $2)", [a, topicId]);

    const claim = await pool.query(
      "SELECT * FROM claim_pvp_opponent_and_create_match($1, $2, $3)",
      [b, topicId, 5],
    );
    expect(claim.rows).toHaveLength(0);

    const matches = await pool.query("SELECT * FROM pvp_matches WHERE status = 'active'");
    expect(matches.rows).toHaveLength(1);
  });

  it("refuses to enqueue a player who already has an active match", async () => {
    const b = userIds.get("inv-b@test.local")!;
    const topicId = await todayTopicId();
    const queued = await pool.query<{ queued: boolean }>(
      "SELECT enqueue_pvp_if_unmatched($1, $2) AS queued",
      [b, topicId],
    );
    expect(queued.rows[0].queued).toBe(false);
    const rows = await pool.query("SELECT * FROM pvp_queue WHERE user_id = $1", [b]);
    expect(rows.rows).toHaveLength(0);
  });

  it("keeps at most one active match per player under the partial unique indexes", async () => {
    const [a, b, c] = userEmails.map((e) => userIds.get(e)!);
    const topicId = await todayTopicId();
    await resetMatchState();
    await pool.query(
      `INSERT INTO pvp_matches (topic_id, player_a, player_b, player_a_side, round_limit, current_turn_player, turn_started_at)
       VALUES ($1, $2, $3, 'for', 5, $2, now())`,
      [topicId, a, b],
    );
    // a is already active; a second active match for a must violate the index.
    await expect(
      pool.query(
        `INSERT INTO pvp_matches (topic_id, player_a, player_b, player_a_side, round_limit, current_turn_player, turn_started_at)
         VALUES ($1, $2, $3, 'against', 5, $2, now())`,
        [topicId, a, c],
      ),
    ).rejects.toThrow();
  });
});
