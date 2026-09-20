import test from "node:test";
import assert from "node:assert/strict";
import {
  availability,
  buildUpsert,
  generatorResult,
  providerHealth,
  scheduledForCron,
  telemetryRecord,
} from "../record-topic-run.mjs";

test("scheduledForCron resolves the most recent daily slot strictly <= now", () => {
  // 21:30 slot, run started 02:00Z the next day: last occurrence is yesterday 21:30.
  assert.equal(scheduledForCron("30 21 * * *", "2026-09-16T02:00:00Z"), "2026-09-15T21:30:00.000Z");
  // same-day slot already passed: today's occurrence
  assert.equal(scheduledForCron("0 20 * * *", "2026-09-16T22:00:00Z"), "2026-09-16T20:00:00.000Z");
  // slot later today: yesterday's occurrence
  assert.equal(scheduledForCron("40 23 * * *", "2026-09-16T00:10:00Z"), "2026-09-15T23:40:00.000Z");
  // exactly at the slot counts (<=)
  assert.equal(scheduledForCron("0 20 * * *", "2026-09-16T20:00:00Z"), "2026-09-16T20:00:00.000Z");
  // non-daily patterns are unsupported -> null (never a wrong guess)
  assert.equal(scheduledForCron("*/5 * * * *", "2026-09-16T20:00:00Z"), null);
  assert.equal(scheduledForCron("", "2026-09-16T20:00:00Z"), null);
});

test("scheduler delay is the start minus the slot, never negative here", () => {
  const slot = Date.parse(scheduledForCron("0 20 * * *", "2026-09-16T23:45:00Z"));
  const delay = Date.parse("2026-09-16T23:45:00Z") - slot;
  assert.equal(delay, 3 * 3_600_000 + 45 * 60_000);
});

/**
 * The retry ladder must keep measuring delay from the CORRECT slot: a run
 * that fires late still belongs to the slot that triggered it.
 */
test("each retry-ladder slot resolves to its own scheduledFor", () => {
  const slots = ["0 20 * * *", "30 21 * * *", "45 22 * * *", "40 23 * * *", "15 0 * * *", "15 2 * * *"];
  const fired = [
    "2026-09-16T20:00:00Z",
    "2026-09-16T21:30:00Z",
    "2026-09-16T22:45:00Z",
    "2026-09-16T23:40:00Z",
    "2026-09-17T00:15:00Z",
    "2026-09-17T02:15:00Z",
  ];
  slots.forEach((cron, i) => {
    assert.equal(scheduledForCron(cron, fired[i]), new Date(fired[i]).toISOString(), `slot ${i} (${cron})`);
  });
});

test("generatorResult keeps AI, policy fallback, provider fallback and failure apart", () => {
  assert.equal(generatorResult("ai-generated"), "ai");
  assert.equal(generatorResult("provider-failure"), "fallback-after-provider-failure");
  assert.equal(generatorResult("curated-fallback"), "fallback-by-policy");
  assert.equal(generatorResult("db-failure"), "failure");
  assert.equal(generatorResult("config-failure"), "failure");
  assert.equal(generatorResult(""), null);
  assert.equal(generatorResult(null), null);
});

test("a green run on a curated fallback is an availability success, not provider health", () => {
  // The exact production situation: provider failed, fallback stored, run green.
  assert.equal(providerHealth("provider-failure", "Nemotron 3.5 Lightning timeout"), "timeout");
  assert.equal(providerHealth("provider-failure", "429 rate limited"), "rate-limit");
  assert.equal(providerHealth("provider-failure", "Unexpected token } in JSON"), "invalid-response");
  assert.equal(providerHealth("provider-failure", "401 Unauthorized"), "authentication");
  assert.equal(providerHealth("provider-failure", "insufficient_quota exceeded"), "quota");
  assert.equal(providerHealth("provider-failure", "socket hang up"), "other");
  assert.equal(providerHealth("ai-generated", null), "success");
  // No provider was attempted: provider health is genuinely unknown, NOT a failure.
  assert.equal(providerHealth("curated-fallback", null), null);
  assert.equal(providerHealth(null, null), null);
});

test("availability separates stored, fresh and deadline-satisfied", () => {
  assert.deepEqual(
    availability({ targetDate: "2026-09-17", freshnessOk: true, completedAt: "2026-09-17T02:50:00Z" }),
    { topicStored: true, freshnessValid: true, deadlineSatisfied: true },
  );
  // Green write, but after the 03:00 UTC deadline: stored yet late.
  assert.deepEqual(
    availability({ targetDate: "2026-09-17", freshnessOk: true, completedAt: "2026-09-17T03:30:00Z" }),
    { topicStored: true, freshnessValid: true, deadlineSatisfied: false },
  );
  assert.deepEqual(
    availability({ targetDate: "2026-09-17", freshnessOk: false, completedAt: "2026-09-17T01:00:00Z" }),
    { topicStored: false, freshnessValid: false, deadlineSatisfied: true },
  );
  // A stage that never ran stays null rather than being asserted either way.
  assert.deepEqual(
    availability({ targetDate: null, freshnessOk: null, completedAt: null }),
    { topicStored: null, freshnessValid: null, deadlineSatisfied: null },
  );
});

test("telemetryRecord uses explicit nulls for stages that never executed", () => {
  const record = telemetryRecord({
    runId: "1", runAttempt: 1, event: "schedule", cron: "15 0 * * *",
    scheduledFor: "2026-09-17T00:15:00Z", createdAt: "2026-09-17T04:48:49Z",
    startedAt: "2026-09-17T04:48:49Z", completedAt: "2026-09-17T04:50:12Z",
    schedulerDelayMs: 16_429_000, queueDelayMs: 0, durationMs: 83_000,
    targetDate: null, generatorOutcome: null, generator: null, provider: null,
    providerAttempts: null, result: "failure", freshnessOk: null,
  });
  assert.equal(record.targetDate, null);
  assert.equal(record.generatorResult, null);
  assert.equal(record.providerHealth, null);
  assert.equal(record.freshnessOk, null);
  // The run identity and delays survive even when later stages never ran.
  assert.equal(record.runId, "1");
  assert.equal(record.schedulerDelayMs, 16_429_000);
  assert.equal(record.queueDelayMs, 0);
  assert.deepEqual(record.availability, { topicStored: null, freshnessValid: null, deadlineSatisfied: null });
});

test("the upsert targets the base schema when no migration has been applied", () => {
  const record = telemetryRecord({ runId: "1", runAttempt: 1, event: "schedule", result: "failure" });
  const base = buildUpsert(record, new Set(["run_id", "run_attempt", "event", "result"]));
  assert.deepEqual(base.columns, [
    "run_id", "run_attempt", "event", "scheduled_for", "started_at", "completed_at",
    "delay_ms", "duration_ms", "target_date", "generator_outcome", "result", "freshness_ok",
  ]);
  assert.equal(base.values.length, base.columns.length);
  // Never updates the conflict key, and always refreshes recorded_at.
  assert.ok(!base.text.includes("run_id = EXCLUDED"));
  assert.ok(base.text.includes("recorded_at = now()"));
});

test("the upsert adds the telemetry columns once the migration is applied", () => {
  const record = telemetryRecord({
    runId: "1", runAttempt: 1, event: "schedule", result: "pass",
    createdAt: "2026-09-17T00:15:00Z", startedAt: "2026-09-17T00:15:30Z",
    queueDelayMs: 30_000, generator: "fallback-after-provider-failure", provider: "timeout",
  });
  const migrated = buildUpsert(record, new Set([
    "run_id", "run_attempt", "event", "result",
    "run_created_at", "queue_delay_ms", "generator_result", "provider_health",
  ]));
  for (const col of ["run_created_at", "queue_delay_ms", "generator_result", "provider_health"]) {
    assert.ok(migrated.columns.includes(col), `${col} should be populated once present`);
  }
  // Placeholders stay positional and in step with the values.
  assert.equal(migrated.values.length, migrated.columns.length);
  migrated.columns.forEach((_, i) => assert.ok(migrated.text.includes(`$${i + 1}`)));
});
