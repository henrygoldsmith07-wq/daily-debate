// Regression 2026-11-16: every scheduled benchmark died before its first
// provider call with "ReferenceError: Cannot access 'effectivePaceMs' before
// initialization". The startup log named the variable above its `let`
// declaration, so no run could ever produce an artifact. Guard the ordering
// in source: a live benchmark must at least be able to start.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = readFileSync(path.join(REPO_ROOT, "scripts", "judge-benchmark.mjs"), "utf8");

test("the startup pace log comes after effectivePaceMs is declared", () => {
  const declaredAt = cli.indexOf("let effectivePaceMs =");
  const loggedAt = cli.indexOf("paceMs=${effectivePaceMs}");
  assert.ok(declaredAt > -1, "effectivePaceMs declaration not found in the benchmark CLI");
  assert.ok(loggedAt > -1, "startup pace log not found in the benchmark CLI");
  assert.ok(
    loggedAt > declaredAt,
    "the startup log must follow `let effectivePaceMs`, or a live run throws a TDZ ReferenceError before any judge call",
  );
});
