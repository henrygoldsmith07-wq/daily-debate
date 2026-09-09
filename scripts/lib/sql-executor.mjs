// Dual-transport SQL access for repo scripts (mirrors src/lib/backend/sql.ts).
// Neon HTTP URLs use @neondatabase/serverless; plain postgres:// URLs (local
// dev, ephemeral CI Postgres) use node-postgres over TCP.

export function isNeonHttpUrl(url) {
  if (/neon\.(tech|build|new|local)|neon\.databases?\./i.test(url)) return true;
  return process.env.DATABASE_DRIVER === "neon-http";
}

export async function createExecutor(url) {
  if (isNeonHttpUrl(url)) {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(url);
    return async (text, params = []) => await sql.query(text, params);
  }
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
  return async (text, params = []) => (await pool.query(text, params)).rows;
}
