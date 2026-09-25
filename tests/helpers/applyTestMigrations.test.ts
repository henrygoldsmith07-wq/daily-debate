import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  applyTestMigrations,
  resetTestMigrationsMemoForTests,
  TEST_MIGRATIONS_LOCK_KEY,
} from "./applyTestMigrations";

// Unit coverage for the shared migration bootstrap. Runs against the same
// CI-provisioned Postgres as the other *.db.test.ts suites; skips locally.
//
// Deliberately NON-destructive: this suite shares the database with every
// other *.db.test.ts worker, so it never drops the marker table (a concurrent
// suite's bootstrap could then INSERT into a missing table). Forcing re-apply
// is done by stale-ing the recorded file-set — replaying already-applied
// migrations is safe by contract (duplicate-object noise tolerated, no data
// mutation beyond idempotent backfills).

const url = (process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL)?.trim();
const MIGRATIONS_DIR = fileURLToPath(new URL("../../database/migrations", import.meta.url));
const expectedFileSet = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .join("\n");

describe.skipIf(!url)("applyTestMigrations helper", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 2 });
    // Not memo-reset: other suites in this worker may already have bootstrapped.
    await applyTestMigrations(pool);
  });

  afterAll(async () => {
    resetTestMigrationsMemoForTests(); // don't pin this pool in the worker memo
    await pool.end();
  });

  it("leaves the schema fully applied with the exact migration file-set recorded", async () => {
    const probe = await pool.query<{ present: boolean }>(
      "SELECT to_regclass('public.daily_topics') IS NOT NULL AS present",
    );
    expect(probe.rows[0].present).toBe(true);
    const { rows } = await pool.query<{ file_set: string }>(
      "SELECT file_set FROM app_test_migrations_marker WHERE key = 1",
    );
    expect(rows[0].file_set).toBe(expectedFileSet);
  });

  it("is idempotent: an unchanged migration set does no DDL work", async () => {
    const before = await pool.query<{ applied_at: string }>(
      "SELECT applied_at FROM app_test_migrations_marker WHERE key = 1",
    );
    resetTestMigrationsMemoForTests(); // force the DB path, not the worker memo
    await applyTestMigrations(pool);
    const after = await pool.query<{ applied_at: string }>(
      "SELECT applied_at FROM app_test_migrations_marker WHERE key = 1",
    );
    expect(after.rows[0].applied_at).toBe(before.rows[0].applied_at);
  });

  it("re-applies when the recorded migration set changes", async () => {
    await pool.query("UPDATE app_test_migrations_marker SET file_set = 'stale' WHERE key = 1");
    resetTestMigrationsMemoForTests();
    await applyTestMigrations(pool); // replays everything; duplicate-object noise tolerated
    const { rows } = await pool.query<{ file_set: string }>(
      "SELECT file_set FROM app_test_migrations_marker WHERE key = 1",
    );
    expect(rows[0].file_set).toBe(expectedFileSet);
    // Leave a correct marker for any concurrent fresh worker.
  });

  it("serializes concurrent callers and leaves the shared advisory lock free", async () => {
    resetTestMigrationsMemoForTests();
    await Promise.all([
      applyTestMigrations(pool),
      applyTestMigrations(pool),
      applyTestMigrations(pool),
      applyTestMigrations(pool),
    ]);
    // The lock must never leak: another session can take it immediately.
    const client = await pool.connect();
    try {
      const probe = await client.query<{ free: boolean }>(
        "SELECT pg_try_advisory_lock($1) AS free",
        [TEST_MIGRATIONS_LOCK_KEY],
      );
      expect(probe.rows[0].free).toBe(true);
      await client.query("SELECT pg_advisory_unlock($1)", [TEST_MIGRATIONS_LOCK_KEY]);
    } finally {
      client.release();
    }
  });

  it("names the failing migration file when a migration cannot be applied", async () => {
    // Stub pool: allow lock + marker DDL + marker select, then fail inside the
    // first migration file so the wrapping is what gets asserted.
    let n = 0;
    const ok = { rows: [] as unknown[] };
    const fail = ((): Error => {
      const e = new Error("boom") as Error & { code: string };
      e.code = "XX999";
      return e;
    })();
    const stubClient = {
      query: async () => {
        n += 1;
        if (n <= 3) return ok;
        throw fail;
      },
      release: () => {},
    };
    const stubPool = { connect: async () => stubClient } as unknown as Pool;
    await expect(applyTestMigrations(stubPool)).rejects.toThrow(/001_owned_backend\.sql/);
  });
});
