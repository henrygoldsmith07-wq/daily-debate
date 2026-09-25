import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { applyTestMigrations } from "../../tests/helpers/applyTestMigrations";
import { findCandidates, repairItemWithLock } from "../../scripts/lib/corpus-repair.mjs";
import { insertImmutableRating } from "@/lib/corpusRatingStore";
import { MIN_RATERS_PER_ITEM } from "@/lib/corpus";

/**
 * REAL-POSTGRES tests for the lock-safe corpus repair path
 * (scripts/lib/corpus-repair.mjs). Proves: drift-only fixes, threshold
 * closure, no-op on correct items and second runs, dry-run purity, and the
 * two races that motivated the rewrite - a rating landing between the scan
 * and the locked recount, and a final threshold rating racing the repair
 * transaction itself.
 *
 * Runs only with TEST_DATABASE_URL + DATABASE_URL (CI e2e provisions both
 * against the same ephemeral Postgres); skipped otherwise.
 */

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const d = databaseUrl && process.env.DATABASE_URL?.trim() ? describe : describe.skip;


let pool: pg.Pool;
const emails = ["rp-a@test.local", "rp-b@test.local", "rp-contrib@test.local"];
const userIds = new Map<string, string>();
const itemIds: string[] = [];

function applyMigrations(): Promise<void> {
  // Shared helper: single session-scoped advisory lock, DDL on the SAME client,
  // one shared key across all *.db.test.ts suites (prevents the concurrent
  // catalog-replay race — XX000 tuple concurrently updated — seen in e2e).
  return applyTestMigrations(pool);
}

async function ensureUser(email: string): Promise<string> {
  const inserted = await pool.query<{ id: string }>(
    `WITH new_user AS (
       INSERT INTO app_users (email, password_hash) VALUES ($1, 'test')
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id
     )
     INSERT INTO profiles (id, username) SELECT id, $2 FROM new_user
     ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username
     RETURNING id`,
    [email, email.split("@")[0]],
  );
  return inserted.rows[0].id;
}

async function makeItem(): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO corpus_items (transcript, topic, source_type, contributor_id, length_bucket, ability_band)
     VALUES ('Side A (round 1): a.\nSide B (round 1): b.\nSide A (round 2): c.\nSide B (round 2): d.',
             'Repair test topic', 'solo', $1, 'medium', 'intermediate')
     RETURNING id`,
    [userIds.get("rp-contrib@test.local")],
  );
  itemIds.push(res.rows[0].id);
  return res.rows[0].id;
}

/** Bypass the store entirely (raw insert) to hand-craft legacy drift. */
async function rawRating(corpusId: string, raterId: string, winner = "a") {
  await pool.query(
    `INSERT INTO corpus_ratings (corpus_id, rater_id, scores_a, scores_b, winner, presented_first)
     VALUES ($1, $2, '{}'::jsonb, '{}'::jsonb, $3, 'a')`,
    [corpusId, raterId, winner],
  );
}

async function state(corpusId: string) {
  const [item, rows] = await Promise.all([
    pool.query<{ status: string; rating_count: number }>(
      "SELECT status, rating_count FROM corpus_items WHERE id = $1",
      [corpusId],
    ),
    pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM corpus_ratings WHERE corpus_id = $1",
      [corpusId],
    ),
  ]);
  return {
    status: item.rows[0].status,
    stored: Number(item.rows[0].rating_count),
    actual: Number(rows.rows[0].count),
  };
}

function storeRating(corpusId: string, raterId: string, winner = "a") {
  return insertImmutableRating(
    {
      corpusId,
      raterId,
      scoresA: { evidenceQuality: 4 },
      scoresB: { evidenceQuality: 3 },
      winner,
      confidence: 0.7,
      rationale: "repair race test",
      presentedFirst: "a",
    },
    MIN_RATERS_PER_ITEM,
  );
}

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL?.trim(), max: 8 });
  await applyMigrations();
  for (const e of emails) userIds.set(e, await ensureUser(e));
});

afterAll(async () => {
  // Scoped to this file's items only (ratings cascade). The previous
  // whole-table DELETE raced the parallel corpusRatingStore.db.test.ts
  // fixtures whenever vitest scheduled both files at once.
  await pool.query("DELETE FROM corpus_items WHERE id = ANY($1::uuid[])", [itemIds]);
  await pool.query("DELETE FROM profiles WHERE id = ANY($1::uuid[])", [[...userIds.values()]]);
  await pool.query("DELETE FROM app_users WHERE email = ANY($1::text[])", [emails]);
  await pool.end();
});

d("corpus closure repair (real Postgres)", () => {
  it("fixes counter drift WITHOUT closing an item below threshold", async () => {
    const item = await makeItem();
    await rawRating(item, userIds.get("rp-a@test.local")!); // 1 rating, stored 0
    const client = await pool.connect();
    try {
      const res = await repairItemWithLock(client, item, MIN_RATERS_PER_ITEM, { apply: true });
      expect(res.changed).toBe(true);
    } finally {
      client.release();
    }
    expect(await state(item)).toEqual({ status: "open", stored: 1, actual: 1 });
  });

  it("closes an open item whose FRESH count meets the threshold; syncs counter", async () => {
    const item = await makeItem();
    await rawRating(item, userIds.get("rp-a@test.local")!, "a");
    await rawRating(item, userIds.get("rp-b@test.local")!, "a"); // stored 0, actual 2
    const client = await pool.connect();
    try {
      const res = await repairItemWithLock(client, item, MIN_RATERS_PER_ITEM, { apply: true });
      expect(res.changed).toBe(true);
      expect(res.after).toEqual({ stored: 2, status: "rated" });
    } finally {
      client.release();
    }
    expect(await state(item)).toEqual({ status: "rated", stored: 2, actual: 2 });
  });

  it("leaves already-correct items untouched (and a second run is a no-op)", async () => {
    const item = await makeItem();
    await rawRating(item, userIds.get("rp-a@test.local")!, "a");
    await rawRating(item, userIds.get("rp-b@test.local")!, "a");
    const client = await pool.connect();
    try {
      await repairItemWithLock(client, item, MIN_RATERS_PER_ITEM, { apply: true });
      const second = await repairItemWithLock(client, item, MIN_RATERS_PER_ITEM, { apply: true });
      expect(second.changed).toBe(false);
      expect(second.wouldChange).toBe(false);
    } finally {
      client.release();
    }
    expect(await state(item)).toEqual({ status: "rated", stored: 2, actual: 2 });
  });

  it("dry-run reports exactly what apply would do and mutates nothing", async () => {
    const item = await makeItem();
    await rawRating(item, userIds.get("rp-a@test.local")!, "a");
    await rawRating(item, userIds.get("rp-b@test.local")!, "a");
    const client = await pool.connect();
    try {
      const dry = await repairItemWithLock(client, item, MIN_RATERS_PER_ITEM, { apply: false });
      expect(dry.wouldChange).toBe(true);
      expect(dry.changed).toBe(false);
    } finally {
      client.release();
    }
    expect(await state(item)).toEqual({ status: "open", stored: 0, actual: 2 });
    const applied = await pool.connect();
    try {
      await repairItemWithLock(applied, item, MIN_RATERS_PER_ITEM, { apply: true });
    } finally {
      applied.release();
    }
    expect(await state(item)).toEqual({ status: "rated", stored: 2, actual: 2 });
  });

  it("does not re-open or close below-threshold rated items (syncs count only)", async () => {
    const item = await makeItem();
    await pool.query("UPDATE corpus_items SET status = 'rated' WHERE id = $1", [item]);
    await rawRating(item, userIds.get("rp-a@test.local")!, "a"); // rated with 1 < threshold
    const client = await pool.connect();
    try {
      const res = await repairItemWithLock(client, item, MIN_RATERS_PER_ITEM, { apply: true });
      expect(res.after).toEqual({ stored: 1, status: "rated" });
    } finally {
      client.release();
    }
    expect(await state(item)).toEqual({ status: "rated", stored: 1, actual: 1 });
  });

  it("race: rating lands AFTER the scan but BEFORE the locked recount -> fresh count wins", async () => {
    const item = await makeItem();
    await rawRating(item, userIds.get("rp-a@test.local")!, "a"); // actual 1, stored 1 (no drift yet)
    const candidates = await findCandidates(
      async (t, p) => (await pool.query(t, p)).rows as Record<string, unknown>[],
      MIN_RATERS_PER_ITEM,
    );
    expect(candidates.map((c) => c.id)).toContain(item); // open, one below threshold
    // A second rating arrives after the scan (raw, drift-producing):
    await rawRating(item, userIds.get("rp-b@test.local")!, "a");
    const client = await pool.connect();
    try {
      const res = await repairItemWithLock(client, item, MIN_RATERS_PER_ITEM, { apply: true });
      expect(res.actual).toBe(2); // recounted under the lock, not from the scan
      expect(res.after).toEqual({ stored: 2, status: "rated" });
    } finally {
      client.release();
    }
    expect(await state(item)).toEqual({ status: "rated", stored: 2, actual: 2 });
  });

  it("race: final store-rater blocks on the repair lock; both commit; nothing lost, state exact", async () => {
    const item = await makeItem();
    await rawRating(item, userIds.get("rp-a@test.local")!, "a"); // 1/2, open, stored 0 (drift)
    await pool.query("UPDATE corpus_items SET rating_count = 1 WHERE id = $1", [item]); // exact race: no drift
    const client = await pool.connect();
    try {
      const rater = userIds.get("rp-b@test.local")!;
      let pendingRating: ReturnType<typeof storeRating> | null = null;
      const res = await repairItemWithLock(client, item, MIN_RATERS_PER_ITEM, {
        apply: true,
        // While repair holds the row lock, the final threshold rating is
        // attempted through the real store path: it must WAIT for the lock,
        // then close the item itself. Repair must NOT use a stale count.
        onLockedAfterCount: async (_repairClient, info) => {
          expect(info.actual).toBe(1); // concurrent insert not yet visible: correct
          pendingRating = storeRating(item, rater, "b"); // not awaited: races on purpose
          await new Promise((r) => setTimeout(r, 150)); // let it reach the lock
        },
      });
      expect(res.changed).toBe(false); // fresh count 1 < 2, counter exact: no write
      expect(pendingRating).not.toBeNull(); // the hook ran and started the racing insert
      const outcome = await pendingRating!;
      expect(outcome.result).toBe("accepted");
      expect(await state(item)).toEqual({ status: "rated", stored: 2, actual: 2 });
    } finally {
      client.release();
    }
  });

  it("findCandidates flags drift and threshold items; clean items absent", async () => {
    const drifted = await makeItem(); // stored 0, actual 1 -> drift
    await rawRating(drifted, userIds.get("rp-a@test.local")!, "a");
    const clean = await makeItem(); // correct: stored 1, actual 1, open, below threshold-1? min-1=1 -> candidate by widening
    await rawRating(clean, userIds.get("rp-b@test.local")!, "a");
    await pool.query("UPDATE corpus_items SET rating_count = 1 WHERE id = $1", [clean]);
    const done = await makeItem(); // fully rated and consistent -> not a candidate
    await rawRating(done, userIds.get("rp-a@test.local")!, "a");
    await rawRating(done, userIds.get("rp-b@test.local")!, "a");
    await pool.query("UPDATE corpus_items SET rating_count = 2, status = 'rated' WHERE id = $1", [done]);
    const found = await findCandidates(
      async (t, p) => (await pool.query(t, p)).rows as Record<string, unknown>[],
      MIN_RATERS_PER_ITEM,
    );
    const ids = found.map((c) => c.id);
    expect(ids).toContain(drifted);
    expect(ids).toContain(clean); // widened scan: open items one below threshold
    expect(ids).not.toContain(done);
  });
});
