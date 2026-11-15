import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import pg from "pg";
import { applyTestMigrations } from "../../../tests/helpers/applyTestMigrations";

/**
 * record_repair_attempt (migration 053), against real Postgres: two attempts
 * on the same repair that arrive together run one after the other, so an
 * identical rewrite is stored once and only the first success reads "no
 * prior success" (the route emits repair_episode_closed exactly once).
 */

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const d = databaseUrl ? describe : describe.skip;

let pool: pg.Pool;
let userId: string;
let debateId: string;
const EMAIL = "record-repair@test.local";
const TOPIC_DATE = "1999-12-25";

type Outcome = { outcome: "recorded" | "duplicate"; priorSuccess?: boolean; succeeded?: boolean };
const CALL = "SELECT record_repair_attempt($1, $2, 'evidence', 'n1', 'source', $3, $4, $5, '[]'::jsonb) AS r";

async function racePair(first: [string, number, boolean], second: [string, number, boolean]): Promise<[Outcome, Outcome]> {
  const [a, b] = await Promise.all([pool.connect(), pool.connect()]);
  try {
    await a.query("BEGIN");
    await b.query("BEGIN");
    const bPid = (await b.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const one = (await a.query<{ r: Outcome }>(CALL, [userId, debateId, ...first])).rows[0].r;
    let settled = false;
    const pending = b.query<{ r: Outcome }>(CALL, [userId, debateId, ...second]).finally(() => {
      settled = true;
    });
    // Commit A only once B is blocked on a lock or has already finished, so
    // B's checks really overlap A's open attempt.
    for (let i = 0; i < 200 && !settled; i += 1) {
      const waiting = await pool.query("SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock'", [bPid]);
      if (waiting.rowCount) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await a.query("COMMIT");
    const two = (await pending).rows[0].r;
    await b.query("COMMIT");
    return [one, two];
  } finally {
    await a.query("ROLLBACK").catch(() => undefined);
    await b.query("ROLLBACK").catch(() => undefined);
    a.release();
    b.release();
  }
}

const rows = async () =>
  (await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM repair_results WHERE debate_id = $1", [debateId])).rows[0].n;

d("record_repair_attempt (migration 053)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
    await applyTestMigrations(pool);
    const existing = await pool.query<{ id: string }>("SELECT id FROM app_users WHERE email = $1", [EMAIL]);
    userId = existing.rows[0]?.id ?? (await pool.query<{ id: string }>(
      `WITH u AS (INSERT INTO app_users (email, password_hash) VALUES ($1, 'test') RETURNING id)
       INSERT INTO profiles (id, username) SELECT id, 'record-repair' FROM u RETURNING id`,
      [EMAIL],
    )).rows[0].id;
    await pool.query(
      `INSERT INTO daily_topics (topic_date, title, prompt) VALUES ($1, 'Repair topic', 'recordRepairAttempt.db.test')
       ON CONFLICT (topic_date) DO NOTHING`,
      [TOPIC_DATE],
    );
    const topicId = (await pool.query<{ id: string }>("SELECT id FROM daily_topics WHERE topic_date = $1", [TOPIC_DATE])).rows[0].id;
    await pool.query("DELETE FROM solo_debates WHERE user_id = $1", [userId]);
    debateId = (await pool.query<{ id: string }>(
      "INSERT INTO solo_debates (user_id, topic_id, side, status) VALUES ($1, $2, 'for', 'completed') RETURNING id",
      [userId, topicId],
    )).rows[0].id;
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM repair_results WHERE debate_id = $1", [debateId]);
  });

  afterAll(async () => {
    await pool.query("DELETE FROM app_users WHERE email = $1", [EMAIL]);
    await pool.end();
  });

  it("records a first attempt, then answers the same rewrite from the stored row", async () => {
    const first = (await pool.query<{ r: Outcome }>(CALL, [userId, debateId, "My rewrite.", 70, true])).rows[0].r;
    expect(first).toMatchObject({ outcome: "recorded", priorSuccess: false });
    const again = (await pool.query<{ r: Outcome }>(CALL, [userId, debateId, "My rewrite.", 10, false])).rows[0].r;
    expect(again).toMatchObject({ outcome: "duplicate", succeeded: true });
    expect(await rows()).toBe(1);
  });

  it("stores an identical rewrite once when two submissions race", async () => {
    const [one, two] = await racePair(["Same text.", 70, true], ["Same text.", 70, true]);
    expect(one.outcome).toBe("recorded");
    expect(two.outcome).toBe("duplicate");
    expect(await rows()).toBe(1);
  });

  it("lets only the first of two racing successes close the episode", async () => {
    const [one, two] = await racePair(["First version.", 70, true], ["Second version.", 80, true]);
    expect(one).toMatchObject({ outcome: "recorded", priorSuccess: false });
    expect(two).toMatchObject({ outcome: "recorded", priorSuccess: true });
    expect(await rows()).toBe(2);
  });
});
