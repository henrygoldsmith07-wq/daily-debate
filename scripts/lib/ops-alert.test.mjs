import test from "node:test";
import assert from "node:assert/strict";
import { decideOpsAlert } from "./ops-alert.mjs";

const NOW = "2026-09-16T12:00:00Z";
const okProofs = { manualSuccess: true, scheduledSuccessAfterManual: true, idempotenceRerun: true, onTimeBeforeDeadline: true };

const healthy = (over = {}) => ({
  runs: [{ event: "schedule", status: "completed", conclusion: "success", createdAt: "2026-09-16T02:00:00Z" }],
  telemetry: [{ event: "schedule", at: "2026-09-16T02:00:00Z", result: "success", targetDate: "2026-09-17" }],
  availability: { state: "ready", note: null },
  dbReadable: true,
  proofs: okProofs,
  latestConfigCheck: { ok: true, reason: "ok" },
  nowIso: NOW,
  ...over,
});

test("fully healthy inputs raise no alert", () => {
  assert.equal(decideOpsAlert(healthy()), null);
});

test("consecutive scheduled failures escalate to critical", () => {
  const d = decideOpsAlert(healthy({
    runs: [
      { event: "schedule", status: "completed", conclusion: "failure", createdAt: "2026-09-16T02:00:00Z" },
      { event: "schedule", status: "completed", conclusion: "failure", createdAt: "2026-09-15T02:00:00Z" },
    ],
  }));
  assert.equal(d.alert, true);
  assert.equal(d.severity, "critical");
  assert.ok(d.facts.some((f) => f.includes("2 consecutive scheduled failures")));
});

test("missed deadline and unreadable store are critical", () => {
  for (const avail of [{ state: "missed-deadline", note: "S1 BREACH" }, { state: "invalid", note: null }]) {
    const d = decideOpsAlert(healthy({ availability: avail }));
    assert.equal(d.severity, "critical", avail.state);
  }
  const unreadable = decideOpsAlert(healthy({ dbReadable: false, availability: { state: "unknown", note: null } }));
  assert.equal(unreadable.severity, "critical");
});

test("failed config gate is critical and names the reason", () => {
  const d = decideOpsAlert(healthy({
    latestConfigCheck: { ok: false, reason: "config-failure: DATABASE_URL is required" },
  }));
  assert.equal(d.severity, "critical");
  assert.ok(d.facts.some((f) => f.includes("DATABASE_URL")));
});

test("missing proofs and unknown availability warn without going critical", () => {
  const d = decideOpsAlert(healthy({
    proofs: { ...okProofs, manualSuccess: false, idempotenceRerun: false },
    availability: { state: "pending-before-deadline", note: null },
  }));
  assert.equal(d.alert, true);
  assert.equal(d.severity, "warning");
  assert.ok(d.facts.some((f) => f.includes("manualSuccess, idempotenceRerun")));
});

test("unavailable sources (null sections) warn instead of passing silently", () => {
  const d = decideOpsAlert(healthy({ availability: null, proofs: null, runs: [], telemetry: [] }));
  assert.equal(d.alert, true);
  assert.equal(d.severity, "warning");
  assert.ok(d.facts.length >= 3);
});

test("stale scheduler (36h stall) warns", () => {
  const d = decideOpsAlert(healthy({
    runs: [{ event: "schedule", status: "completed", conclusion: "success", createdAt: "2026-09-14T00:00:00Z" }],
  }));
  assert.equal(d.severity, "warning");
  assert.ok(d.facts.some((f) => f.includes("stall detector")));
});

// --- probe unavailable mapping (digest maps a missing probe to nulls) -----

const probeUnavailable = (over = {}) =>
  healthy({ availability: null, proofs: null, dbReadable: true, telemetry: [], ...over });

test("unavailable probe warns and never claims an unreadable store", () => {
  const d = decideOpsAlert(probeUnavailable());
  assert.equal(d.alert, true);
  assert.equal(d.severity, "warning");
  assert.ok(d.facts.some((f) => f.includes("availability: state unknown")));
  assert.ok(d.facts.some((f) => f.includes("proofs: unavailable")));
  assert.ok(!d.facts.some((f) => f.includes("UNREADABLE")));
});

test("unavailable probe plus scheduler failures still escalates to critical", () => {
  const d = decideOpsAlert(probeUnavailable({
    runs: [
      { event: "schedule", status: "completed", conclusion: "failure", createdAt: "2026-09-16T02:00:00Z" },
      { event: "schedule", status: "completed", conclusion: "failure", createdAt: "2026-09-15T02:00:00Z" },
      { event: "schedule", status: "completed", conclusion: "failure", createdAt: "2026-09-14T02:00:00Z" },
    ],
  }));
  assert.equal(d.severity, "critical");
  assert.ok(d.facts.some((f) => f.includes("3 consecutive scheduled failures")));
});

test("config-gate suspect survives when only run history exists (probe down)", () => {
  const d = decideOpsAlert(probeUnavailable({
    latestConfigCheck: { ok: false, reason: "scheduled run 2026-09-16T02:00:00Z failed with no later successful run — the config/db gate (DATABASE_URL secret, connectivity, migrations) is the prime suspect" },
  }));
  assert.equal(d.severity, "critical");
  assert.ok(d.facts.some((f) => f.includes("config/db gate")));
});
