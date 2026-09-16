import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import pg from "pg";

/**
 * REAL-POSTGRES test for the topic_run_log telemetry recorder: runs the
 * actual CLI (spawn, not mocks) with workflow-shaped env, then asserts the
 * stored row (scheduledFor parsing, delay math, upsert idempotence) that the
 * ops-health SLO surfaces. Skipped without TEST_DATABASE_URL + DATABASE_URL
 * (CI e2e provisions both).
 */

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const d = databaseUrl && process.env.DATABASE_URL?.trim() ? describe : describe.skip;

const MIGRATIONS_DIR = fileURLToPath(new URL("../../database/migrations", import.meta.url));
const ROOT = fileURLToPath(new URL("../..", import.meta.url));

let pool: pg.Pool;

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL?.trim(), max: 4 });
  await pool.query("SELECT pg_advisory_lock(727291)");
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    await pool.query(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  await pool.query("SELECT pg_advisory_unlock(727291)");
  await pool.query("DELETE FROM topic_run_log WHERE run_id = 999001");
});

afterAll(async () => {
  await pool.query("DELETE FROM topic_run_log WHERE run_id = 999001");
  await pool.end();
});

function runRecorder(overrides: Record<string, string>) {
  execFileSync(process.execPath, [join(ROOT, "scripts", "record-topic-run.mjs")], {
    env: {
      ...process.env,
      EVENT: "schedule",
      CRON: "30 21 * * *",
      RUN_ID: "999001",
      ATTEMPT: "1",
      RUN_CREATED_AT: "2026-09-16T02:00:00Z", // 4.5h late
      RUN_STARTED_AT: "2026-09-16T02:00:30Z",
      RUN_COMPLETED_AT: "2026-09-16T02:06:00Z",
      TARGET_DATE: "2026-09-17",
      OUTCOME: "curated-fallback",
      RESULT: "pass",
      FRESHNESS: "pass",
      ...overrides,
    },
    stdio: "pipe",
  });
}

d("topic run telemetry recorder (real Postgres)", () => {
  it("stores parsed scheduledFor, delay, duration and freshness", async () => {
    runRecorder({});
    const { rows } = await pool.query(
      `SELECT event, scheduled_for, started_at, completed_at, delay_ms, duration_ms, target_date::text AS target_date, generator_outcome, result, freshness_ok
         FROM topic_run_log WHERE run_id = 999001`,
    );
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.event).toBe("schedule");
    expect(new Date(r.scheduled_for).toISOString()).toBe("2026-09-15T21:30:00.000Z");
    expect(Number(r.delay_ms)).toBe(Date.parse("2026-09-16T02:00:00Z") - Date.parse("2026-09-15T21:30:00Z"));
    expect(Number(r.duration_ms)).toBe(330_000);
    expect(String(r.target_date).slice(0, 10)).toBe("2026-09-17");
    expect(r.generator_outcome).toBe("curated-fallback");
    expect(r.result).toBe("pass");
    expect(r.freshness_ok).toBe(true);
  });

  it("rerunning the same run/attempt updates in place (idempotent telemetry)", async () => {
    runRecorder({});
    runRecorder({ RESULT: "pass", RUN_COMPLETED_AT: "2026-09-16T02:10:00Z" });
    const { rows } = await pool.query("SELECT completed_at, duration_ms FROM topic_run_log WHERE run_id = 999001");
    expect(rows).toHaveLength(1); // upsert, not duplicate
    expect(Number(rows[0].duration_ms)).toBe(570_000);
  });

  it("dispatch runs record no scheduledFor and null delay", async () => {
    runRecorder({ EVENT: "workflow_dispatch", CRON: "" });
    const { rows } = await pool.query("SELECT scheduled_for, delay_ms FROM topic_run_log WHERE run_id = 999001");
    expect(rows[0].scheduled_for).toBeNull();
    expect(rows[0].delay_ms).toBeNull();
  });
});
