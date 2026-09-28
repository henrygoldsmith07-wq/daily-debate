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

    const roundEvent = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM product_events WHERE debate_id = $1 AND name = 'round_completed' AND round = 1",
      [debateId],
    );
    expect(roundEvent.rows[0].count).toBe("1");

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

  it("blocks debate finalization while a staged response still needs opponent generation", async () => {
    const { debateId, turnId } = await createDebate();
    const submissionToken = crypto.randomUUID();

    const staged = await pool.query<{ result: { claimed: boolean; reason: string } }>(
      `SELECT claim_solo_turn_submission(
        $1, $2, $3, $4::uuid, 'text', false,
        'Saved before finish', 'text', '{}'::jsonb, 10, '{}'::jsonb,
        '{"modeId":"text","elapsedSeconds":12,"modeWarnings":[],"speechTiming":null,"speechAnalysis":null,"speechQuality":null}'::jsonb,
        12, 300
      ) AS result`,
      [debateId, userId, turnId, submissionToken],
    );
    expect(staged.rows[0].result).toMatchObject({ claimed: true, reason: "staged" });

    const finishToken = crypto.randomUUID();
    const finishClaim = await pool.query<{ claimed: boolean }>(
      "SELECT claim_solo_debate_finalization($1, $2, $3::uuid, 300) AS claimed",
      [debateId, userId, finishToken],
    );
    expect(finishClaim.rows[0].claimed).toBe(false);

    await pool.query(
      "SELECT release_solo_turn_submission($1, $2, $3, $4::uuid)",
      [debateId, userId, turnId, submissionToken],
    );
    await pool.query("DELETE FROM solo_debates WHERE id = $1", [debateId]);
  });

  it("blocks turn and timer work once finalization owns the debate", async () => {
    const { debateId, turnId } = await createDebate();
    const finishToken = crypto.randomUUID();
    const finishClaim = await pool.query<{ claimed: boolean }>(
      "SELECT claim_solo_debate_finalization($1, $2, $3::uuid, 300) AS claimed",
      [debateId, userId, finishToken],
    );
    expect(finishClaim.rows[0].claimed).toBe(true);

    const window = await pool.query<{ result: unknown }>(
      "SELECT start_solo_turn_window($1, $2, $3, 'rapid-rebuttal', 60) AS result",
      [debateId, userId, turnId],
    );
    expect(window.rows[0].result).toBeNull();

    const submissionToken = crypto.randomUUID();
    const turnClaim = await pool.query<{ result: { claimed: boolean; reason: string } }>(
      `SELECT claim_solo_turn_submission(
        $1, $2, $3, $4::uuid, 'text', false,
        'Too late to add', 'text', '{}'::jsonb, 10, '{}'::jsonb,
        '{"modeId":"text","elapsedSeconds":12,"modeWarnings":[],"speechTiming":null,"speechAnalysis":null,"speechQuality":null}'::jsonb,
        12, 300
      ) AS result`,
      [debateId, userId, turnId, submissionToken],
    );
    expect(turnClaim.rows[0].result).toMatchObject({ claimed: false, reason: "debate-finalizing" });

    const released = await pool.query<{ released: boolean }>(
      "SELECT release_solo_debate_finalization($1, $2, $3::uuid) AS released",
      [debateId, userId, finishToken],
    );
    expect(released.rows[0].released).toBe(true);

    await pool.query("DELETE FROM solo_debates WHERE id = $1", [debateId]);
  });

  it("serializes timed-window mutation before finalization can claim the debate", async () => {
    const { debateId, turnId } = await createDebate();
    const timerClient = await pool.connect();
    const finishClient = await pool.connect();
    const finishToken = crypto.randomUUID();

    try {
      await timerClient.query("BEGIN");
      const timer = await timerClient.query<{ result: { modeId: string } | null }>(
        "SELECT start_solo_turn_window($1, $2, $3, 'rapid-rebuttal', 60) AS result",
        [debateId, userId, turnId],
      );
      expect(timer.rows[0].result?.modeId).toBe("rapid-rebuttal");

      await finishClient.query("SET lock_timeout = '100ms'");
      await expect(
        finishClient.query(
          "SELECT claim_solo_debate_finalization($1, $2, $3::uuid, 300) AS claimed",
          [debateId, userId, finishToken],
        ),
      ).rejects.toMatchObject({ code: "55P03" });

      await timerClient.query("COMMIT");
      await finishClient.query("SET lock_timeout = '0'");

      const finish = await finishClient.query<{ claimed: boolean }>(
        "SELECT claim_solo_debate_finalization($1, $2, $3::uuid, 300) AS claimed",
        [debateId, userId, finishToken],
      );
      expect(finish.rows[0].claimed).toBe(true);
    } finally {
      await timerClient.query("ROLLBACK").catch(() => undefined);
      timerClient.release();
      finishClient.release();
      await pool.query("DELETE FROM solo_debates WHERE id = $1", [debateId]);
    }
  });

  it("uses the stored IANA timezone for streaks and persists compact result metadata without overwriting it", async () => {
    const { debateId, turnId } = await createDebate();
    await pool.query(
      "UPDATE profiles SET timezone = 'Pacific/Kiritimati' WHERE id = $1",
      [userId],
    );
    await pool.query(
      "UPDATE solo_debate_turns SET user_message = 'Completed answer', turn_score = 25 WHERE id = $1",
      [turnId],
    );

    const expected = await pool.query<{ activity_date: string }>(
      "SELECT ((clock_timestamp() AT TIME ZONE 'Pacific/Kiritimati')::date)::text AS activity_date",
    );

    const finishToken = crypto.randomUUID();
    const finishClaim = await pool.query<{ claimed: boolean }>(
      "SELECT claim_solo_debate_finalization($1, $2, $3::uuid, 300) AS claimed",
      [debateId, userId, finishToken],
    );
    expect(finishClaim.rows[0].claimed).toBe(true);

    const finalized = await pool.query<{ finalized: boolean }>(
      `SELECT finalize_solo_debate_v3(
        $1, $2, $3::uuid, 25, 7, 500, clock_timestamp(),
        '{}'::jsonb, '{"performanceScore":50,"bonusXP":7}'::jsonb,
        false, NULL::uuid, false, NULL::boolean
      ) AS finalized`,
      [debateId, userId, finishToken],
    );
    expect(finalized.rows[0].finalized).toBe(true);

    const profile = await pool.query<{ timezone: string; last_activity_date: string }>(
      "SELECT timezone, last_activity_date::text FROM profiles WHERE id = $1",
      [userId],
    );
    expect(profile.rows[0].timezone).toBe("Pacific/Kiritimati");
    expect(profile.rows[0].last_activity_date).toBe(expected.rows[0].activity_date);

    const compact = await pool.query<{ performance_score: number; bonus_xp: number }>(
      "SELECT performance_score, bonus_xp FROM solo_debates WHERE id = $1",
      [debateId],
    );
    expect(compact.rows[0]).toEqual({ performance_score: 50, bonus_xp: 7 });

    const completionEvent = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM product_events WHERE debate_id = $1 AND name = 'debate_completed'",
      [debateId],
    );
    expect(completionEvent.rows[0].count).toBe("1");

    const replayedFinalize = await pool.query<{ finalized: boolean }>(
      `SELECT finalize_solo_debate_v3(
        $1, $2, $3::uuid, 25, 7, 500, clock_timestamp(),
        '{}'::jsonb, '{"performanceScore":50,"bonusXP":7}'::jsonb,
        false, NULL::uuid, false, NULL::boolean
      ) AS finalized`,
      [debateId, userId, finishToken],
    );
    expect(replayedFinalize.rows[0].finalized).toBe(false);

    const completionEventAfterReplay = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM product_events WHERE debate_id = $1 AND name = 'debate_completed'",
      [debateId],
    );
    expect(completionEventAfterReplay.rows[0].count).toBe("1");

    await pool.query(
      "UPDATE profiles SET total_points = 0, level = 1, current_streak = 0, longest_streak = 0, last_activity_date = NULL, timezone = 'UTC' WHERE id = $1",
      [userId],
    );
    await pool.query("DELETE FROM solo_debates WHERE id = $1", [debateId]);
  });

  it("recovers a stale finalization lease before accepting new turn work", async () => {
    const { debateId, turnId } = await createDebate();
    const finishToken = crypto.randomUUID();
    const claimed = await pool.query<{ claimed: boolean }>(
      "SELECT claim_solo_debate_finalization($1, $2, $3::uuid, 300) AS claimed",
      [debateId, userId, finishToken],
    );
    expect(claimed.rows[0].claimed).toBe(true);

    await pool.query(
      "UPDATE solo_debates SET finalization_started_at = clock_timestamp() - interval '301 seconds' WHERE id = $1",
      [debateId],
    );

    const submissionToken = crypto.randomUUID();
    const turnClaim = await pool.query<{ result: { claimed: boolean; reason: string } }>(
      `SELECT claim_solo_turn_submission(
        $1, $2, $3, $4::uuid, 'text', false,
        'Recovered after stale finish', 'text', '{}'::jsonb, 10, '{}'::jsonb,
        '{"modeId":"text","elapsedSeconds":8,"modeWarnings":[],"speechTiming":null,"speechAnalysis":null,"speechQuality":null}'::jsonb,
        8, 300
      ) AS result`,
      [debateId, userId, turnId, submissionToken],
    );
    expect(turnClaim.rows[0].result).toMatchObject({ claimed: true, reason: "staged" });

    const debateState = await pool.query<{ finalization_token: string | null }>(
      "SELECT finalization_token::text FROM solo_debates WHERE id = $1",
      [debateId],
    );
    expect(debateState.rows[0].finalization_token).toBeNull();

    await pool.query(
      "SELECT release_solo_turn_submission($1, $2, $3, $4::uuid)",
      [debateId, userId, turnId, submissionToken],
    );
    await pool.query("DELETE FROM solo_debates WHERE id = $1", [debateId]);
  });

  it("recovers a stale finalization lease before restoring a timed window", async () => {
    const { debateId, turnId } = await createDebate();
    const finishToken = crypto.randomUUID();
    await pool.query(
      "SELECT claim_solo_debate_finalization($1, $2, $3::uuid, 300)",
      [debateId, userId, finishToken],
    );
    await pool.query(
      "UPDATE solo_debates SET finalization_started_at = clock_timestamp() - interval '301 seconds' WHERE id = $1",
      [debateId],
    );

    const window = await pool.query<{ result: { modeId: string; remainingSeconds: number } | null }>(
      "SELECT start_solo_turn_window($1, $2, $3, 'rapid-rebuttal', 60) AS result",
      [debateId, userId, turnId],
    );
    expect(window.rows[0].result?.modeId).toBe("rapid-rebuttal");
    expect(window.rows[0].result?.remainingSeconds).toBeGreaterThan(0);

    await pool.query("DELETE FROM solo_debates WHERE id = $1", [debateId]);
  });

  it("commits a staged response as the final answered round without creating another opponent turn", async () => {
    const { debateId, turnId } = await createDebate();
    await pool.query(
      "UPDATE solo_debate_turns SET user_message = 'Round 1 answer', turn_score = 20 WHERE id = $1",
      [turnId],
    );
    for (let round = 2; round <= 4; round++) {
      await pool.query(
        "INSERT INTO solo_debate_turns (debate_id, round_number, ai_message, user_message, turn_score) VALUES ($1, $2, $3, $4, 20)",
        [debateId, round, `Opponent ${round}`, `Answer ${round}`],
      );
    }
    const pending = await pool.query<{ id: string }>(
      "INSERT INTO solo_debate_turns (debate_id, round_number, ai_message) VALUES ($1, 5, 'Opponent 5') RETURNING id",
      [debateId],
    );
    await pool.query("UPDATE solo_debates SET round_count = 5 WHERE id = $1", [debateId]);

    const token = crypto.randomUUID();
    const staged = await pool.query<{ result: { claimed: boolean } }>(
      `SELECT claim_solo_turn_submission(
        $1, $2, $3, $4::uuid, 'text', false,
        'Saved round five', 'text', '{}'::jsonb, 30, '{}'::jsonb,
        '{"modeId":"text","elapsedSeconds":9,"modeWarnings":[],"speechTiming":null,"speechAnalysis":null,"speechQuality":null}'::jsonb,
        9, 300
      ) AS result`,
      [debateId, userId, pending.rows[0].id, token],
    );
    expect(staged.rows[0].result.claimed).toBe(true);
    await pool.query(
      "SELECT release_solo_turn_submission($1, $2, $3, $4::uuid)",
      [debateId, userId, pending.rows[0].id, token],
    );

    const committed = await pool.query<{ result: { saved: boolean; reason: string; completedTurn: { user_message: string } } }>(
      "SELECT commit_staged_solo_turn_for_finish($1, $2, $3, 5, 300) AS result",
      [debateId, userId, pending.rows[0].id],
    );
    expect(committed.rows[0].result).toMatchObject({ saved: true, reason: "saved-for-finish" });
    expect(committed.rows[0].result.completedTurn.user_message).toBe("Saved round five");

    const state = await pool.query<{ turns: string; round_count: number }>(
      `SELECT
         (SELECT count(*)::text FROM solo_debate_turns WHERE debate_id = $1) AS turns,
         round_count
       FROM solo_debates WHERE id = $1`,
      [debateId],
    );
    expect(Number(state.rows[0].turns)).toBe(5);
    expect(state.rows[0].round_count).toBe(5);

    const savedRoundEvent = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM product_events WHERE debate_id = $1 AND name = 'round_completed' AND round = 5",
      [debateId],
    );
    expect(savedRoundEvent.rows[0].count).toBe("1");

    const replayed = await pool.query<{ result: { saved: boolean; reason: string } }>(
      "SELECT commit_staged_solo_turn_for_finish($1, $2, $3, 5, 300) AS result",
      [debateId, userId, pending.rows[0].id],
    );
    expect(replayed.rows[0].result).toMatchObject({ saved: true, reason: "already-saved" });

    const savedRoundEventAfterReplay = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM product_events WHERE debate_id = $1 AND name = 'round_completed' AND round = 5",
      [debateId],
    );
    expect(savedRoundEventAfterReplay.rows[0].count).toBe("1");

    await pool.query("DELETE FROM solo_debates WHERE id = $1", [debateId]);
  });

  it("enforces one durable turn per debate round", async () => {
    const { debateId } = await createDebate();
    await expect(
      pool.query(
        "INSERT INTO solo_debate_turns (debate_id, round_number, ai_message) VALUES ($1, 1, 'Duplicate')",
        [debateId],
      ),
    ).rejects.toMatchObject({ code: "23505" });
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
