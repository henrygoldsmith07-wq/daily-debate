import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

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

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../database/migrations", import.meta.url));

let pool: pg.Pool;

const userEmails = ["coach-a@test.local", "coach-b@test.local"];
const userIds = new Map<string, string>();

async function applyMigrations() {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    try {
      await pool.query(sql);
    } catch (err) {
      // Migrations are not idempotent across whole-file replays (CREATE TABLE
      // without IF NOT EXISTS in 001); tolerate "already exists" noise.
      const message = String(err);
      if (!/already exists|duplicate/i.test(message)) throw err;
    }
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
  const day = new Date().toISOString().slice(0, 10);
  const existing = await pool.query<{ id: string }>("SELECT id FROM daily_topics WHERE topic_date = $1", [day]);
  if (existing.rows.length) return existing.rows[0].id;
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO daily_topics (topic_date, title, prompt)
     VALUES ($1, 'Coach loop test topic', 'Used by dailyCoachLoop.db.test')
     RETURNING id`,
    [day],
  );
  return inserted.rows[0].id;
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
    expect(updated.rows[0].attempt_score).toBe(85);

    await pool.query("DELETE FROM drill_assignments WHERE id = $1", [assignment.rows[0].id]);
  });

  it("records product events with an allowlisted name only", async () => {
    const userId = userIds.get("coach-a@test.local")!;

    const event = await pool.query<{ name: string }>(
      `INSERT INTO product_events (user_id, name, format, side, round) VALUES ($1, 'sprint_started', 'sprint', 'for', 1) RETURNING name`,
      [userId],
    );
    expect(event.rows[0].name).toBe("sprint_started");

    await expect(
      pool.query(`INSERT INTO product_events (user_id, name) VALUES ($1, 'every_keystroke')`, [userId]),
    ).rejects.toThrow(/product_events_name_check|check constraint/i);

    await expect(
      pool.query(`INSERT INTO product_events (user_id, name) VALUES ($1, 'sprint_started', 'best-of-99')`, [userId]),
    ).rejects.toThrow(/product_events_format_check|check constraint/i);
  });

  it("keeps challenge invites unique by code and lifecycle-honest", async () => {
    const challengerId = userIds.get("coach-a@test.local")!;
    const opponentId = userIds.get("coach-b@test.local")!;
    const topicId = await todayTopicId();

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

    // Lifecycle: open → accepted (atomically claimed once).
    const claim = await pool.query<{ id: string }>(
      `UPDATE challenge_invites SET status = 'accepted', opponent_id = $2
       WHERE code = 'coach22x' AND status = 'open' RETURNING id`,
      [challengerId, opponentId],
    );
    expect(claim.rows.length).toBe(1);
    const claimAgain = await pool.query<{ id: string }>(
      `UPDATE challenge_invites SET status = 'accepted', opponent_id = $2
       WHERE code = 'coach22x' AND status = 'open' RETURNING id`,
      [challengerId, opponentId],
    );
    expect(claimAgain.rows.length).toBe(0);
  });
});
