// Regression tests for operational evidence assembly.
//
// The successful production run logged `target=null source=null evidence=null`
// while the source files plainly contained the values: the inline `jq` read
// nested paths (`.generator.date`, `.freshness.checks.evidenceCards`) that
// only exist in the *assembled* summary, never in the generator/verifier
// files themselves. These tests fail if that mapping regresses.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { REQUIRED_FIELDS, buildEvidence, summarize } from "../topic-run-evidence.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Real shapes, taken from the artifacts of a green production run.
const GENERATOR = {
  outcome: "ai-generated",
  source: "ai",
  date: "2026-09-20",
  title: "Should governments ban facial recognition in public spaces?",
  evidenceCards: 3,
  fingerprint: "9f".repeat(32),
};
const FRESHNESS = {
  ok: true,
  targetDate: "2026-09-20",
  provenance: "valid",
  checks: { evidenceCards: 3, topicRows: 1, evidenceRows: 3 },
};

const RUN = { runId: "35490078613", runAttempt: "1", runType: "schedule", startedAt: "2026-09-20T04:48:49Z" };

test("a valid run reports every required field, never null", () => {
  const evidence = buildEvidence({ generator: GENERATOR, freshness: FRESHNESS, ...RUN });
  for (const field of REQUIRED_FIELDS) {
    assert.notEqual(evidence[field], null, `${field} must not be null when the source files carry a value`);
  }
  assert.equal(evidence.targetDate, "2026-09-20");
  assert.equal(evidence.source, "ai");
  assert.equal(evidence.evidenceCards, 3);
});

test("the human-readable summary prints real values, not null", () => {
  const line = summarize(buildEvidence({ generator: GENERATOR, freshness: FRESHNESS, ...RUN }));
  assert.ok(!line.includes("null"), `summary must not contain null: ${line}`);
  assert.ok(line.includes("target=2026-09-20"), line);
  assert.ok(line.includes("source=ai"), line);
  assert.ok(line.includes("evidence=3"), line);
});

test("the old nested jq paths would have yielded null (guards the exact defect)", () => {
  // Documents WHY the mapping is shaped the way it is: the previous step read
  // these paths from these very files and got null for all three.
  assert.equal(GENERATOR.generator, undefined);
  assert.equal(GENERATOR.freshness, undefined);
  assert.equal(FRESHNESS.freshness, undefined);
  // ...while the assembler recovers the real values from the flat fields.
  const evidence = buildEvidence({ generator: GENERATOR, freshness: FRESHNESS, ...RUN });
  assert.equal(evidence.targetDate, GENERATOR.date);
  assert.equal(evidence.source, GENERATOR.source);
  assert.equal(evidence.evidenceCards, FRESHNESS.checks.evidenceCards);
});

test("the verifier's evidence count is authoritative when both sources report one", () => {
  const evidence = buildEvidence({
    generator: { ...GENERATOR, evidenceCards: 9 },
    freshness: FRESHNESS,
    ...RUN,
  });
  assert.equal(evidence.evidenceCards, FRESHNESS.checks.evidenceCards);
});

test("exact scheduler-slot witness fields preserve the TRUE trigger, not a nearest-slot guess", () => {
  // The 20:00 slot whose run was created at 22:05: a nearest-clock-slot
  // witness would report 35 min (against 21:30); the artifact records the
  // exact scheduled slot, so the true 125-min delay survives.
  const evidence = buildEvidence({
    generator: GENERATOR,
    freshness: FRESHNESS,
    ...RUN,
    cron: "0 20 * * *",
    scheduledFor: "2026-09-20T20:00:00Z",
    runCreatedAt: "2026-09-20T22:05:00Z",
    startedAt: "2026-09-20T22:05:30Z",
  });
  assert.equal(evidence.cronSlot, "0 20 * * *");
  assert.equal(evidence.scheduledFor, "2026-09-20T20:00:00Z");
  assert.equal(evidence.actualCreatedAt, "2026-09-20T22:05:00Z");
  assert.equal(evidence.actualStartedAt, "2026-09-20T22:05:30Z");
  assert.equal(evidence.schedulerDelayMs, 2 * 3_600_000 + 5 * 60_000 + 30_000); // 125.5 min
  // The nearest-slot inference would have claimed 35 min (21:30 slot); the
  // artifact preserves the TRUE 125-min delay against the 20:00 slot.
  assert.ok(evidence.schedulerDelayMs > 90 * 60_000, "the missed-start threshold would have been visible");
});

test("slot witness fields stay null (never guessed) when the workflow did not provide them", () => {
  const evidence = buildEvidence({ generator: GENERATOR, freshness: FRESHNESS, ...RUN });
  assert.equal(evidence.cronSlot, null);
  assert.equal(evidence.scheduledFor, null);
  assert.equal(evidence.schedulerDelayMs, null);
});

test("a stage that never ran degrades to explicit nulls without throwing", () => {
  const evidence = buildEvidence({ generator: null, freshness: null, ...RUN });
  assert.equal(evidence.targetDate, null);
  assert.equal(evidence.source, null);
  assert.equal(evidence.evidenceCards, null);
  // The run identity is still recorded: a failed run is never a lost record.
  assert.equal(evidence.runId, "35490078613");
  assert.equal(evidence.runType, "schedule");
});

test("a partial run keeps the stages that did execute", () => {
  // Generation died before the verifier ran: target/source are known, the
  // freshness count legitimately stays null.
  const evidence = buildEvidence({ generator: { outcome: "db-failure", source: "fallback", date: "2026-09-20" }, freshness: null, ...RUN });
  assert.equal(evidence.targetDate, "2026-09-20");
  assert.equal(evidence.source, "fallback");
  assert.equal(evidence.evidenceCards, null);
});

test("the workflow no longer reads nested paths from the flat source files", () => {
  const wf = readFileSync(path.join(REPO_ROOT, ".github", "workflows", "topic-generation.yml"), "utf8");
  for (const broken of [".generator.date", ".generator.source", ".freshness.checks.evidenceCards"]) {
    assert.ok(!wf.includes(broken), `topic-generation.yml still reads the broken path ${broken}`);
  }
  assert.ok(
    wf.includes("scripts/topic-run-evidence.mjs"),
    "topic-generation.yml must assemble evidence through the tested script",
  );
});

test("the CLI body runs in THIS checkout - the URL-isMain guard can never silently no-op again", () => {
  // A hand-built file:// template cannot match a percent-encoded absolute
  // path (a space in the checkout path) or a Windows drive letter; the older
  // guard failed in exactly that case: exit 0, no output, no evidence file.
  // Spawn the real script the way the workflow does and require PROOF the
  // body executed (output on stdout or stderr - evidence assembly is a
  // diagnostic and never exits non-zero).
  const parent = mkdirSync(path.join(os.tmpdir(), `tre-cli-${Date.now()}-${process.pid}`), { recursive: true });
  const evidencePath = path.join(parent, "topic-run-evidence.json");
  const res = spawnSync(process.execPath, ["scripts/topic-run-evidence.mjs"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, EVIDENCE_PATH: evidencePath },
  });
  try {
    assert.equal(res.status, 0, `stderr: ${res.stderr}`);
    const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
    assert.ok(
      out.trim().length > 0,
      `the CLI body must produce output in this checkout (otherwise the isMain guard failed to match again) - got stdout=${JSON.stringify(res.stdout)} stderr=${JSON.stringify(res.stderr)}`,
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
