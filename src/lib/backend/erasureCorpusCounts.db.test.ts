import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { applyTestMigrations } from "../../../tests/helpers/applyTestMigrations";

/**
 * Account erasure keeps corpus counters honest (migration 051): every item
 * that loses the erased learner's rating is recounted, and an item closed at
 * the collection target that falls below it is reopened (an adjudicated one
 * keeps its adjudication only as stale provenance). No rating row is edited.
 */

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const d = databaseUrl ? describe : describe.skip;
const TARGET = 3;

let pool: pg.Pool;
const suffix = randomUUID().slice(0, 8);
const emails = [0, 1, 2, 3].map((i) => `erase-count-${i}-${suffix}@test.local`);
const ids: string[] = [];

async function createUser(email: string): Promise<string> {
  const row = await pool.query<{ id: string }>(
    `WITH u AS (INSERT INTO app_users (email, password_hash) VALUES ($1, 'test') RETURNING id)
     INSERT INTO profiles (id, username) SELECT id, $2 FROM u RETURNING id`,
    [email, email.split("@")[0]],
  );
  return row.rows[0].id;
}

/** An item contributed by `contributor`, rated by `raters`, with a consistent stored count. */
async function item(contributor: string, raters: string[], status: "open" | "rated" | "adjudicated"): Promise<string> {
  const row = await pool.query<{ id: string }>(
    `INSERT INTO corpus_items (transcript, source_type, contributor_id, length_bucket, ability_band, status, rating_count)
     VALUES ('t', 'solo', $1, 'short', 'novice', $2, $3) RETURNING id`,
    [contributor, status, raters.length],
  );
  for (const rater of raters) {
    await pool.query(
      `INSERT INTO corpus_ratings (corpus_id, rater_id, scores_a, scores_b, winner)
       VALUES ($1, $2, '{"claims": 1}'::jsonb, '{"claims": 1}'::jsonb, 'tie')`,
      [row.rows[0].id, rater],
    );
  }
  return row.rows[0].id;
}

const state = async (id: string) =>
  (await pool.query<{ rating_count: number; status: string; stale: boolean | null; actual: number }>(
    `SELECT rating_count, status, (side_mapping->>'adjudication_stale')::boolean AS stale,
            (SELECT count(*)::int FROM corpus_ratings WHERE corpus_id = $1) AS actual
       FROM corpus_items WHERE id = $1`,
    [id],
  )).rows[0];

d("Account erasure recounts corpus items (migration 051)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
    await applyTestMigrations(pool);
    for (const email of emails) ids.push(await createUser(email));
  });

  afterAll(async () => {
    const live = ids.slice(1);
    await pool.query("DELETE FROM corpus_ratings WHERE rater_id = ANY($1::uuid[])", [live]);
    await pool.query("DELETE FROM corpus_items WHERE contributor_id = ANY($1::uuid[])", [live]);
    await pool.query("DELETE FROM app_users WHERE email = ANY($1::text[])", [emails]);
    await pool.end();
  });

  it("recounts every item the learner rated and reopens the ones that fall below the target", async () => {
    const [victim, owner, r1, r2] = ids;
    const rated = await item(owner, [victim, r1, r2], "rated");
    const adjudicated = await item(owner, [victim, r1, r2], "adjudicated");
    const open = await item(owner, [victim, r1], "open");
    const untouched = await item(owner, [r1, r2], "open");
    const own = await item(victim, [r1], "open");

    const result = await pool.query<{ result: Record<string, unknown> }>("SELECT delete_app_account_v2($1, $2) AS result", [victim, TARGET]);
    expect(result.rows[0].result).toMatchObject({
      userDeleted: true,
      corpusRatingsDeleted: 3,
      corpusItemsDeleted: 1,
      corpusItemsRecounted: 3,
      corpusItemsReopened: 2,
    });

    expect(await state(rated)).toMatchObject({ rating_count: 2, actual: 2, status: "open" });
    expect(await state(adjudicated)).toMatchObject({ rating_count: 2, actual: 2, status: "open", stale: true });
    expect(await state(open)).toMatchObject({ rating_count: 1, actual: 1, status: "open" });
    expect(await state(untouched)).toMatchObject({ rating_count: 2, actual: 2, status: "open", stale: null });
    expect(await pool.query("SELECT 1 FROM corpus_items WHERE id = $1", [own]).then((r) => r.rowCount)).toBe(0);

    // No drift left anywhere this suite touched.
    const drift = await pool.query(
      `SELECT ci.id FROM corpus_items ci LEFT JOIN corpus_ratings cr ON cr.corpus_id = ci.id
        WHERE ci.contributor_id = ANY($1::uuid[]) GROUP BY ci.id HAVING ci.rating_count <> count(cr.id)`,
      [ids.slice(1)],
    );
    expect(drift.rowCount).toBe(0);
  });

  it("leaves an item that stays at the target closed", async () => {
    const [, owner, r1, r2] = ids;
    const extra = await createUser(`erase-count-extra-${suffix}@test.local`);
    emails.push(`erase-count-extra-${suffix}@test.local`);
    const leaver = await createUser(`erase-count-leaver-${suffix}@test.local`);
    emails.push(`erase-count-leaver-${suffix}@test.local`);
    const full = await item(owner, [leaver, r1, r2, extra], "rated");
    await pool.query("SELECT delete_app_account_v2($1, $2)", [leaver, TARGET]);
    expect(await state(full)).toMatchObject({ rating_count: 3, actual: 3, status: "rated" });
  });

  it("refuses a threshold below one", async () => {
    await expect(pool.query("SELECT delete_app_account_v2($1, 0)", [randomUUID()])).rejects.toThrow(/p_min_raters/);
  });
});
