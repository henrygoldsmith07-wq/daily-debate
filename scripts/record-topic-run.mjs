#!/usr/bin/env node
// Record one topic-generation run into topic_run_log (production DB):
// scheduledFor (from the cron slot that fired), actualStart, delay,
// duration, target date, generator outcome, freshness verdict, result.
// Best-effort by design: telemetry must NEVER fail the pipeline it
// describes - a missing DATABASE_URL or DB error exits 0 with a warning.
//
//   DATABASE_URL=... EVENT=schedule CRON="0 20 * * *" RUN_ID=... ATTEMPT=1 \
//   RUN_STARTED_AT=... RUN_CREATED_AT=... TARGET_DATE=... OUTCOME=... \
//   FRESHNESS=pass|fail node scripts/record-topic-run.mjs

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createExecutor } from "./lib/sql-executor.mjs";

const env = process.env;

/** Most recent UTC occurrence of a daily "M H * * *" cron strictly <= now. */
export function scheduledForCron(cron, nowIso) {
  const m = /^(\d+)\s+(\d+)\s+\*\s+\*\s+\*/.exec(cron ?? "");
  if (!m) return null;
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now)) return null;
  for (const offsetDays of [0, 1, 2]) {
    const d = new Date(now - offsetDays * 86_400_000);
    d.setUTCHours(Number(m[2]), Number(m[1]), 0, 0);
    if (d.getTime() <= now) return d.toISOString();
  }
  return null;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** CLI side effects only when run directly - importing (tests) stays inert. */
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  await main();
}

async function main() {
  const databaseUrl = env.DATABASE_URL?.trim();
  const missing = ["EVENT", "RUN_ID", "RUN_CREATED_AT", "RESULT"].filter((k) => !(env[k] ?? "").trim());
  if (!databaseUrl || missing.length) {
    console.warn(`[record-topic-run] skipped (databaseUrl=${Boolean(databaseUrl)} missing=${missing.join(",") || "-"})`);
    return;
  }

  const event = env.EVENT.trim();
  const createdAt = env.RUN_CREATED_AT.trim();
  const scheduledFor = event === "schedule" ? scheduledForCron(env.CRON ?? "", createdAt) : null;
  const delayMs = scheduledFor ? Date.parse(createdAt) - Date.parse(scheduledFor) : null;
  const completedAt = env.RUN_COMPLETED_AT?.trim() || null;
  const startedAt = (env.RUN_STARTED_AT ?? createdAt).trim();
  const durationMs = completedAt && startedAt ? Date.parse(completedAt) - Date.parse(startedAt) : null;

  const query = await createExecutor(databaseUrl);
  try {
    await query(
      `INSERT INTO topic_run_log
         (run_id, run_attempt, event, scheduled_for, started_at, completed_at, delay_ms,
          duration_ms, target_date, generator_outcome, result, freshness_ok)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (run_id, run_attempt) DO UPDATE SET
         event = EXCLUDED.event,
         scheduled_for = EXCLUDED.scheduled_for,
         delay_ms = EXCLUDED.delay_ms,
         completed_at = EXCLUDED.completed_at,
         duration_ms = EXCLUDED.duration_ms,
         target_date = EXCLUDED.target_date,
         generator_outcome = EXCLUDED.generator_outcome,
         result = EXCLUDED.result,
         freshness_ok = EXCLUDED.freshness_ok,
         recorded_at = now()`,
      [
        env.RUN_ID.trim(),
        num(env.ATTEMPT) ?? 1,
        event,
        scheduledFor,
        createdAt,
        completedAt,
        delayMs,
        durationMs,
        env.TARGET_DATE?.trim() || null,
        env.OUTCOME?.trim() || null,
        env.RESULT.trim(),
        env.FRESHNESS === "pass" ? true : env.FRESHNESS === "fail" ? false : null,
      ],
    );
    console.log(`[record-topic-run] run ${env.RUN_ID} event=${event} delay=${delayMs ?? "n/a"}ms result=${env.RESULT}`);
  } catch (e) {
    console.warn(`[record-topic-run] non-fatal telemetry failure: ${String(e?.message ?? e).slice(0, 140)}`);
  }
  // The shared TCP executor keeps a pooled connection open; this one-shot
  // CLI must exit explicitly or it hangs the caller (workflow step / tests).
  process.exit(0);
}
