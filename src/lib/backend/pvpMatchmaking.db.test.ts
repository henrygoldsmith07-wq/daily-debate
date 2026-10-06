import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import pg from "pg";
import { applyTestMigrations } from "../../../tests/helpers/applyTestMigrations";

/**
 * Integration tests for the atomic PvP matchmaking invariant (migration 003).
 *
 * These run only when TEST_DATABASE_URL points at a disposable Postgres (CI
 * provisions an ephemeral container). Without it the suite is skipped so the
 * standard unit-test run stays green.
 */

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const d = databaseUrl ? describe : describe.skip;

let pool: pg.Pool;

const userEmails = ["inv-a@test.local", "inv-b@test.local", "inv-c@test.local"];
const userIds = new Map<string, string>();

function applyMigrations(): Promise<void> {
  // Shared helper: single session-scoped advisory lock, DDL on the SAME client,
  // one shared key across all *.db.test.ts suites (prevents the concurrent
  // catalog-replay race — XX000 tuple concurrently updated — seen in e2e).
  return applyTestMigrations(pool);
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
  // integration test insert-or-get a row directly. DO NOTHING (never UPDATE):
  // the sibling db.test file touches the same topic_date row from a parallel
  // worker, and concurrent upsert-updates on one row raise
  // "tuple concurrently updated".
  const day = new Date().toISOString().slice(0, 10);
  await pool.query(
    `INSERT INTO daily_topics (topic_date, title, prompt)
     VALUES ($1, 'Integration test topic', 'Used by pvpMatchmaking.db.test')
     ON CONFLICT (topic_date) DO NOTHING`,
    [day],
  );
  const existing = await pool.query<{ id: string }>("SELECT id FROM daily_topics WHERE topic_date = $1", [day]);
  return existing.rows[0].id;
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
    for (const email of userEmails) {
      userIds.set(email, await ensureUser(email));
    }
  });

  // Each test starts from empty match/queue state: several tests assert on
  // row counts and active-match membership, so leaked state would couple
  // them to execution order.
  beforeEach(resetMatchState);

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

  it("converges two simultaneous first-time joiners into exactly one match", async () => {
    const [a, b] = ["inv-a@test.local", "inv-b@test.local"].map((e) => userIds.get(e)!);
    const topicId = await todayTopicId();
    await resetMatchState();

    const clientA = await pool.connect();
    const clientB = await pool.connect();
    try {
      const [joinA, joinB] = await Promise.all([
        clientA.query(
          "SELECT * FROM join_pvp_queue_and_match($1, $2, $3)",
          [a, topicId, 5],
        ),
        clientB.query(
          "SELECT * FROM join_pvp_queue_and_match($1, $2, $3)",
          [b, topicId, 5],
        ),
      ]);

      // The first serialized join waits; the second consumes that queue row
      // and returns the one created match. There must never be two matches.
      expect(joinA.rows.length + joinB.rows.length).toBe(1);

      const matches = await pool.query(
        "SELECT * FROM pvp_matches WHERE status = 'active'",
      );
      expect(matches.rows).toHaveLength(1);
      expect([matches.rows[0].player_a, matches.rows[0].player_b].sort()).toEqual(
        [a, b].sort(),
      );

      const queue = await pool.query("SELECT * FROM pvp_queue");
      expect(queue.rows).toHaveLength(0);
    } finally {
      clientA.release();
      clientB.release();
    }
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
    const c = userIds.get("inv-c@test.local")!;
    const topicId = await todayTopicId();
    // Self-contained setup (not leaked from an earlier test): b is matched with c.
    await pool.query(
      `INSERT INTO pvp_matches (topic_id, player_a, player_b, player_a_side, round_limit, current_turn_player, turn_started_at)
       VALUES ($1, $2, $3, 'for', 5, $2, now())`,
      [topicId, c, b],
    );
    const queued = await pool.query<{ queued: boolean }>(
      "SELECT enqueue_pvp_if_unmatched($1, $2) AS queued",
      [b, topicId],
    );
    expect(queued.rows[0].queued).toBe(false);
    const rows = await pool.query("SELECT * FROM pvp_queue WHERE user_id = $1", [b]);
    expect(rows.rows).toHaveLength(0);
  });

  it("keeps at most one active match per player even when their role changes", async () => {
    const [a, b, c] = userEmails.map((e) => userIds.get(e)!);
    const topicId = await todayTopicId();
    await resetMatchState();

    // a is player_b in the first match.
    await pool.query(
      `INSERT INTO pvp_matches (
         topic_id, player_a, player_b, player_a_side, round_limit,
         current_turn_player, turn_started_at
       ) VALUES ($1, $2, $3, 'for', 5, $2, now())`,
      [topicId, b, a],
    );

    // The old pair of per-column unique indexes allowed this because a moves
    // from player_b to player_a. The cross-role trigger must reject it.
    await expect(
      pool.query(
        `INSERT INTO pvp_matches (
           topic_id, player_a, player_b, player_a_side, round_limit,
           current_turn_player, turn_started_at
         ) VALUES ($1, $2, $3, 'against', 5, $2, now())`,
        [topicId, a, c],
      ),
    ).rejects.toThrow();

    const matches = await pool.query(
      "SELECT * FROM pvp_matches WHERE status = 'active'",
    );
    expect(matches.rows).toHaveLength(1);
  });

  it("keeps at most one active match per player under same-role indexes too", async () => {
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
