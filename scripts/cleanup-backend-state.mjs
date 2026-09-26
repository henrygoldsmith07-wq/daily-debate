import { createExecutor } from "./lib/sql-executor.mjs";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required to clean backend state.");

const sql = await createExecutor(databaseUrl);
await sql("SELECT cleanup_expired_backend_state()");
console.log("Expired sessions, reset tokens, and rate-limit buckets cleaned.");
