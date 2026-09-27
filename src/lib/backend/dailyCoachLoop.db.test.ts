import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { applyTestMigrations } from "../../../tests/helpers/applyTestMigrations";
import { normalizeNumerics } from "@/lib/backend/sql";

/**
 * Integration tests for the daily coaching loop schema (migration 004):
 * Sprint format on solo_debates, repair outcome persistence, the repair →
 * drill-assignment link, product events, and challenge invites.
 *
 * Runs only when TEST_DATABASE_URL points at a disposable Postgres (CI
 * provisions an ephemeral container); skipped otherwise.
 */

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const d = databaseUrl ? describe : describe.skip;

let pool: pg.Pool;

const userEmails = ["coach-a@test.local", "coach-b@test.local"];
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
     VALUES ($1, 'Coach loop test topic', 'Used by dailyCoachLoop.db.test')
     ON CONFLICT (topic_date) DO NOTHING`,
    [day],
  );
  const existing = await pool.query<{ id: string }>("SELECT id FROM daily_topics WHERE topic_date = $1", [day]);
  return existing.rows[0].id;
}

d("daily coach loop schema", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl });
    await applyMigrations();
    for (const email of userEmails) {
      userIds.set(email, await ensureUser(email));
    }
  });

  afterAll(async () => {
    // Cascade cleanup via user delete keeps every child table tidy.
    for (const email of userEmails) {
      await pool.query("DELETE FROM app_users WHERE email = $1", [email]);
    }
    await pool.end();
  });

  it("stores sprint format and the coaching snapshot on solo_debates", async () => {
    const userId = userIds.get("coach-a@test.local")!;
    const topicId = await todayTopicId();

    const insert = await pool.query<{ id: string; format: string; coaching: unknown }>(
      `INSERT INTO solo_debates (user_id, topic_id, side, format, coaching)
       VALUES ($1, $2, 'for', 'sprint', $3) RETURNING id, format, coaching`,
      [userId, topicId, JSON.stringify({ dimension: "rebuttal", sideReason: null })],
    );
    expect(insert.rows[0].format).toBe("sprint");
    expect((insert.rows[0].coaching as { dimension?: string }).dimension).toBe("rebuttal");

    // Legacy rows keep the full default.
    const legacy = await pool.query<{ format: string }>(
      `INSERT INTO solo_debates (user_id, topic_id, side) VALUES ($1, $2, 'against') RETURNING format`,
      [userId, topicId],
    );
    expect(legacy.rows[0].format).toBe("full");

    // Invalid formats are rejected by the check constraint.
    await expect(
      pool.query(`INSERT INTO solo_debates (user_id, topic_id, side, format) VALUES ($1, $2, 'for', 'elo')`, [userId, topicId]),
    ).rejects.toThrow(/solo_debates_format_check|check constraint/i);

    await pool.query("DELETE FROM solo_debates WHERE user_id = $1", [userId]);
  });

  it("persists repair outcomes and enforces their constraints", async () => {
    const userId = userIds.get("coach-a@test.local")!;
    const topicId = await todayTopicId();
    const debate = await pool.query<{ id: string }>(
      `INSERT INTO solo_debates (user_id, topic_id, side, status, format) VALUES ($1, $2, 'for', 'completed', 'sprint') RETURNING id`,
      [userId, topicId],
    );
    const debateId = debate.rows[0].id;

    const repair = await pool.query<{ id: string; succeeded: boolean; score: number }>(
      `INSERT INTO repair_results (user_id, debate_id, target_kind, source_text, rewrite_text, score, succeeded, signals)
       VALUES ($1, $2, 'evidence', 'claim without a source', 'According to NREL data, the claim holds.', 85, true, '["names evidence or a source"]'::jsonb)
       RETURNING id, succeeded, score`,
      [userId, debateId],
    );
    expect(repair.rows[0].succeeded).toBe(true);
    expect(repair.rows[0].score).toBe(85);

    await expect(
      pool.query(
        `INSERT INTO repair_results (user_id, debate_id, target_kind, source_text, rewrite_text, score, succeeded)
         VALUES ($1, $2, 'evidence', 's', 'r', 150, true)`,
        [userId, debateId],
      ),
    ).rejects.toThrow(/repair_results_score_check|check constraint/i);

    await expect(
      pool.query(
        `INSERT INTO repair_results (user_id, debate_id, target_kind, source_text, rewrite_text, score, succeeded)
         VALUES ($1, $2, 'vibes', 's', 'r', 50, true)`,
        [userId, debateId],
      ),
    ).rejects.toThrow(/repair_results_target_kind_check|check constraint/i);

    await pool.query("DELETE FROM solo_debates WHERE id = $1", [debateId]);
  });

  it("links a completed repair to the open drill assignment (next coaching focus input)", async () => {
    const userId = userIds.get("coach-a@test.local")!;
    const today = new Date().toISOString().slice(0, 10);
    // Guard the unique (user_id, assigned_date) constraint against leftovers
    // from an interrupted run.
    await pool.query("DELETE FROM drill_assignments WHERE user_id = $1", [userId]);

    const assignment = await pool.query<{ id: string; status: string }>(
      `INSERT INTO drill_assignments (user_id, dimension, minutes, title, prompt, assigned_date, status)
       VALUES ($1, 'evidence', 2, 'Ground one claim', 'Cite a real institution.', $2, 'open')
       RETURNING id, status`,
      [userId, today],
    );
    expect(assignment.rows[0].status).toBe("open");

    // This is exactly the update the repair route performs.
    await pool.query(
      `UPDATE drill_assignments
       SET status = 'attempted', attempt_text = $2, attempt_score = $3
       WHERE user_id = $1 AND assigned_date = $4 AND dimension = 'evidence' AND status = 'open'`,
      [userId, "According to Pew data, the trend holds.", 85, today],
    );

    const updated = await pool.query<{ status: string; attempt_score: number }>(
      "SELECT status, attempt_score FROM drill_assignments WHERE id = $1",
      [assignment.rows[0].id],
    );
    expect(updated.rows[0].status).toBe("attempted");
    // numeric columns arrive as strings from node-postgres; the app boundary
    // (backend/sql.ts normalizeNumerics) converts them — assert through it.
    const normalised = normalizeNumerics({ ...updated.rows[0] });
    expect(typeof normalised.attempt_score).toBe("number");
    expect(normalised.attempt_score).toBe(85);

    await pool.query("DELETE FROM drill_assignments WHERE id = $1", [assignment.rows[0].id]);
  });

  it("stores jsonb arrays as JSON arrays, not Postgres array literals", async () => {
    // Regression: node-postgres serialises a JS [] as the Postgres array
    // literal '{}', which jsonb then stores as an empty OBJECT — crashing
    // consumers that call .map() on the column (daily_topics.sources).
    // The fix JSON-encodes arrays/objects at the query-builder boundary; this
    // test verifies the stored shape end-to-end through node-postgres.
    const topicId = await todayTopicId();

    // Same binding path as the query builder: parameter passes through pg.
    await pool.query(
      `UPDATE daily_topics SET sources = $1::jsonb WHERE id = $2`,
      [JSON.stringify([{ name: "Pew", homepage: "https://www.pewresearch.org", angle: "polling" }]), topicId],
    );
    const row = await pool.query<{ sources: unknown }>("SELECT sources FROM daily_topics WHERE id = $1", [topicId]);
    expect(Array.isArray(row.rows[0].sources)).toBe(true);

    // And the empty-array case that originally corrupted rows.
    await pool.query(`UPDATE daily_topics SET sources = $1::jsonb WHERE id = $2`, [JSON.stringify([]), topicId]);
    const empty = await pool.query<{ sources: unknown }>("SELECT sources FROM daily_topics WHERE id = $1", [topicId]);
    expect(Array.isArray(empty.rows[0].sources)).toBe(true);
    expect(empty.rows[0].sources).toEqual([]);
  });

  it("records product events with an allowlisted name only", async () => {
    const userId = userIds.get("coach-a@test.local")!;

    const debate = await pool.query<{ id: string }>(
      `INSERT INTO solo_debates (user_id, topic_id, side, format) VALUES ($1, $2, 'for', 'sprint') RETURNING id`,
      [userId, await todayTopicId()],
    );
    const debateId = debate.rows[0].id;

    const event = await pool.query<{ name: string; debate_id: string | null }>(
      `INSERT INTO product_events (user_id, name, format, side, round, debate_id) VALUES ($1, 'sprint_started', 'sprint', 'for', 1, $2) RETURNING name, debate_id`,
      [userId, debateId],
    );
    expect(event.rows[0].name).toBe("sprint_started");
    // Session identifier round-trips for session-level funnel measurement.
    expect(event.rows[0].debate_id).toBe(debateId);

    // Legacy-shaped rows without a session id are still valid (migration 005
    // adds the column nullable).
    const legacy = await pool.query<{ debate_id: string | null }>(
      `INSERT INTO product_events (user_id, name) VALUES ($1, 'progress_viewed') RETURNING debate_id`,
      [userId],
    );
    expect(legacy.rows[0].debate_id).toBeNull();

    await expect(
      pool.query(`INSERT INTO product_events (user_id, name) VALUES ($1, 'every_keystroke')`, [userId]),
    ).rejects.toThrow(/product_events_name_check|check constraint/i);

    await expect(
      pool.query(`INSERT INTO product_events (user_id, name, format) VALUES ($1, 'sprint_started', 'best-of-99')`, [userId]),
    ).rejects.toThrow(/product_events_format_check|check constraint/i);

    await pool.query(
      `INSERT INTO product_events (user_id, name, reason) VALUES ($1, 'challenge_me_selected', 'side-balance')`,
      [userId],
    );
    await expect(
      pool.query(
        `INSERT INTO product_events (user_id, name, reason) VALUES ($1, 'challenge_me_selected', 'free text about the user')`,
        [userId],
      ),
    ).rejects.toThrow(/product_events_reason_check|check constraint/i);

    await pool.query("DELETE FROM solo_debates WHERE id = $1", [debateId]);
  });

  it("persists durable repair-retest assignments and enforces assignment integrity", async () => {
    const userId = userIds.get("coach-a@test.local")!;
    const topicId = await todayTopicId();
    const repairedDebate = await pool.query<{ id: string }>(
      `INSERT INTO solo_debates (user_id, topic_id, side, status, format)
       VALUES ($1, $2, 'for', 'completed', 'sprint') RETURNING id`,
      [userId, topicId],
    );
    const repair = await pool.query<{ id: string }>(
      `INSERT INTO repair_results (
         user_id, debate_id, target_kind, source_text, rewrite_text, score, succeeded
       ) VALUES ($1, $2, 'evidence', 'unsupported claim', 'According to ONS data...', 90, true)
       RETURNING id`,
      [userId, repairedDebate.rows[0].id],
    );
    const otherRepair = await pool.query<{ id: string }>(
      `INSERT INTO repair_results (
         user_id, debate_id, target_kind, source_text, rewrite_text, score, succeeded
       ) VALUES ($1, $2, 'logic', 'weak inference', 'Because the mechanism is...', 90, true)
       RETURNING id`,
      [userId, repairedDebate.rows[0].id],
    );
    const firstAssigned = await pool.query<{ id: string }>(
      `INSERT INTO solo_debates (user_id, topic_id, side, format)
       VALUES ($1, $2, 'against', 'sprint') RETURNING id`,
      [userId, topicId],
    );
    const secondAssigned = await pool.query<{ id: string }>(
      `INSERT INTO solo_debates (user_id, topic_id, side, format)
       VALUES ($1, $2, 'for', 'sprint') RETURNING id`,
      [userId, topicId],
    );

    await pool.query(
      `INSERT INTO repair_retests (
         repair_result_id, user_id, repair_debate_id, target_kind, assigned_debate_id
       ) VALUES ($1, $2, $3, 'evidence', $4)`,
      [repair.rows[0].id, userId, repairedDebate.rows[0].id, firstAssigned.rows[0].id],
    );

    await expect(
      pool.query(
        `INSERT INTO repair_retests (
           repair_result_id, user_id, repair_debate_id, target_kind, assigned_debate_id
         ) VALUES ($1, $2, $3, 'evidence', $4)`,
        [repair.rows[0].id, userId, repairedDebate.rows[0].id, secondAssigned.rows[0].id],
      ),
    ).rejects.toThrow(/repair_retests_one_open_per_repair|unique constraint/i);

    // A completed but unobservable assignment does not prove transfer and must
    // release the repair for a later deliberate test.
    await pool.query(
      `UPDATE repair_retests
       SET completed_at = now(), observable = false, demonstrated = null
       WHERE repair_result_id = $1 AND assigned_debate_id = $2`,
      [repair.rows[0].id, firstAssigned.rows[0].id],
    );
    const secondRetest = await pool.query<{ id: string }>(
      `INSERT INTO repair_retests (
         repair_result_id, user_id, repair_debate_id, target_kind, assigned_debate_id
       ) VALUES ($1, $2, $3, 'evidence', $4) RETURNING id`,
      [repair.rows[0].id, userId, repairedDebate.rows[0].id, secondAssigned.rows[0].id],
    );
    expect(secondRetest.rows).toHaveLength(1);

    await expect(
      pool.query(
        `INSERT INTO repair_retests (
           repair_result_id, user_id, repair_debate_id, target_kind, assigned_debate_id
         ) VALUES ($1, $2, $3, 'logic', $4)`,
        [otherRepair.rows[0].id, userId, repairedDebate.rows[0].id, secondAssigned.rows[0].id],
      ),
    ).rejects.toThrow(/repair_retests_assigned_debate_unique|unique constraint/i);

    await expect(
      pool.query(
        `UPDATE repair_retests
         SET completed_at = now(), observable = false, demonstrated = true
         WHERE id = $1`,
        [secondRetest.rows[0].id],
      ),
    ).rejects.toThrow(/check constraint/i);

    await pool.query("DELETE FROM solo_debates WHERE id = ANY($1::uuid[])", [
      [repairedDebate.rows[0].id, firstAssigned.rows[0].id, secondAssigned.rows[0].id],
    ]);
  });

  it("finalizes a solo debate atomically and only awards profile progress once", async () => {
    const userId = userIds.get("coach-a@test.local")!;
    const topicId = await todayTopicId();
    await pool.query(
      `UPDATE profiles
       SET total_points = 0, level = 1, current_streak = 0, longest_streak = 0, last_activity_date = null
       WHERE id = $1`,
      [userId],
    );

    const debate = await pool.query<{ id: string }>(
      `INSERT INTO solo_debates (user_id, topic_id, side, format, coaching)
       VALUES ($1, $2, 'for', 'sprint', '{"dimension":"rebuttal"}'::jsonb)
       RETURNING id`,
      [userId, topicId],
    );
    const debateId = debate.rows[0].id;
    const token = randomUUID();
    const secondToken = randomUUID();

    const firstClaim = await pool.query<{ claimed: boolean }>(
      "SELECT claim_solo_debate_finalization($1, $2, $3, 180) AS claimed",
      [debateId, userId, token],
    );
    expect(firstClaim.rows[0].claimed).toBe(true);

    const competingClaim = await pool.query<{ claimed: boolean }>(
      "SELECT claim_solo_debate_finalization($1, $2, $3, 180) AS claimed",
      [debateId, userId, secondToken],
    );
    expect(competingClaim.rows[0].claimed).toBe(false);

    const today = new Date().toISOString().slice(0, 10);
    const completedAt = new Date().toISOString();
    const payload = { totalScore: 40, bonusXP: 10, format: "sprint", summary: { overallFeedback: "ok", strengths: [], improvements: [] } };
    const finalized = await pool.query<{ finalized: boolean }>(
      `SELECT finalize_solo_debate(
        $1, $2, $3, 40, 10, 500, $4::date, $5::timestamptz,
        '{"dimension":"rebuttal","demonstrated":true}'::jsonb,
        $6::jsonb, false, null::uuid, false, null::boolean
      ) AS finalized`,
      [debateId, userId, token, today, completedAt, JSON.stringify(payload)],
    );
    expect(finalized.rows[0].finalized).toBe(true);

    const stored = await pool.query<{
      status: string;
      total_score: number;
      result_payload: { totalScore?: number } | null;
      finalization_token: string | null;
    }>(
      "SELECT status, total_score, result_payload, finalization_token FROM solo_debates WHERE id = $1",
      [debateId],
    );
    expect(stored.rows[0].status).toBe("completed");
    expect(stored.rows[0].total_score).toBe(40);
    expect(stored.rows[0].result_payload?.totalScore).toBe(40);
    expect(stored.rows[0].finalization_token).toBeNull();

    const profile = await pool.query<{ total_points: number; level: number; current_streak: number }>(
      "SELECT total_points, level, current_streak FROM profiles WHERE id = $1",
      [userId],
    );
    expect(profile.rows[0].total_points).toBe(50);
    expect(profile.rows[0].level).toBe(1);
    expect(profile.rows[0].current_streak).toBe(1);

    const finalizeAgain = await pool.query<{ finalized: boolean }>(
      `SELECT finalize_solo_debate(
        $1, $2, $3, 40, 10, 500, $4::date, $5::timestamptz,
        '{}'::jsonb, $6::jsonb, false, null::uuid, false, null::boolean
      ) AS finalized`,
      [debateId, userId, token, today, completedAt, JSON.stringify(payload)],
    );
    expect(finalizeAgain.rows[0].finalized).toBe(false);
    const profileAfterRetry = await pool.query<{ total_points: number }>(
      "SELECT total_points FROM profiles WHERE id = $1",
      [userId],
    );
    expect(profileAfterRetry.rows[0].total_points).toBe(50);

    await pool.query("DELETE FROM solo_debates WHERE id = $1", [debateId]);
  });

  it("commits a repair-retest outcome in the same finalization transaction", async () => {
    const userId = userIds.get("coach-b@test.local")!;
    const topicId = await todayTopicId();
    const sourceDebate = await pool.query<{ id: string }>(
      `INSERT INTO solo_debates (user_id, topic_id, side, status, format, completed_at)
       VALUES ($1, $2, 'against', 'completed', 'sprint', now()) RETURNING id`,
      [userId, topicId],
    );
    const repair = await pool.query<{ id: string }>(
      `INSERT INTO repair_results (
         user_id, debate_id, target_kind, source_text, rewrite_text, score, succeeded
       ) VALUES ($1, $2, 'rebuttal', 'old response', 'better response', 90, true)
       RETURNING id`,
      [userId, sourceDebate.rows[0].id],
    );
    const assigned = await pool.query<{ id: string }>(
      `INSERT INTO solo_debates (user_id, topic_id, side, format, coaching)
       VALUES ($1, $2, 'for', 'sprint', $3::jsonb) RETURNING id`,
      [
        userId,
        topicId,
        JSON.stringify({
          dimension: "rebuttal",
          repairRetest: {
            repairResultId: repair.rows[0].id,
            repairDebateId: sourceDebate.rows[0].id,
            targetKind: "rebuttal",
            attemptedAt: new Date().toISOString(),
          },
        }),
      ],
    );
    await pool.query(
      `INSERT INTO repair_retests (
         repair_result_id, user_id, repair_debate_id, target_kind, assigned_debate_id
       ) VALUES ($1, $2, $3, 'rebuttal', $4)`,
      [repair.rows[0].id, userId, sourceDebate.rows[0].id, assigned.rows[0].id],
    );

    const token = randomUUID();
    const claim = await pool.query<{ claimed: boolean }>(
      "SELECT claim_solo_debate_finalization($1, $2, $3, 180) AS claimed",
      [assigned.rows[0].id, userId, token],
    );
    expect(claim.rows[0].claimed).toBe(true);

    const today = new Date().toISOString().slice(0, 10);
    const completedAt = new Date().toISOString();
    const finalized = await pool.query<{ finalized: boolean }>(
      `SELECT finalize_solo_debate(
        $1, $2, $3, 10, 0, 500, $4::date, $5::timestamptz,
        '{}'::jsonb, '{}'::jsonb, true, $6::uuid, true, true
      ) AS finalized`,
      [assigned.rows[0].id, userId, token, today, completedAt, repair.rows[0].id],
    );
    expect(finalized.rows[0].finalized).toBe(true);

    const retest = await pool.query<{ completed_at: Date | null; observable: boolean | null; demonstrated: boolean | null }>(
      "SELECT completed_at, observable, demonstrated FROM repair_retests WHERE assigned_debate_id = $1",
      [assigned.rows[0].id],
    );
    expect(retest.rows[0].completed_at).not.toBeNull();
    expect(retest.rows[0].observable).toBe(true);
    expect(retest.rows[0].demonstrated).toBe(true);

    await pool.query("DELETE FROM solo_debates WHERE id = ANY($1::uuid[])", [
      [sourceDebate.rows[0].id, assigned.rows[0].id],
    ]);
  });

  it("keeps challenge invites unique by code and lifecycle-honest", async () => {
    const challengerId = userIds.get("coach-a@test.local")!;
    const opponentId = userIds.get("coach-b@test.local")!;
    const topicId = await todayTopicId();
    await pool.query("DELETE FROM challenge_invites WHERE code = 'coach22x'");

    const invite = await pool.query<{ code: string }>(
      `INSERT INTO challenge_invites (code, challenger_id, topic_id, challenger_side, expires_at)
       VALUES ('coach22x', $1, $2, 'for', now() + interval '7 days') RETURNING code`,
      [challengerId, topicId],
    );
    expect(invite.rows[0].code).toBe("coach22x");

    // Codes are unique.
    await expect(
      pool.query(
        `INSERT INTO challenge_invites (code, challenger_id, topic_id, challenger_side, expires_at)
         VALUES ('coach22x', $1, $2, 'against', now() + interval '7 days')`,
        [opponentId, topicId],
      ),
    ).rejects.toThrow(/duplicate key|unique constraint/i);

    // Lifecycle: open → accepted (atomically claimed once). Both parameters
    // are used ($1 selects nothing — covering the unused-parameter class of
    // bug that previously made this statement fail type inference).
    const claim = await pool.query<{ id: string }>(
      `UPDATE challenge_invites SET status = 'accepted', opponent_id = $1
       WHERE code = 'coach22x' AND status = 'open' RETURNING id`,
      [opponentId],
    );
    expect(claim.rows.length).toBe(1);
    const claimAgain = await pool.query<{ id: string }>(
      `UPDATE challenge_invites SET status = 'accepted', opponent_id = $1
       WHERE code = 'coach22x' AND status = 'open' RETURNING id`,
      [opponentId],
    );
    expect(claimAgain.rows.length).toBe(0);
  });
});
