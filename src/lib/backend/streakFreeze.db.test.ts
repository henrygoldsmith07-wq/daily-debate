import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import pg from "pg";
import { applyTestMigrations } from "../../../tests/helpers/applyTestMigrations";
import { updateStreak } from "../gamification";

/**
 * Streak freeze (migration 048), against real Postgres. The trigger is the
 * only place the freeze is applied, so these tests drive it the way every
 * streak writer does: compute "a gap means 1" and update the profile.
 */

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const d = databaseUrl ? describe : describe.skip;

let pool: pg.Pool;
let userId: string;
const EMAIL = "streak-freeze@test.local";

interface StreakRow {
  current_streak: number;
  longest_streak: number;
  last_activity_date: string;
  streak_freeze_used_on: string | null;
}

async function seed(state: { streak: number; longest?: number; last: string; usedOn?: string | null }) {
  await pool.query("DELETE FROM streak_freeze_uses WHERE user_id = $1", [userId]);
  // Through NULL first: the trigger ignores a change from no last day, so
  // seeding never trips the gap rule itself.
  await pool.query(
    "UPDATE profiles SET current_streak = $2, longest_streak = $3, last_activity_date = NULL, streak_freeze_used_on = $4 WHERE id = $1",
    [userId, state.streak, state.longest ?? state.streak, state.usedOn ?? null],
  );
  await pool.query("UPDATE profiles SET last_activity_date = $2 WHERE id = $1", [userId, state.last]);
}

/** Practise on `today` the way the writers do: read, compute with the gap rule, write. */
async function practise(today: string): Promise<StreakRow> {
  const before = (await pool.query<StreakRow>(
    "SELECT current_streak, longest_streak, last_activity_date::text AS last_activity_date FROM profiles WHERE id = $1",
    [userId],
  )).rows[0];
  const next = updateStreak(today, before.last_activity_date, before.current_streak, before.longest_streak);
  const row = await pool.query<StreakRow>(
    `UPDATE profiles SET current_streak = $2, longest_streak = $3, last_activity_date = $4 WHERE id = $1
     RETURNING current_streak, longest_streak, last_activity_date::text AS last_activity_date, streak_freeze_used_on::text AS streak_freeze_used_on`,
    [userId, next.current_streak, next.longest_streak, next.last_activity_date],
  );
  return row.rows[0];
}

const uses = async () =>
  (await pool.query<{ frozen_day: string; streak_kept: number }>(
    "SELECT frozen_day::text AS frozen_day, streak_kept FROM streak_freeze_uses WHERE user_id = $1 ORDER BY frozen_day",
    [userId],
  )).rows;

d("Streak freeze (migration 048)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
    await applyTestMigrations(pool);
    const existing = await pool.query<{ id: string }>("SELECT id FROM app_users WHERE email = $1", [EMAIL]);
    userId = existing.rows[0]?.id
      ?? (await pool.query<{ id: string }>(
        `WITH new_user AS (INSERT INTO app_users (email, password_hash) VALUES ($1, 'test') RETURNING id)
         INSERT INTO profiles (id, username) SELECT id, 'streak-freeze' FROM new_user RETURNING id`,
        [EMAIL],
      )).rows[0].id;
  });

  beforeEach(() => seed({ streak: 5, last: "2026-03-10" }));

  afterAll(async () => {
    await pool.query("DELETE FROM app_users WHERE email = $1", [EMAIL]);
    await pool.end();
  });

  it("carries a streak over one missed day, without counting the missed day", async () => {
    expect(await practise("2026-03-12")).toEqual({
      current_streak: 6,
      longest_streak: 6,
      last_activity_date: "2026-03-12",
      streak_freeze_used_on: "2026-03-11",
    });
    expect(await uses()).toEqual([{ frozen_day: "2026-03-11", streak_kept: 5 }]);
  });

  it("still ends the streak after two missed days", async () => {
    expect((await practise("2026-03-13")).current_streak).toBe(1);
    expect(await uses()).toEqual([]);
  });

  it("leaves consecutive and same-day practice alone", async () => {
    expect((await practise("2026-03-11")).current_streak).toBe(6);
    expect((await practise("2026-03-11")).current_streak).toBe(6);
    expect(await uses()).toEqual([]);
  });

  it("allows one freeze per seven days", async () => {
    // Frozen 2026-03-04; the next missed day it may cover is 2026-03-11.
    await seed({ streak: 5, last: "2026-03-09", usedOn: "2026-03-04" });
    expect((await practise("2026-03-11")).current_streak).toBe(1);

    await seed({ streak: 5, last: "2026-03-10", usedOn: "2026-03-04" });
    const row = await practise("2026-03-12");
    expect(row.current_streak).toBe(6);
    expect(row.streak_freeze_used_on).toBe("2026-03-11");
  });

  it("does nothing for a learner with no streak to keep", async () => {
    await seed({ streak: 0, last: "2026-03-10" });
    expect((await practise("2026-03-12")).current_streak).toBe(1);
    expect(await uses()).toEqual([]);
  });

  it("keeps the longest streak when the frozen streak is shorter", async () => {
    await seed({ streak: 3, longest: 20, last: "2026-03-10" });
    const row = await practise("2026-03-12");
    expect(row).toMatchObject({ current_streak: 4, longest_streak: 20 });
  });

  it("removes freeze history with the profile", async () => {
    const fk = await pool.query(
      `SELECT confdeltype FROM pg_constraint WHERE conrelid = 'streak_freeze_uses'::regclass AND contype = 'f'`,
    );
    expect(fk.rows.map((r) => r.confdeltype)).toEqual(["c"]);
  });
});
