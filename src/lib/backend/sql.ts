import "server-only";

import { neon } from "@neondatabase/serverless";
import { databaseUrl } from "./env";

/**
 * Dual-transport SQL access.
 *
 * - Neon-hosted databases use the Neon serverless HTTP driver (no sockets,
 *   ideal for serverless deploys).
 * - Plain `postgres://` URLs (local dev, ephemeral CI Postgres) use node-postgres
 *   over TCP. This is what makes authenticated E2E and DB integration tests run
 *   against an ordinary Postgres service container instead of skipping.
 *
 * Both transports expose the same (text, params) => rows surface, so
 * src/lib/backend/query.ts stays transport-agnostic.
 */

interface SqlExecutor {
  query(text: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
}

let executor: SqlExecutor | null = null;

/**
 * Columns declared as bare `numeric` in the schema. node-postgres returns
 * NUMERIC as a STRING (to preserve arbitrary precision), so without
 * normalisation every consumer sees `"85"` where the types promise `85` —
 * silently breaking sums, means, thresholds, and `typeof` filters
 * (e.g. meanRaterConfidence was always null). All of these columns are
 * scores/statistics where float64 precision is more than sufficient, so the
 * database/client boundary converts them to JS numbers once, here, for both
 * transports.
 */
export const NUMERIC_COLUMNS: ReadonlySet<string> = new Set([
  "before_score",
  "attempt_score",
  "movement",
  "confidence",
  "position_mirror_stability",
  "verbosity_stability",
  "human_agreement",
  "ece",
  "false_citation_influence",
]);

/** Coerce numeric-typed string values to numbers. Pure — safe to reuse in tests. */
export function normalizeNumerics<T extends Record<string, unknown>>(row: T): T {
  for (const key of NUMERIC_COLUMNS) {
    const value: unknown = (row as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
      (row as Record<string, unknown>)[key] = Number(value);
    }
  }
  return row;
}

export function isNeonHttpUrl(url: string): boolean {
  if (/neon\.(tech|build|new|local)|neon\.databases?\./i.test(url)) return true;
  return process.env.DATABASE_DRIVER === "neon-http";
}

function neonExecutor(url: string): SqlExecutor {
  const sql = neon(url);
  return {
    async query(text, params = []) {
      return (await sql.query(text, params as never[])) as Record<string, unknown>[];
    },
  };
}

async function tcpExecutor(url: string): Promise<SqlExecutor> {
  const pg = await import("pg");
  const pool = new pg.Pool({
    connectionString: url,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  // Serverless functions reuse the process; an unreferenced idle pool keeps
  // sockets open, so close idle clients when the pool drains.
  pool.on("error", (err: Error) => console.error("pg pool error:", err.message));
  return {
    async query(text, params = []) {
      const result = await pool.query(text, params as unknown[]);
      return result.rows as Record<string, unknown>[];
    },
  };
}

export async function getExecutor(): Promise<SqlExecutor> {
  if (!executor) {
    const url = databaseUrl();
    executor = isNeonHttpUrl(url) ? neonExecutor(url) : await tcpExecutor(url);
  }
  return executor;
}

export async function queryRows<T>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const exec = await getExecutor();
  return ((await exec.query(text, params)).map((row) => normalizeNumerics(row)) as T[]);
}
