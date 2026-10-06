#!/usr/bin/env node
// Record one topic-generation run into topic_run_log (production DB):
// scheduledFor, runCreatedAt, runStartedAt, completedAt, scheduler delay,
// queue delay, duration, target date, generator result, provider health,
// availability, freshness verdict, final result.
//
// Three dimensions stay SEPARATE (they answer different questions):
//   availability  - did a usable topic land before the deadline?
//   generator     - what produced it (ai | fallback-after-provider-failure |
//                   fallback-by-policy | failure)?
//   provider      - did the AI provider itself behave (success |
//                   invalid-response | timeout | rate-limit | authentication |
//                   quota | other)?
// A green run on a curated fallback is an AVAILABILITY success and a PROVIDER
// failure. Collapsing those into one field would misreport provider health.
//
// Best-effort by design: telemetry must NEVER fail the pipeline it describes.
//
//   DATABASE_URL=... EVENT=schedule CRON="0 20 * * *" RUN_ID=... ATTEMPT=1 \
//   RUN_CREATED_AT=... RUN_STARTED_AT=... TARGET_DATE=... OUTCOME=... \
//   FRESHNESS=pass|fail node scripts/record-topic-run.mjs

import path from "node:path";
import fs from "node:fs";
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

function ms(fromIso, toIso) {
  if (!fromIso || !toIso) return null;
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return b - a;
}

/**
 * Generator result: what actually produced the stored topic.
 * Deliberately NOT the same axis as provider health or availability.
 * `already-present` runs verified rather than generated, so the stored
 * source (the existing row's provenance) decides which generator value the
 * verified content carries.
 */
export function generatorResult(outcome, storedSource = null) {
  const o = (outcome ?? "").trim();
  if (o === "already-present") {
    if (storedSource === "ai") return "ai";
    if (storedSource === "fallback") return "fallback-by-policy";
    return null;
  }
  switch (o) {
    case "ai-generated": return "ai";
    case "provider-failure": return "fallback-after-provider-failure";
    case "curated-fallback": return "fallback-by-policy";
    case "db-failure":
    case "config-failure": return "failure";
    default: return null;
  }
}

/**
 * Provider health, bucketed from the provider error text.
 * Only meaningful when AI generation was attempted; null otherwise so a
 * policy fallback — or a verify-only already-present run — is never
 * miscounted as a provider outage.
 */
export function providerHealth(outcome, errorText) {
  const o = (outcome ?? "").trim();
  if (o === "ai-generated") return "success";
  if (o !== "provider-failure") return null;
  const t = (errorText ?? "").toLowerCase();
  if (!t) return "other";
  if (/timeout|timed out|etimedout|abort/.test(t)) return "timeout";
  if (/429|rate.?limit/.test(t)) return "rate-limit";
  if (/401|403|unauthor|invalid api key|authentication/.test(t)) return "authentication";
  if (/quota|insufficient_quota|budget|exceeded/.test(t)) return "quota";
  if (/json|parse|unexpected token|no topics|no usable topics|empty content|malformed/.test(t)) return "invalid-response";
  return "other";
}

/**
 * Availability: did a topic land in time? The SLO is 'the target date's topic
 * is stored before 03:00 UTC on that date'.
 */
export function availability({ targetDate, freshnessOk, completedAt }) {
  const stored = freshnessOk === true ? true : freshnessOk === false ? false : null;
  let deadlineSatisfied = null;
  if (targetDate && completedAt) {
    const deadline = Date.parse(`${targetDate}T03:00:00Z`);
    const done = Date.parse(completedAt);
    if (Number.isFinite(deadline) && Number.isFinite(done)) deadlineSatisfied = done <= deadline;
  }
  return { topicStored: stored, freshnessValid: freshnessOk ?? null, deadlineSatisfied };
}

/**
 * Bound the per-attempt ledger for database persistence: provider/model
 * identity, outcome, latency, HTTP status and error category — but never raw
 * provider error text (that stays in the workflow artifact). At most 20
 * attempts; malformed entries are dropped, never stored half-parsed.
 */
export function boundProviderAttempts(raw) {
  let parsed = raw;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed)) return null;
  const rows = [];
  for (const a of parsed.slice(0, 20)) {
    if (!a || typeof a !== "object") continue;
    rows.push({
      provider: typeof a.provider === "string" ? a.provider : null,
      model: typeof a.model === "string" ? a.model : "unknown",
      outcome: typeof a.outcome === "string" ? a.outcome : "other",
      latencyMs: typeof a.latencyMs === "number" && Number.isFinite(a.latencyMs) ? Math.round(a.latencyMs) : null,
      httpStatus: typeof a.httpStatus === "number" ? a.httpStatus : null,
      errorCategory: typeof a.errorCategory === "string" ? a.errorCategory : (a.outcome === "success" ? null : (typeof a.outcome === "string" ? a.outcome : "other")),
    });
  }
  return rows;
}

/** Explicit nulls for stages that never ran - never silently drop a field. */
export function telemetryRecord({
  runId, runAttempt, event, cron, scheduledFor, createdAt, startedAt, completedAt,
  schedulerDelayMs, queueDelayMs, durationMs, targetDate, generatorOutcome,
  generator, provider, providerAttempts, topicFingerprint, result, freshnessOk,
}) {
  return {
    runId: runId ?? null,
    runAttempt: runAttempt ?? null,
    event: event ?? null,
    cronSlot: cron ?? null,
    scheduledFor: scheduledFor ?? null,
    actualCreatedAt: createdAt ?? null,
    actualStartedAt: startedAt ?? null,
    schedulerDelayMs: schedulerDelayMs ?? null,
    queueDelayMs: queueDelayMs ?? null,
    completedAt: completedAt ?? null,
    durationMs: durationMs ?? null,
    targetDate: targetDate ?? null,
    generatorOutcome: generatorOutcome ?? null,
    generatorResult: generator ?? null,
    providerHealth: provider ?? null,
    providerAttempts: providerAttempts ?? null,
    topicFingerprint: topicFingerprint ?? null,
    availability: availability({ targetDate, freshnessOk, completedAt }),
    result: result ?? null,
    freshnessOk: freshnessOk ?? null,
  };
}

/**
 * When the database itself is unavailable, the same structured evidence is
 * still emitted to a workflow artifact file so the record is never lost.
 */
function emitFallbackArtifact(record) {
  const outPath = (env.TELEMETRY_FALLBACK_PATH ?? "").trim();
  if (!outPath) return;
  try {
    fs.writeFileSync(outPath, JSON.stringify(record, null, 2) + "\n");
    console.warn(`[record-topic-run] db unavailable - telemetry emitted to artifact: ${outPath}`);
  } catch (e) {
    console.warn(`[record-topic-run] artifact fallback failed: ${String(e?.message ?? e).slice(0, 140)}`);
  }
}

// Columns added by later migrations. Telemetry must keep working on a
// database that has not had them applied yet, so the INSERT is built from
// the columns that actually exist rather than assuming the latest schema.
const OPTIONAL_COLUMNS = [
  ["run_created_at", (r) => r.actualCreatedAt],
  ["queue_delay_ms", (r) => r.queueDelayMs],
  ["generator_result", (r) => r.generatorResult],
  ["provider_health", (r) => r.providerHealth],
  ["topic_fingerprint", (r) => r.topicFingerprint],
  // jsonb columns receive a JSON string (see generate-topics jsonParam).
  ["provider_attempts", (r) => (r.providerAttempts ? JSON.stringify(boundProviderAttempts(r.providerAttempts) ?? []) : null)],
];

const BASE_COLUMNS = [
  ["run_id", (r) => r.runId],
  ["run_attempt", (r) => r.runAttempt],
  ["event", (r) => r.event],
  ["scheduled_for", (r) => r.scheduledFor],
  ["started_at", (r) => r.actualStartedAt],
  ["completed_at", (r) => r.completedAt],
  ["delay_ms", (r) => r.schedulerDelayMs],
  ["duration_ms", (r) => r.durationMs],
  ["target_date", (r) => r.targetDate],
  ["generator_outcome", (r) => r.generatorOutcome],
  ["result", (r) => r.result],
  ["freshness_ok", (r) => r.freshnessOk],
];

/** Columns present on topic_run_log right now. */
export async function existingColumns(query) {
  const rows = await query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'topic_run_log'`,
  );
  return new Set(rows.map((r) => String(r.column_name)));
}

/** Build an upsert over exactly the columns that exist. */
export function buildUpsert(record, columns) {
  const active = [
    ...BASE_COLUMNS,
    ...OPTIONAL_COLUMNS.filter(([name]) => columns.has(name)),
  ];
  const names = active.map(([name]) => name);
  const values = active.map(([, get]) => get(record));
  const placeholders = names.map((_, i) => `$${i + 1}`);
  const updates = names
    .filter((n) => n !== "run_id" && n !== "run_attempt")
    .map((n) => `${n} = EXCLUDED.${n}`);
  return {
    text:
      `INSERT INTO topic_run_log (${names.join(", ")})
       VALUES (${placeholders.join(",")})
       ON CONFLICT (run_id, run_attempt) DO UPDATE SET
         ${updates.join(", ")},
         recorded_at = now()`,
    values,
    columns: names,
  };
}

/** CLI side effects only when run directly - importing (tests) stays inert. */
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  await main();
}

async function main() {
  const databaseUrl = env.DATABASE_URL?.trim();
  const missing = ["EVENT", "RUN_ID", "RESULT"].filter((k) => !(env[k] ?? "").trim());
  if (missing.length) {
    console.warn(`[record-topic-run] skipped (databaseUrl=${Boolean(databaseUrl)} missing=${missing.join(",") || "-"})`);
    return;
  }

  const event = env.EVENT.trim();
  const createdAt = env.RUN_CREATED_AT?.trim() || null;
  const startedAt = env.RUN_STARTED_AT?.trim() || createdAt;
  const completedAt = env.RUN_COMPLETED_AT?.trim() || null;
  const scheduledFor = event === "schedule" ? scheduledForCron(env.CRON ?? "", startedAt ?? createdAt ?? "") : null;
  const outcome = env.OUTCOME?.trim() || null;
  const freshnessOk = env.FRESHNESS === "pass" ? true : env.FRESHNESS === "fail" ? false : null;

  const record = telemetryRecord({
    runId: env.RUN_ID.trim(),
    runAttempt: num(env.ATTEMPT) ?? 1,
    event,
    cron: (env.CRON ?? "").trim() || null,
    scheduledFor,
    createdAt,
    startedAt,
    completedAt,
    // scheduler delay is measured from the scheduled slot to when the runner
    // actually started; queue delay is the platform's own queue time.
    schedulerDelayMs: ms(scheduledFor, startedAt),
    queueDelayMs: ms(createdAt, startedAt),
    durationMs: ms(startedAt, completedAt),
    targetDate: env.TARGET_DATE?.trim() || null,
    generatorOutcome: outcome,
    generator: generatorResult(outcome, env.STORED_SOURCE?.trim() || null),
    topicFingerprint: env.TOPIC_FINGERPRINT?.trim() || null,
    provider: providerHealth(outcome, env.PROVIDER_ERROR),
    providerAttempts: (() => {
      try {
        return env.PROVIDER_ATTEMPTS ? JSON.parse(env.PROVIDER_ATTEMPTS) : null;
      } catch {
        return null;
      }
    })(),
    result: env.RESULT.trim(),
    freshnessOk,
  });

  // A run with no database must still leave the same structured evidence.
  if (!databaseUrl) {
    emitFallbackArtifact(record);
    console.warn("[record-topic-run] skipped (databaseUrl=false missing=-)");
    return;
  }

  const query = await createExecutor(databaseUrl);
  try {
    const columns = await existingColumns(query);
    const upsert = buildUpsert(record, columns);
    await query(upsert.text, upsert.values);
    console.log(
      `[record-topic-run] run ${record.runId} event=${record.event} ` +
      `schedulerDelay=${record.schedulerDelayMs ?? "n/a"}ms queueDelay=${record.queueDelayMs ?? "n/a"}ms ` +
      `generator=${record.generatorResult ?? "n/a"} provider=${record.providerHealth ?? "n/a"} result=${record.result}`,
    );
  } catch (e) {
    console.warn(`[record-topic-run] non-fatal telemetry failure: ${String(e?.message ?? e).slice(0, 140)}`);
    emitFallbackArtifact(record);
  }
  // The shared TCP executor keeps a pooled connection open; this one-shot
  // CLI must exit explicitly or it hangs the caller (workflow step / tests).
  process.exit(0);
}
