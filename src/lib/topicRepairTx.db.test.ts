import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createExecutor } from "../../scripts/lib/sql-executor.mjs";
import { resolveTargetDate, runGeneration, topicFingerprint, jsonParam } from "../../scripts/generate-topics.mjs";

/**
 * REAL-POSTGRES transaction tests for the Neon-safe repair path (items 1-3,
 * 25). Production queries go over Neon HTTP — where each query() call is its
 * OWN session — while transactions run on a dedicated session client
 * (strategy B in sql-executor.transaction). This suite proves atomicity
 * against BOTH shapes:
 *
 *   1. pooled TCP executor (plain pg)              — commit + rollback matrix
 *   2. SESSIONLESS query transport + .transaction  — the Neon HTTP shape:
 *      every non-transactional statement lands in its own session, yet the
 *      transaction abstraction must still commit/rollback atomically
 *   3. naive BEGIN/COMMIT as separate statements on the sessionless
 *      transport is demonstrated NON-atomic — the P0 bug class this suite
 *      exists to prevent.
 *
 * Failure points covered for the real repair pipeline (runGeneration's
 * deliberate corruption-repair branch):
 *   - repair succeeds                → everything committed
 *   - failure after topic update     → full rollback, original row intact
 *   - failure after evidence delete  → original evidence restored
 *   - failure midway through inserts → no partial evidence set
 *
 * Skipped without TEST_DATABASE_URL + DATABASE_URL (CI e2e provisions both).
 */

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const d = databaseUrl && process.env.DATABASE_URL?.trim() ? describe : describe.skip;
const url = process.env.DATABASE_URL?.trim() ?? "";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../database/migrations", import.meta.url));

let pool: pg.Pool;

const NOW = new Date("2099-06-14T02:00:00Z");
const TARGET = resolveTargetDate(NOW); // 2099-06-14 (day of NOW's cycle)
const STALE_FP = "0".repeat(64);
const ORIGINAL = {
  title: "Original stale topic title",
  prompt: "Original stale topic prompt that must survive a rolled-back repair?",
  category: "Policy",
};

type QueryFn = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
interface Exec {
  (text: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  transaction: (fn: (tx: QueryFn) => Promise<unknown>) => Promise<unknown>;
}

/** Sessionless transport: EVERY call opens its own connection (Neon HTTP shape). */
const sessionless: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]> = async (
  text,
  params = [],
) => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query(text, params)).rows as Record<string, unknown>[];
  } finally {
    await client.end();
  }
};

async function seedInvalidRow(): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO daily_topics (topic_date, title, prompt, category, sources, generation_source, generation_reason, topic_fingerprint)
     VALUES ($1, $2, $3, $4, '[]'::jsonb, 'fallback', 'fallback-policy', $5) RETURNING id`,
    [TARGET, ORIGINAL.title, ORIGINAL.prompt, ORIGINAL.category, STALE_FP],
  );
  const topicId = rows[0].id as string;
  await pool.query(
    `INSERT INTO topic_evidence (topic_id, claim, source_name, source_type, url, passage, topic_fingerprint)
     VALUES ($1, 'original stale claim', 'nrel.gov', 'primary', $2, 'original passage', $3)`,
    [topicId, `https://nrel.gov/original-${TARGET}`, STALE_FP],
  );
  return topicId;
}

async function readRow() {
  const { rows } = await pool.query(
    `SELECT id, title, prompt, category, generation_source, generation_reason, topic_fingerprint
       FROM daily_topics WHERE topic_date = $1::date`,
    [TARGET],
  );
  return rows[0] as Record<string, unknown> | undefined;
}

async function readEvidence(topicId: string) {
  const { rows } = await pool.query(
    `SELECT claim, topic_fingerprint FROM topic_evidence WHERE topic_id = $1 ORDER BY claim`,
    [topicId],
  );
  return rows as Array<{ claim: string; topic_fingerprint: string | null }>;
}

async function expectOriginalIntact(topicId: string) {
  const row = await readRow();
  expect(row?.title).toBe(ORIGINAL.title);
  expect(row?.topic_fingerprint).toBe(STALE_FP); // the mismatching fingerprint was NOT repaired
  expect(row?.generation_reason).toBe("fallback-policy"); // provenance untouched
  const evidence = await readEvidence(topicId);
  expect(evidence).toHaveLength(1); // the DELETE rolled back with the transaction
  expect(evidence[0].claim).toBe("original stale claim");
  expect(evidence[0].topic_fingerprint).toBe(STALE_FP);
}

type Poison = "ok" | "after-update" | "after-delete" | "mid-insert";

/** Wrap a transaction surface so a chosen statement throws AFTER executing. */
function poison(inner: Exec["transaction"], mode: Poison): Exec["transaction"] {
  return async (fn) =>
    inner(async (tx) => {
      let inserts = 0;
      const wrapped: QueryFn = async (text, params = []) => {
        const result = await tx(text, params);
        if (mode === "after-update" && /^UPDATE daily_topics/i.test(text.trim())) {
          throw new Error("poison: failure after topic update");
        }
        if (mode === "after-delete" && /^DELETE FROM topic_evidence/i.test(text.trim())) {
          throw new Error("poison: failure after evidence delete");
        }
        if (mode === "mid-insert" && /^INSERT INTO topic_evidence/i.test(text.trim())) {
          inserts += 1;
          if (inserts >= 2) throw new Error("poison: failure midway through evidence inserts");
        }
        return result;
      };
      return fn(wrapped);
    });
}

const retrieve = async () => [
  { claim: "new claim one", sourceName: "nrel.gov", sourceType: "primary", url: "https://nrel.gov/new-1", passage: "p one" },
  { claim: "new claim two", sourceName: "pew.org", sourceType: "secondary", url: "https://pew.org/new-2", passage: "p two" },
];

function repairDeps(exec: Exec, transaction: Exec["transaction"]) {
  return { query: exec, transaction, env: {}, retrieve, now: NOW, log: () => {} };
}

async function cleanup() {
  await pool.query("DELETE FROM topic_evidence WHERE topic_id IN (SELECT id FROM daily_topics WHERE topic_date >= '2099-06-01'::date)");
  await pool.query("DELETE FROM daily_topics WHERE topic_date >= '2099-06-01'::date");
}

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: url, max: 4 });
  await pool.query("SELECT pg_advisory_lock(727294)");
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    await pool.query(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  await pool.query("SELECT pg_advisory_unlock(727294)");
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await pool.end();
});

beforeEach(async () => {
  await cleanup();
});

d("repair transaction atomicity (pooled TCP executor)", () => {
  let exec: Exec;

  beforeAll(async () => {
    exec = (await createExecutor(url)) as Exec;
  });

  it("repair succeeds → topic + evidence changes are all committed", async () => {
    const topicId = await seedInvalidRow();
    const result = await runGeneration(repairDeps(exec, exec.transaction));
    expect(result.outcome).toBe("curated-fallback");
    expect(result.repaired).toBe("replaced-invalid-row");

    const row = await readRow();
    expect(row?.title).not.toBe(ORIGINAL.title); // content replaced by the repair
    const fp = topicFingerprint({
      topicDate: TARGET,
      title: String(row?.title),
      prompt: String(row?.prompt),
      category: String(row?.category),
    });
    expect(row?.topic_fingerprint).toBe(fp); // recomputes exactly
    expect(row?.generation_reason).toBe("fallback-policy");

    const evidence = await readEvidence(topicId);
    expect(evidence).toHaveLength(2); // the stub's two cards, old one gone
    expect(evidence.every((c) => c.topic_fingerprint === fp)).toBe(true); // all owned by the new revision
  });

  for (const mode of ["after-update", "after-delete", "mid-insert"] as const) {
    it(`failure ${mode.replace("-", " ")} → ROLLBACK leaves the original topic AND evidence intact`, async () => {
      const topicId = await seedInvalidRow();
      const transaction = poison(exec.transaction, mode);
      const result = await runGeneration(repairDeps(exec, transaction));
      expect(result.outcome).toBe("db-failure");
      expect(result.stage).toBe("store-topic");
      await expectOriginalIntact(topicId);
    });
  }
});

d("repair transaction atomicity (SESSIONLESS query transport — the Neon HTTP shape)", () => {
  let exec: Exec;

  beforeAll(async () => {
    exec = (await createExecutor(url, { query: sessionless })) as Exec;
  });

  it("repair succeeds when every non-transactional query is its own session", async () => {
    const topicId = await seedInvalidRow();
    const result = await runGeneration(repairDeps(exec, exec.transaction));
    expect(result.outcome).toBe("curated-fallback");

    const row = await readRow();
    expect(row?.title).not.toBe(ORIGINAL.title);
    const evidence = await readEvidence(topicId);
    expect(evidence).toHaveLength(2);
  });

  it("rollback still restores the original state on the sessionless transport", async () => {
    const topicId = await seedInvalidRow();
    const transaction = poison(exec.transaction, "after-delete");
    const result = await runGeneration(repairDeps(exec, transaction));
    expect(result.outcome).toBe("db-failure");
    await expectOriginalIntact(topicId);
  });

  it("naive BEGIN/COMMIT as separate statements is NOT atomic here (the P0 bug class)", async () => {
    // Documented regression: each sessionless call is its own session, so a
    // statement issued after a textual "BEGIN" commits immediately and a
    // later textual "ROLLBACK" (yet another session) cannot undo it. This is
    // exactly why repair code must never issue BEGIN/COMMIT as query() calls.
    const scratch = "2099-06-20";
    await cleanup();
    await pool.query(
      `INSERT INTO daily_topics (topic_date, title, prompt, category, sources, generation_source, generation_reason, topic_fingerprint)
       VALUES ($1, 'scratch', 'scratch prompt', 'Policy', '[]'::jsonb, 'fallback', 'fallback-policy', $2)`,
      [scratch, STALE_FP],
    );
    try {
      await sessionless("BEGIN");
      await sessionless("UPDATE daily_topics SET title = $2 WHERE topic_date = $1::date", [scratch, "leaked"]);
      // A separate (pool) session ALREADY sees the change — no transaction in effect:
      const seen = await pool.query("SELECT title FROM daily_topics WHERE topic_date = $1::date", [scratch]);
      expect(seen.rows[0].title).toBe("leaked");
      await sessionless("ROLLBACK");
      const after = await pool.query("SELECT title FROM daily_topics WHERE topic_date = $1::date", [scratch]);
      expect(after.rows[0].title).toBe("leaked"); // ROLLBACK rolled back nothing
    } finally {
      await pool.query("DELETE FROM daily_topics WHERE topic_date = $1::date", [scratch]);
    }
  });

  it("jsonb serialization round-trips on the sessionless transport (item 25)", async () => {
    const scratch = "2099-06-21";
    const sources = [{ name: "NREL", homepage: "https://nrel.gov" }];
    await sessionless(
      `INSERT INTO daily_topics (topic_date, title, prompt, category, sources, generation_source, generation_reason, topic_fingerprint)
       VALUES ($1, 'jsonb topic', 'prompt', 'Policy', $2::jsonb, 'fallback', 'fallback-policy', $3)
       ON CONFLICT (topic_date) DO NOTHING`,
      [scratch, jsonParam(sources), STALE_FP],
    );
    try {
      const back = await sessionless("SELECT sources FROM daily_topics WHERE topic_date = $1::date", [scratch]);
      expect(back[0].sources).toEqual(sources); // stored as JSON, read back as structure
    } finally {
      await pool.query("DELETE FROM daily_topics WHERE topic_date = $1::date", [scratch]);
    }
  });

  it("insert-ignore semantics hold on the sessionless transport (item 25)", async () => {
    const scratch = "2099-06-22";
    const sql = `INSERT INTO daily_topics (topic_date, title, prompt, category, sources, generation_source, generation_reason, topic_fingerprint)
       VALUES ($1, $2, 'prompt', 'Policy', '[]'::jsonb, 'fallback', 'fallback-policy', $3)
       ON CONFLICT (topic_date) DO NOTHING RETURNING id`;
    try {
      const first = await sessionless(sql, [scratch, "winner title", STALE_FP]);
      const second = await sessionless(sql, [scratch, "loser title", "f".repeat(64)]);
      expect(first).toHaveLength(1); // the claim returned its row
      expect(second).toHaveLength(0); // conflict ignored, zero rows, NO error
      const stored = await pool.query("SELECT title FROM daily_topics WHERE topic_date = $1::date", [scratch]);
      expect(stored.rows[0].title).toBe("winner title"); // first writer wins, content never overwritten
    } finally {
      await pool.query("DELETE FROM daily_topics WHERE topic_date = $1::date", [scratch]);
    }
  });
});
