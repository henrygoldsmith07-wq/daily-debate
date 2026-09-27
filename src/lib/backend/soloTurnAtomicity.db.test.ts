import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { applyTestMigrations } from "../../../tests/helpers/applyTestMigrations";

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const d = databaseUrl ? describe : describe.skip;
let pool: pg.Pool;
let userId = "";
let topicId = "";

d("atomic solo-turn advancement", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl });
    await applyTestMigrations(pool);

    const email = "solo-turn-atomic@test.local";
    await pool.query("DELETE FROM app_users WHERE email = $1", [email]);
    const user = await pool.query<{ id: string }>(
      `WITH new_user AS (
         INSERT INTO app_users (email, password_hash) VALUES ($1, 'test') RETURNING id
       )
       INSERT INTO profiles (id, username) SELECT id, 'solo-turn-atomic' FROM new_user RETURNING id`,
      [email],
    );
    userId = user.rows[0].id;

    const day = new Date().toISOString().slice(0, 10);
    await pool.query(
      `INSERT INTO daily_topics (topic_date, title, prompt)
       VALUES ($1, 'Atomic turn topic', 'Atomic turn test prompt')
       ON CONFLICT (topic_date) DO NOTHING`,
      [day],
    );
    const topic = await pool.query<{ id: string }>("SELECT id FROM daily_topics WHERE topic_date = $1", [day]);
    topicId = topic.rows[0].id;
  });

  afterAll(async () => {
    await pool.query("DELETE FROM app_users WHERE id = $1", [userId]);
    await pool.end();
  });

  it("commits answer, next turn and round_count together and rejects duplicate advancement", async () => {
    const debate = await pool.query<{ id: string }>(
      "INSERT INTO solo_debates (user_id, topic_id, side, format, round_count) VALUES ($1, $2, 'for', 'full', 1) RETURNING id",
      [userId, topicId],
    );
    const debateId = debate.rows[0].id;
    const turn = await pool.query<{ id: string }>(
      "INSERT INTO solo_debate_turns (debate_id, round_number, ai_message) VALUES ($1, 1, 'Opening') RETURNING id",
      [debateId],
    );
    const turnId = turn.rows[0].id;

    const window = await pool.query<{ result: { startedAt: string } }>(
      "SELECT start_solo_turn_window($1, $2, $3, 'rapid-rebuttal', 60) AS result",
      [debateId, userId, turnId],
    );
    const receivedAt = new Date(Date.parse(window.rows[0].result.startedAt) + 5_000).toISOString();

    const advanced = await pool.query<{ result: { saved: boolean; reason: string; nextTurn: { round_number: number } | null } }>(
      `SELECT advance_solo_debate_turn(
        $1, $2, $3, $4::timestamptz, 'rapid-rebuttal', true,
        'My answer', 'text', '{}'::jsonb, 8, null, '{}'::jsonb, '{}'::jsonb, 2, 'Next challenge'
      ) AS result`,
      [debateId, userId, turnId, receivedAt],
    );
    expect(advanced.rows[0].result.saved).toBe(true);
    expect(advanced.rows[0].result.nextTurn?.round_number).toBe(2);

    const state = await pool.query<{ round_count: number; answered: string | null; turns: string }>(
      `SELECT d.round_count, t.user_message AS answered,
              (SELECT count(*)::text FROM solo_debate_turns x WHERE x.debate_id = d.id) AS turns
       FROM solo_debates d
       JOIN solo_debate_turns t ON t.id = $2
       WHERE d.id = $1`,
      [debateId, turnId],
    );
    expect(state.rows[0].round_count).toBe(2);
    expect(state.rows[0].answered).toBe("My answer");
    expect(Number(state.rows[0].turns)).toBe(2);

    const duplicate = await pool.query<{ result: { saved: boolean; reason: string } }>(
      `SELECT advance_solo_debate_turn(
        $1, $2, $3, $4::timestamptz, 'rapid-rebuttal', true,
        'Duplicate', 'text', '{}'::jsonb, 8, null, '{}'::jsonb, '{}'::jsonb, 2, 'Duplicate next'
      ) AS result`,
      [debateId, userId, turnId, receivedAt],
    );
    expect(duplicate.rows[0].result).toMatchObject({ saved: false, reason: "already-answered" });

    await pool.query("DELETE FROM solo_debates WHERE id = $1", [debateId]);
  });

  it("rejects a forged late timed submission without mutating the turn", async () => {
    const debate = await pool.query<{ id: string }>(
      "INSERT INTO solo_debates (user_id, topic_id, side, format, round_count) VALUES ($1, $2, 'against', 'full', 1) RETURNING id",
      [userId, topicId],
    );
    const debateId = debate.rows[0].id;
    const turn = await pool.query<{ id: string }>(
      "INSERT INTO solo_debate_turns (debate_id, round_number, ai_message) VALUES ($1, 1, 'Opening') RETURNING id",
      [debateId],
    );
    const turnId = turn.rows[0].id;

    const window = await pool.query<{ result: { expiresAt: string } }>(
      "SELECT start_solo_turn_window($1, $2, $3, 'rapid-rebuttal', 60) AS result",
      [debateId, userId, turnId],
    );
    const tooLate = new Date(Date.parse(window.rows[0].result.expiresAt) + 1_000).toISOString();

    const rejected = await pool.query<{ result: { saved: boolean; reason: string } }>(
      `SELECT advance_solo_debate_turn(
        $1, $2, $3, $4::timestamptz, 'rapid-rebuttal', true,
        'Late answer', 'text', '{}'::jsonb, 8, null, '{}'::jsonb, '{}'::jsonb, 2, 'Should not exist'
      ) AS result`,
      [debateId, userId, turnId, tooLate],
    );
    expect(rejected.rows[0].result).toMatchObject({ saved: false, reason: "timing-window-invalid" });

    const stored = await pool.query<{ user_message: string | null; count: string }>(
      `SELECT t.user_message,
              (SELECT count(*)::text FROM solo_debate_turns x WHERE x.debate_id = $2) AS count
       FROM solo_debate_turns t WHERE t.id = $1`,
      [turnId, debateId],
    );
    expect(stored.rows[0].user_message).toBeNull();
    expect(Number(stored.rows[0].count)).toBe(1);

    await pool.query("DELETE FROM solo_debates WHERE id = $1", [debateId]);
  });
});
