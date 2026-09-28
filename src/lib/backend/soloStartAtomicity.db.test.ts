import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { applyTestMigrations } from "../../../tests/helpers/applyTestMigrations";

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const d = databaseUrl ? describe : describe.skip;
let pool: pg.Pool;
let userId = "";
let topicId = "";

async function clearStarts() {
  await pool.query("DELETE FROM solo_debate_start_claims WHERE user_id = $1 AND topic_id = $2", [userId, topicId]);
  await pool.query("DELETE FROM solo_debates WHERE user_id = $1 AND topic_id = $2", [userId, topicId]);
}

d("atomic solo debate start", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl });
    await applyTestMigrations(pool);

    const email = "solo-start-atomic@test.local";
    await pool.query("DELETE FROM app_users WHERE email = $1", [email]);
    const user = await pool.query<{ id: string }>(
      `WITH new_user AS (
         INSERT INTO app_users (email, password_hash) VALUES ($1, 'test') RETURNING id
       )
       INSERT INTO profiles (id, username, timezone, timezone_initialized_at)
       SELECT id, 'solo-start-atomic', 'Europe/London', now() FROM new_user
       RETURNING id`,
      [email],
    );
    userId = user.rows[0].id;

    const topic = await pool.query<{ id: string }>(
      `INSERT INTO daily_topics (topic_date, title, prompt)
       VALUES ((current_date + 31), 'Atomic start topic', 'Atomic start prompt')
       ON CONFLICT (topic_date) DO UPDATE SET title = EXCLUDED.title
       RETURNING id`,
    );
    topicId = topic.rows[0].id;
  });

  afterAll(async () => {
    await pool.query("DELETE FROM app_users WHERE id = $1", [userId]);
    await pool.end();
  });

  it("allows only one live start claim and lets a stale claim be reclaimed", async () => {
    await clearStarts();
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();

    const one = await pool.query<{ result: { claimed: boolean; reason: string } }>(
      "SELECT claim_solo_debate_start($1, $2, $3::uuid, 300) AS result",
      [userId, topicId, first],
    );
    expect(one.rows[0].result).toMatchObject({ claimed: true, reason: "claimed" });

    const concurrent = await pool.query<{ result: { claimed: boolean; reason: string } }>(
      "SELECT claim_solo_debate_start($1, $2, $3::uuid, 300) AS result",
      [userId, topicId, second],
    );
    expect(concurrent.rows[0].result).toMatchObject({ claimed: false, reason: "start-in-progress" });

    await pool.query(
      "UPDATE solo_debate_start_claims SET started_at = clock_timestamp() - interval '301 seconds' WHERE user_id = $1 AND topic_id = $2",
      [userId, topicId],
    );
    const reclaimed = await pool.query<{ result: { claimed: boolean; reason: string } }>(
      "SELECT claim_solo_debate_start($1, $2, $3::uuid, 300) AS result",
      [userId, topicId, second],
    );
    expect(reclaimed.rows[0].result).toMatchObject({ claimed: true, reason: "reclaimed" });

    const claim = await pool.query<{ token: string }>(
      "SELECT token::text FROM solo_debate_start_claims WHERE user_id = $1 AND topic_id = $2",
      [userId, topicId],
    );
    expect(claim.rows[0].token).toBe(second);

    await clearStarts();
  });

  it("atomically creates debate, opening turn and exactly-once start analytics", async () => {
    await clearStarts();
    const token = crypto.randomUUID();
    const claim = await pool.query<{ result: { claimed: boolean } }>(
      "SELECT claim_solo_debate_start($1, $2, $3::uuid, 300) AS result",
      [userId, topicId, token],
    );
    expect(claim.rows[0].result.claimed).toBe(true);

    const complete = await pool.query<{
      result: {
        ok: boolean;
        reason: string;
        debate: { id: string; side: string; format: string };
        turn: { id: string; debate_id: string; round_number: number; ai_message: string };
      };
    }>(
      `SELECT complete_solo_debate_start(
        $1, $2, $3::uuid, 'for', 'sprint',
        '{"dimension":"evidence","sideReason":"test"}'::jsonb,
        'Atomic opening', 'side-balance', NULL::uuid, NULL::uuid, NULL
      ) AS result`,
      [userId, topicId, token],
    );

    expect(complete.rows[0].result).toMatchObject({ ok: true, reason: "created" });
    const debateId = complete.rows[0].result.debate.id;
    expect(complete.rows[0].result.turn).toMatchObject({
      debate_id: debateId,
      round_number: 1,
      ai_message: "Atomic opening",
    });

    const counts = await pool.query<{ debates: string; turns: string; events: string; claims: string }>(
      `SELECT
         (SELECT count(*)::text FROM solo_debates WHERE user_id = $1 AND topic_id = $2 AND status = 'active') AS debates,
         (SELECT count(*)::text FROM solo_debate_turns WHERE debate_id = $3) AS turns,
         (SELECT count(*)::text FROM product_events WHERE debate_id = $3 AND name IN ('sprint_started','challenge_me_selected')) AS events,
         (SELECT count(*)::text FROM solo_debate_start_claims WHERE user_id = $1 AND topic_id = $2) AS claims`,
      [userId, topicId, debateId],
    );
    expect(counts.rows[0]).toEqual({ debates: "1", turns: "1", events: "2", claims: "0" });

    // Lost-response retry: even though the claim is gone, the canonical
    // completed start is replayed and analytics remain exactly once.
    const replay = await pool.query<{ result: { ok: boolean; reason: string; debate: { id: string } } }>(
      `SELECT complete_solo_debate_start(
        $1, $2, $3::uuid, 'against', 'full', '{}'::jsonb,
        'Different opening that must not replace canonical state',
        NULL, NULL::uuid, NULL::uuid, NULL
      ) AS result`,
      [userId, topicId, token],
    );
    expect(replay.rows[0].result).toMatchObject({
      ok: true,
      reason: "existing-debate",
      debate: { id: debateId },
    });
    const eventsAfterReplay = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM product_events WHERE debate_id = $1 AND name IN ('sprint_started','challenge_me_selected')",
      [debateId],
    );
    expect(eventsAfterReplay.rows[0].count).toBe("2");

    await clearStarts();
  });

  it("repairs a legacy zero-turn orphan instead of leaving an unusable active debate", async () => {
    await clearStarts();
    const orphan = await pool.query<{ id: string }>(
      `INSERT INTO solo_debates (user_id, topic_id, side, format, round_count, coaching)
       VALUES ($1, $2, 'against', 'full', 1, '{}'::jsonb)
       RETURNING id`,
      [userId, topicId],
    );

    const token = crypto.randomUUID();
    const claim = await pool.query<{ result: { claimed: boolean } }>(
      "SELECT claim_solo_debate_start($1, $2, $3::uuid, 300) AS result",
      [userId, topicId, token],
    );
    expect(claim.rows[0].result.claimed).toBe(true);

    const recovered = await pool.query<{ result: { ok: boolean; reason: string; debate: { id: string; side: string; format: string } } }>(
      `SELECT complete_solo_debate_start(
        $1, $2, $3::uuid, 'for', 'sprint', '{}'::jsonb,
        'Recovered opening', NULL, NULL::uuid, NULL::uuid, NULL
      ) AS result`,
      [userId, topicId, token],
    );
    expect(recovered.rows[0].result).toMatchObject({
      ok: true,
      reason: "recovered-orphan",
      debate: { id: orphan.rows[0].id, side: "for", format: "sprint" },
    });

    const turns = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM solo_debate_turns WHERE debate_id = $1",
      [orphan.rows[0].id],
    );
    expect(turns.rows[0].count).toBe("1");

    await clearStarts();
  });

  it("enforces one active solo debate per user and topic in storage", async () => {
    await clearStarts();
    await pool.query(
      "INSERT INTO solo_debates (user_id, topic_id, side, format, round_count) VALUES ($1, $2, 'for', 'sprint', 1)",
      [userId, topicId],
    );
    await expect(
      pool.query(
        "INSERT INTO solo_debates (user_id, topic_id, side, format, round_count) VALUES ($1, $2, 'against', 'full', 1)",
        [userId, topicId],
      ),
    ).rejects.toMatchObject({ code: "23505" });

    await clearStarts();
  });
});
