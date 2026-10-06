// Dual-transport SQL access for repo scripts (mirrors src/lib/backend/sql.ts).
// Neon HTTP URLs use @neondatabase/serverless; plain postgres:// URLs (local
// dev, ephemeral CI Postgres) use node-postgres over TCP.
//
// TWO surfaces:
//   query(text, params)      — one-shot statement. On Neon HTTP each call is a
//                              SEPARATE HTTP request (separate session); on TCP
//                              it borrows the pool.
//   transaction(fn)          — REAL transaction on one session: BEGIN, fn(tx),
//                              COMMIT, or ROLLBACK on any throw.
//
// Transactions are ALWAYS session-backed over a dedicated TCP client — this is
// the Neon-safe strategy (connection-backed client for transactional work,
// HTTP for normal reads). `BEGIN`/`COMMIT` issued as separate query() calls on
// the Neon HTTP transport would land in DIFFERENT sessions: the "transaction"
// would silently not exist while looking correct in code review. If no session
// can be opened, transaction() THROWS — a repair that cannot be atomic must
// fail, never pretend.

export function isNeonHttpUrl(url) {
  if (/neon\.(tech|build|new|local)|neon\.databases?\./i.test(url)) return true;
  return process.env.DATABASE_DRIVER === "neon-http";
}

/**
 * Session-backed transaction over a dedicated client.
 * @param {string} url
 * @returns {(fn: (tx: (text: string, params?: unknown[]) => Promise<unknown[]>) => Promise<unknown>) => Promise<unknown>}
 */
function sessionTransaction(url) {
  return async function transaction(fn) {
    const pg = await import("pg");
    const client = new pg.Client({ connectionString: url, client_encoding: "UTF8" });
    try {
      await client.connect();
    } catch (e) {
      throw new Error(
        `transactional write requires a session-backed connection that could not be opened ` +
          `(${String(e?.message ?? e).slice(0, 140)}); refusing to run a non-atomic repair`,
      );
    }
    const tx = async (text, params = []) => (await client.query(text, params ?? [])).rows;
    try {
      await client.query("BEGIN");
      const result = await fn(tx);
      await client.query("COMMIT");
      return result;
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // rollback of a dead session is best-effort; the client is discarded below
      }
      throw e;
    } finally {
      try {
        await client.end();
      } catch {
        /* closing a broken socket is best-effort */
      }
    }
  };
}

/**
 * @param {string} url database URL
 * @param {{ query?: (text: string, params?: unknown[]) => Promise<unknown[]> }} [overrides]
 *   `query` overrides the one-shot query transport (test hook for exercising
 *   sessionless-transport contracts against a local Postgres). It NEVER
 *   overrides `transaction`, which is session-backed by construction.
 * @returns {((text: string, params?: unknown[]) => Promise<unknown[]>) & {
 *   transaction: (fn: (tx: (text: string, params?: unknown[]) => Promise<unknown[]>) => Promise<unknown>) => Promise<unknown>
 * }}
 */
export async function createExecutor(url, overrides = {}) {
  let query;
  if (typeof overrides.query === "function") {
    query = overrides.query;
  } else if (isNeonHttpUrl(url)) {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(url);
    query = async (text, params = []) => await sql.query(text, params);
  } else {
    const pg = await import("pg");
    const pool = new pg.Pool({
      connectionString: url,
      max: 2,
      // Migrations contain Unicode (box-drawing comments); on Windows-hosted
      // Postgres the server may default clients to WIN1252, which cannot
      // represent them. Force UTF-8 end to end.
      client_encoding: "UTF8",
    });
    pool.on("connect", (client) => client.query("SET client_encoding TO 'UTF8'"));
    query = async (text, params = []) => (await pool.query(text, params ?? [])).rows;
  }
  query.transaction = sessionTransaction(url);
  return query;
}
