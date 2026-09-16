import test from "node:test";
import assert from "node:assert/strict";
import { scheduledForCron } from "../record-topic-run.mjs";

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
