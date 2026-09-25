import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool, PoolClient } from "pg";

/**
 * Shared migration bootstrap for *.db.test.ts suites.
 *
 * The previous suite-local pattern was racy by construction:
 *
 *   await pool.query("SELECT pg_advisory_lock(<suite key>)");
 *   for (const file of migrations) await pool.query(sql);   // any pooled client
 *   await pool.query("SELECT pg_advisory_unlock(<suite key>)");
 *
 * `pool.query` can hand each statement to a DIFFERENT client, so the
 * session-scoped advisory lock was often not held by the session that ran the
 * DDL at all. Worse, suites used different lock keys (727291/93/94/95), so two
 * suites replayed DDL against the same catalog tuples concurrently and
 * Postgres aborted one with `XX000 tuple concurrently updated`
 * (heapam.c/simple_heap_update) — the e2e failure this module fixes.
 *
 * Invariants here:
 *
 * 1. ONE shared lock key for every suite — full mutual exclusion, not per-suite.
 * 2. The advisory lock, every migration statement, and the unlock run on a
 *    single dedicated client (session-scoped semantics honoured).
 * 3. The lock is always released, even when a migration throws.
 * 4. A marker-table fast path: the first worker to win the lock replays all
 *    migrations and records the migration file-set; every later worker (same
 *    or fresh worker process) does one round-trip and skips when the recorded
 *    set matches. A changed migration set (new migration added) re-applies —
 *    every migration file tolerates full replay, so this is safe.
 *
 * Memoization uses globalThis because vitest resets the module graph per test
 * file but reuses worker threads, so the memo persists across files in a
 * worker while remaining correct for fresh workers.
 */

export const TEST_MIGRATIONS_LOCK_KEY = 727200;

const MIGRATIONS_DIR = fileURLToPath(new URL("../../database/migrations", import.meta.url));

const MARKER_TABLE = "app_test_migrations_marker";

type Memo = { applied: Promise<void> | undefined };

const globalMemo = globalThis as typeof globalThis & { __ddTestMigrationsMemo?: Memo };

function memo(): Memo {
  globalMemo.__ddTestMigrationsMemo ??= { applied: undefined };
  return globalMemo.__ddTestMigrationsMemo;
}

/** pg duplicate-object class: 42P07 (duplicate table), 42710 (duplicate constraint/object), 42701 (duplicate column), 42P16 (invalid table definition). */
function isDuplicateObjectError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  if (code === "42P07" || code === "42710" || code === "42701" || code === "42P16") return true;
  return /already exists|duplicate/i.test(String(err));
}

/** Error subclass whose own enumerable props survive vitest's serializer. */
class MigrationsFailedError extends Error {
  constructor(
    message: string,
    cause: unknown,
    public readonly migrationFile: string,
  ) {
    super(message, { cause });
    this.name = "MigrationsFailedError";
  }
}

function sqlState(err: unknown): string | undefined {
  return (err as { code?: string } | null)?.code;
}

/**
 * DDL contract for the fast path: every migration file must be written so its
 * full replay is idempotent. Files from the bare-DDL era (001's CREATE TABLE
 * without IF NOT EXISTS, e.g.) may legitimately raise duplicate-object errors
 * on replay; those are tolerated exactly while that file's statements run.
 * Any other failure aborts the bootstrap with the offending file named.
 */
async function replayMigrations(client: PoolClient, fileSet: string): Promise<void> {
  for (const file of fileSet.split("\n")) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    try {
      await client.query(sql);
    } catch (err) {
      if (!isDuplicateObjectError(err)) {
        throw new MigrationsFailedError(
          `test migration ${file} failed (sqlstate=${sqlState(err) ?? "n/a"}): ${String(err)}`,
          err,
          file,
        );
      }
    }
  }
}

/**
 * Apply database migrations exactly once per worker for the suite run.
 * Safe to call concurrently from every *.db.test.ts suite: all callers
 * serialize on ONE session-scoped advisory lock taken on the same client that
 * runs the DDL.
 */
export async function applyTestMigrations(pool: Pool): Promise<void> {
  const m = memo();
  m.applied ??= (async () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const fileSet = files.join("\n");
    const client = await pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock($1)", [TEST_MIGRATIONS_LOCK_KEY]);
      try {
        await client.query(
          `CREATE TABLE IF NOT EXISTS ${MARKER_TABLE} (
             key integer PRIMARY KEY,
             file_set text NOT NULL,
             applied_at timestamptz NOT NULL DEFAULT now()
           )`,
        );
        const existing = await client.query<{ file_set: string }>(
          `SELECT file_set FROM ${MARKER_TABLE} WHERE key = 1`,
        );
        if (existing.rows[0]?.file_set === fileSet) return;
        await replayMigrations(client, fileSet);
        await client.query(
          `INSERT INTO ${MARKER_TABLE} (key, file_set) VALUES (1, $1)
           ON CONFLICT (key) DO UPDATE SET file_set = EXCLUDED.file_set, applied_at = now()`,
          [fileSet],
        );
      } finally {
        await client.query("SELECT pg_advisory_unlock($1)", [TEST_MIGRATIONS_LOCK_KEY]);
      }
    } finally {
      client.release();
    }
  })();
  await m.applied;
}

/** Test-only: clear the per-worker memo so helper tests start from scratch. */
export function resetTestMigrationsMemoForTests(): void {
  memo().applied = undefined;
}
