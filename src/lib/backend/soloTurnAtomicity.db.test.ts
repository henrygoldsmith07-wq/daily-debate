import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { applyTestMigrations } from "../../../tests/helpers/applyTestMigrations";

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const d = databaseUrl ? describe : describe.skip;
let pool: pg.Pool;
let userId = "";
let topicId = "";

async function createDebate(side: "for" | "against" = "for") {
  const debate = await pool.query<{ id: string }>(
    "INSERT INTO solo_debates (user_id, topic_id, side, format, round_count) VALUES ($1, $2, $3, 'full', 1) RETURNING id",
    [userId, topicId, side],
  );
  const debateId = debate.rows[0].id;
  const turn = await pool.query<{ id: string }>(
    "INSERT INTO solo_debate_turns (debate_id, round_number, ai_message) VALUES ($1, 1, 'Opening') RETURNING id",
    [debateId],
  );
  return { debateId, turnId: turn.rows[0].id };
}

d("durable solo-turn submissions", () => {
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

  it("does not reset a timed attempt after switching away and back", async () => {
    const { debateId, turnId } = await createDebate();

    const first = await pool.query<{ result: { startedAt: string; expiresAt: string; remainingSeconds: number } }>(
      "SELECT start_solo_turn_window($1, $2, $3, 'rapid-rebuttal', 60) AS result",
      [debateId, userId, turnId],
    );
    await pool.query(
      "SELECT start_solo_turn_window($1, $2, $3, 'text', NULL) AS result",
      [debateId, userId, turnId],
    );
    const resumed = await pool.query<{ result: { startedAt: string; expiresAt: string; remainingSeconds: number } }>(
      "SELECT start_solo_turn_window($1, $2, $3, 'rapid-rebuttal', 60) AS result",
      [debateId, userId, turnId],
    );

    expect(resumed.rows[0].result.startedAt).toBe(first.rows[0].result.startedAt);
    expect(resumed.rows[0].result.expiresAt).toBe(first.rows[0].result.expiresAt);
    expect(resumed.rows[0].result.remainingSeconds).toBeLessThanOrEqual(first.rows[0].result.remainingSeconds);

    const stored = await pool.query<{ has_rapid: boolean }>(
      "SELECT response_windows ? 'rapid-rebuttal' AS has_rapid FROM solo_debate_turns WHERE id = $1",
      [turnId],
    );
    expect(stored.rows[0].has_rapid).toBe(true);

    await pool.query("DELETE FROM solo_debates WHERE id = $1", [debateId]);
  });

  it("stages the answer before AI work, blocks a duplicate claim, and resumes after release", async () => {
    const { debateId, turnId } = await createDebate();
    await pool.query(
      "SELECT start_solo_turn_window($1, $2, $3, 'rapid-rebuttal', 60) AS result",
      [debateId, userId, turnId],
    );

    const token1 = crypto.randomUUID();
    const token2 = crypto.randomUUID();
    const claimSql = `SELECT claim_solo_turn_submission(
      $1, $2, $3, $4::uuid, 'rapid-rebuttal', true,
      'My accepted answer', 'text', '{}'::jsonb, 8, '{}'::jsonb,
      '{"modeId":"rapid-rebuttal","elapsedSeconds":0,"modeWarnings":[],"speechTiming":null,"speechAnalysis":null,"speechQuality":null}'::jsonb,
      0, 300
    ) AS result`;

    const claimed = await pool.query<{ result: { claimed: boolean; reason: string; resumed: boolean; elapsedSeconds: number; staged: { userMessage: string; trainingMeta: { elapsedSeconds: number } } } }>(
      claimSql,
      [debateId, userId, turnId, token1],
    );
    expect(claimed.rows[0].result).toMatchObject({ claimed: true, reason: "staged", resumed: false });
    expect(claimed.rows[0].result.staged.userMessage).toBe("My accepted answer");
    expect(claimed.rows[0].result.staged.trainingMeta.elapsedSeconds).toBeGreaterThanOrEqual(0);

    const stagedState = await pool.query<{
      user_message: string | null;
      staged_user_message: string | null;
      submission_token: string | null;
    }>(
      "SELECT user_message, staged_user_message, submission_token::text FROM solo_debate_turns WHERE id = $1",
      [turnId],
    );
    expect(stagedState.rows[0].user_message).toBeNull();
    expect(stagedState.rows[0].staged_user_message).toBe("My accepted answer");
    expect(stagedState.rows[0].submission_token).toBe(token1);

    const concurrent = await pool.query<{ result: { claimed: boolean; reason: string } }>(
      claimSql,
      [debateId, userId, turnId, token2],
    );
    expect(concurrent.rows[0].result).toMatchObject({ claimed: false, reason: "submission-in-progress" });

    const released = await pool.query<{ released: boolean }>(
      "SELECT release_solo_turn_submission($1, $2, $3, $4::uuid) AS released",
      [debateId, userId, turnId, token1],
    );
    expect(released.rows[0].released).toBe(true);

    const resumed = await pool.query<{ result: { claimed: boolean; reason: string; resumed: boolean } }>(
      claimSql,
      [debateId, userId, turnId, token2],
    );
    expect(resumed.rows[0].result).toMatchObject({ claimed: true, reason: "resumed", resumed: true });

    const finalized = await pool.query<{ result: { saved: boolean; completedTurn: { user_message: string }; nextTurn: { round_number: number } } }>(
      "SELECT finalize_solo_turn_submission($1, $2, $3, $4::uuid, 'Feedback', 2, 'Next challenge') AS result",
      [debateId, userId, turnId, token2],
    );
    expect(finalized.rows[0].result.saved).toBe(true);
    expect(finalized.rows[0].result.completedTurn.user_message).toBe("My accepted answer");
    expect(finalized.rows[0].result.nextTurn.round_number).toBe(2);

    const state = await pool.query<{
      round_count: number;
      user_message: string | null;
      staged_user_message: string | null;
      turns: string;
    }>(
      `SELECT d.round_count, t.user_message, t.staged_user_message,
              (SELECT count(*)::text FROM solo_debate_turns x WHERE x.debate_id = d.id) AS turns
       FROM solo_debates d
       JOIN solo_debate_turns t ON t.id = $2
       WHERE d.id = $1`,
      [debateId, turnId],
    );
    expect(state.rows[0].round_count).toBe(2);
    expect(state.rows[0].user_message).toBe("My accepted answer");
    expect(state.rows[0].staged_user_message).toBeNull();
    expect(Number(state.rows[0].turns)).toBe(2);

    await pool.query("DELETE FROM solo_debates WHERE id = $1", [debateId]);
  });

  it("uses the database clock to reject an expired timed submission before staging", async () => {
    const { debateId, turnId } = await createDebate("against");
    await pool.query(
      "SELECT start_solo_turn_window($1, $2, $3, 'rapid-rebuttal', 60) AS result",
      [debateId, userId, turnId],
    );
    await pool.query(
      `UPDATE solo_debate_turns
       SET response_window_expires_at = clock_timestamp() - interval '1 second',
           response_windows = jsonb_set(
             response_windows,
             '{rapid-rebuttal,expiresAt}',
             to_jsonb(clock_timestamp() - interval '1 second'),
             false
           )
       WHERE id = $1`,
      [turnId],
    );

    const token = crypto.randomUUID();
    const rejected = await pool.query<{ result: { claimed: boolean; reason: string } }>(
      `SELECT claim_solo_turn_submission(
        $1, $2, $3, $4::uuid, 'rapid-rebuttal', true,
        'Late answer', 'text', '{}'::jsonb, 8, '{}'::jsonb,
        '{"modeId":"rapid-rebuttal","elapsedSeconds":0,"modeWarnings":[],"speechTiming":null,"speechAnalysis":null,"speechQuality":null}'::jsonb,
        0, 300
      ) AS result`,
      [debateId, userId, turnId, token],
    );
    expect(rejected.rows[0].result).toMatchObject({ claimed: false, reason: "timing-window-invalid" });

    const stored = await pool.query<{ user_message: string | null; staged_user_message: string | null }>(
      "SELECT user_message, staged_user_message FROM solo_debate_turns WHERE id = $1",
      [turnId],
    );
    expect(stored.rows[0].user_message).toBeNull();
    expect(stored.rows[0].staged_user_message).toBeNull();

    await pool.query("DELETE FROM solo_debates WHERE id = $1", [debateId]);
  });
});
