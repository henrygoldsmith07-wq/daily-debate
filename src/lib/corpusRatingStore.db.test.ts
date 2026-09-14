import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { insertImmutableRating, appendRatingCorrection } from "@/lib/corpusRatingStore";
import { MIN_RATERS_PER_ITEM } from "@/lib/corpus";

/**
 * REAL-POSTGRES integration tests for corpus rating integrity
 * (src/lib/corpusRatingStore.ts). Mocks prove routing; this proves the SQL:
 * append-once insert, immediate closure at the threshold (including the
 * snapshot-vs-CTE subtlety), row-level locking against concurrent
 * submissions, and audit-chain corrections.
 *
 * Runs only with TEST_DATABASE_URL (the CI e2e job provisions an ephemeral
 * Postgres and sets it). Skipped otherwise so plain unit runs stay green.
 * DATABASE_URL must point at the same database: the production store module
 * resolves its transport from it.
 */

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const d = databaseUrl && process.env.DATABASE_URL?.trim() ? describe : describe.skip;

const MIGRATIONS_DIR = fileURLToPath(new URL("../../database/migrations", import.meta.url));

let pool: pg.Pool;

const emails = ["cr-a@test.local", "cr-b@test.local", "cr-c@test.local", "cr-contrib@test.local"];
const userIds = new Map<string, string>();
const itemIds: string[] = [];

async function applyMigrations() {
  await pool.query("SELECT pg_advisory_lock(727291)");
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await pool.query(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  await pool.query("SELECT pg_advisory_unlock(727291)");
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

async function makeItem(status = "open"): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO corpus_items (
       transcript, topic, source_type, contributor_id, length_bucket, ability_band, status
     ) VALUES ($1, 'Corpus integration test topic', 'solo', $2, 'medium', 'intermediate', $3)
     RETURNING id`,
    ["Side A (round 1): Alpha.\nSide B (round 1): Beta.\nSide A (round 2): Rebuttal.\nSide B (round 2): Duply.", userIds.get("cr-contrib@test.local"), status],
  );
  const id = res.rows[0].id;
  itemIds.push(id);
  return id;
}

function rating(corpusId: string, raterId: string, winner = "a") {
  return {
    corpusId,
    raterId,
    scoresA: { evidenceQuality: 5, reasoning: 4, relevance: 4, rebuttalQuality: 5, logicalValidity: 4, sourceQuality: 5 },
    scoresB: { evidenceQuality: 2, reasoning: 2, relevance: 3, rebuttalQuality: 1, logicalValidity: 2, sourceQuality: 2 },
    winner,
    confidence: 0.8,
    rationale: "integration test",
    presentedFirst: "a",
  };
}

async function state(corpusId: string) {
  const [rows, item] = await Promise.all([
    pool.query<{ count: string }>("SELECT count(*)::text AS count FROM corpus_ratings WHERE corpus_id = $1", [corpusId]),
    pool.query<{ status: string }>("SELECT status FROM corpus_items WHERE id = $1", [corpusId]),
  ]);
  return { ratings: Number(rows.rows[0].count), status: item.rows[0].status };
}

/** Genuine races: pool.query checks out independent connections per call. */
function race<A, B>(fnA: () => Promise<A>, fnB: () => Promise<B>): Promise<[A, B]> {
  return Promise.all([fnA(), fnB()]) as Promise<[A, B]>;
}

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL?.trim(), max: 8 });
  await applyMigrations();
  for (const e of emails) userIds.set(e, await ensureUser(e));
});

beforeEach(async () => {
  await pool.query("DELETE FROM corpus_ratings");
  await pool.query("DELETE FROM corpus_items");
});

afterAll(async () => {
  await pool.query("DELETE FROM corpus_ratings");
  await pool.query("DELETE FROM corpus_items");
  await pool.query("DELETE FROM profiles WHERE id = ANY($1::uuid[])", [[...userIds.values()]]);
  await pool.query("DELETE FROM app_users WHERE email = ANY($1::text[])", [emails]);
  await pool.end();
});

d("corpus rating store (real Postgres)", () => {
  it("0->1 open, 1->2 rated IMMEDIATELY; later ratings rejected; duplicates rejected at every stage", async () => {
    const item = await makeItem();
    const a = userIds.get("cr-a@test.local")!;
    const b = userIds.get("cr-b@test.local")!;
    const c = userIds.get("cr-c@test.local")!;

    const r1 = await insertImmutableRating(rating(item, a), MIN_RATERS_PER_ITEM);
    expect(r1.result).toBe("accepted");
    expect(await state(item)).toEqual({ ratings: 1, status: "open" });

    // The threshold rating closes the item IN THE SAME statement — the fix
    // for the snapshot bug where the flip CTE could not see the new row.
    const r2 = await insertImmutableRating(rating(item, b), MIN_RATERS_PER_ITEM);
    expect(r2.result).toBe("accepted");
    if (r2.result === "accepted") expect(r2.flippedToRated).toBe(true);
    expect(await state(item)).toEqual({ ratings: 2, status: "rated" });

    // Extra rater after closure: rejected, no new row, status untouched.
    const r3 = await insertImmutableRating(rating(item, c), MIN_RATERS_PER_ITEM);
    expect(r3.result).toBe("item-closed");
    expect(await state(item)).toEqual({ ratings: 2, status: "rated" });

    // Duplicate while/after closure: rejected as duplicate, original preserved.
    const dupOpen = await makeItem();
    const d1 = await insertImmutableRating(rating(dupOpen, a, "a"), MIN_RATERS_PER_ITEM);
    expect(d1.result).toBe("accepted");
    const d2 = await insertImmutableRating(rating(dupOpen, a, "b"), MIN_RATERS_PER_ITEM);
    expect(d2.result).toBe("duplicate");
    expect(await state(dupOpen)).toEqual({ ratings: 1, status: "open" });
    const stored = await pool.query<{ winner: string }>(
      "SELECT winner FROM corpus_ratings WHERE corpus_id = $1 AND rater_id = $2",
      [dupOpen, a],
    );
    expect(stored.rows[0].winner).toBe("a"); // never overwritten
  });

  it("simultaneous final raters: exactly one closes the item, one is rejected, no third row", async () => {
    const item = await makeItem();
    const a = userIds.get("cr-a@test.local")!;
    const b = userIds.get("cr-b@test.local")!;
    const c = userIds.get("cr-c@test.local")!;
    await insertImmutableRating(rating(item, a), MIN_RATERS_PER_ITEM);

    const results = (await race(
      () => insertImmutableRating(rating(item, b, "a"), MIN_RATERS_PER_ITEM),
      () => insertImmutableRating(rating(item, c, "b"), MIN_RATERS_PER_ITEM),
    )) as Array<{ result: string }>;

    const accepted = results.filter((r) => r.result === "accepted").length;
    expect(accepted).toBe(1);
    expect(results.filter((r) => r.result === "item-closed").length).toBe(1);
    expect(await state(item)).toEqual({ ratings: 2, status: "rated" });
  });

  it("two simultaneous FIRST raters both land and the item closes at exactly the threshold", async () => {
    const item = await makeItem();
    const a = userIds.get("cr-a@test.local")!;
    const b = userIds.get("cr-b@test.local")!;
    const results = (await race(
      () => insertImmutableRating(rating(item, a, "a"), MIN_RATERS_PER_ITEM),
      () => insertImmutableRating(rating(item, b, "b"), MIN_RATERS_PER_ITEM),
    )) as Array<{ result: string }>;
    expect(results.every((r) => r.result === "accepted")).toBe(true);
    expect(await state(item)).toEqual({ ratings: 2, status: "rated" });
  });

  it("three simultaneous raters on an open item: exactly MIN land, the rest are closed-rejects", async () => {
    const item = await makeItem();
    const [a, b, c] = ["cr-a", "cr-b", "cr-c"].map((k) => userIds.get(`${k}@test.local`)!);
    const results = (await Promise.all([
      insertImmutableRating(rating(item, a), MIN_RATERS_PER_ITEM),
      insertImmutableRating(rating(item, b), MIN_RATERS_PER_ITEM),
      insertImmutableRating(rating(item, c), MIN_RATERS_PER_ITEM),
    ])) as Array<{ result: string }>;
    expect(results.filter((r) => r.result === "accepted").length).toBe(MIN_RATERS_PER_ITEM);
    expect(results.filter((r) => r.result === "item-closed").length).toBe(3 - MIN_RATERS_PER_ITEM);
    expect(await state(item)).toEqual({ ratings: MIN_RATERS_PER_ITEM, status: "rated" });
  });

  it("rejected and missing items are refused", async () => {
    const rejected = await makeItem("rejected");
    const res = await insertImmutableRating(rating(rejected, userIds.get("cr-a@test.local")!), MIN_RATERS_PER_ITEM);
    expect(res.result).toBe("item-closed");
    const missing = await insertImmutableRating(
      rating("00000000-0000-0000-0000-000000000000", userIds.get("cr-a@test.local")!),
      MIN_RATERS_PER_ITEM,
    );
    expect(missing.result).toBe("item-missing");
  });

  it("a failing insert leaves no partial state (statement-level rollback)", async () => {
    const item = await makeItem();
    // winner 'z' violates the CHECK constraint -> the whole statement aborts,
    // so neither a rating row nor the closure flip may be visible.
    await expect(
      insertImmutableRating(rating(item, userIds.get("cr-a@test.local")!, "z"), MIN_RATERS_PER_ITEM),
    ).rejects.toThrow(/check|constraint/i);
    expect(await state(item)).toEqual({ ratings: 0, status: "open" });
  });

  it("corrections are self-contained events; a second leaves the first intact", async () => {
    const item = await makeItem();
    const a = userIds.get("cr-a@test.local")!;
    const b = userIds.get("cr-b@test.local")!;
    await insertImmutableRating(rating(item, a, "a"), MIN_RATERS_PER_ITEM);
    await insertImmutableRating(rating(item, b, "a"), MIN_RATERS_PER_ITEM);

    const c1 = await appendRatingCorrection({
      corpusId: item, raterId: a, winner: "b",
      scoresA: { evidenceQuality: 1 }, scoresB: { evidenceQuality: 9 },
      actor: "admin@test.local", reason: "rater submitted in swapped frame", at: "2026-09-14T00:00:00Z",
    });
    expect(c1.applied).toBe(true);
    expect(c1.corrections).toHaveLength(1);
    const e1 = c1.corrections![0];
    expect(e1.before).toEqual({ winner: "a", scoresA: rating(item, a).scoresA, scoresB: rating(item, a).scoresB });
    expect(e1.after).toEqual({ winner: "b", scoresA: { evidenceQuality: 1 }, scoresB: { evidenceQuality: 9 } });
    expect(e1.actor).toBe("admin@test.local");
    expect(e1.at).toBe("2026-09-14T00:00:00Z");

    // Concurrent second corrections on the same rating: both events land,
    // each self-contained, chain intact in commit order, first unchanged.
    const [r2, r3] = await race(
      () =>
        appendRatingCorrection({
          corpusId: item, raterId: a, winner: "tie",
          scoresA: { evidenceQuality: 5 }, scoresB: { evidenceQuality: 5 },
          actor: "admin2@test.local", reason: "review board majority was tie", at: "2026-09-14T01:00:00Z",
        }),
      () =>
        appendRatingCorrection({
          corpusId: item, raterId: a, winner: "a",
          scoresA: { evidenceQuality: 8 }, scoresB: { evidenceQuality: 2 },
          actor: "admin3@test.local", reason: "reversal after evidence recheck", at: "2026-09-14T02:00:00Z",
        }),
    );
    expect(r2.applied && r3.applied).toBe(true);
    const row = await pool.query<{ corrections: unknown; winner: string }>(
      "SELECT corrections, winner FROM corpus_ratings WHERE corpus_id = $1 AND rater_id = $2",
      [item, a],
    );
    const trail = row.rows[0].corrections as Array<Record<string, unknown>>;
    expect(trail).toHaveLength(3);
    expect(trail[0]).toEqual({ ...e1 }); // complete first event, unmodified
    for (let i = 1; i < trail.length; i++) {
      expect(trail[i].before).toEqual(trail[i - 1].after); // chain links
      expect(trail[i]).toHaveProperty("actor");
      expect(trail[i]).toHaveProperty("reason");
      expect(typeof trail[i].at).toBe("string");
    }
    const cur = await pool.query<{ winner: string; scores_a: unknown; scores_b: unknown }>(
      "SELECT winner, scores_a, scores_b FROM corpus_ratings WHERE corpus_id = $1 AND rater_id = $2",
      [item, a],
    );
    expect(trail[trail.length - 1].after).toEqual({
      winner: cur.rows[0].winner,
      scoresA: cur.rows[0].scores_a,
      scoresB: cur.rows[0].scores_b,
    });
  });
});
