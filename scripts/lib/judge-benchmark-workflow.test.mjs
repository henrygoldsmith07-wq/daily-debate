// Every workflow that runs the LIVE judge benchmark must pace provider
// REQUESTS.
//
// Why this is a test and not a comment. On 2026-10-19 the weekly benchmark
// ran `judge-benchmark.mjs --concurrency 3 --enforce` with no pacing at all.
// The request gate exists (it was added on 2026-10-21 and sits inside
// `chat()`, immediately before each fetch) but the workflow never turned it
// on -- PACE_MS defaults to 0, which disables the gate entirely.
//
// The consequence was not a slow run. It was a corrupted record: the
// provider answered 429, a 429 lands in the reliability DENOMINATOR, and the
// artifact published "provider reliability 0.219" for cerebras. The 2026-10-19
// headline numbers were therefore a measurement of the RATE LIMITER, not of
// the judge -- and they were indistinguishable from a judge-quality result.
//
// The same class of failure, the same lesson this repo keeps re-learning: an
// instrument that measures something other than what it claims corrupts the
// record it writes. A rate limiter scored as a judge defect is a mislabelled
// instrument wearing a judge's clothes.
//
// The invariant is stated over the WORKFLOWS, not over one file, so a new
// workflow that runs the live benchmark cannot silently skip the pace either.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKFLOW_DIR = path.join(REPO_ROOT, ".github", "workflows");

/** Every workflow that invokes the live judge benchmark. */
const BENCHMARK_WORKFLOWS = readdirSync(WORKFLOW_DIR)
  .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
  .filter((f) => readFileSync(path.join(WORKFLOW_DIR, f), "utf8").includes("judge-benchmark.mjs"));

/** The `judge-benchmark.mjs ...` invocations in one workflow. */
function benchmarkInvocations(text) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.includes("judge-benchmark.mjs") && !l.startsWith("#"));
}

test("the repo has at least one workflow that runs the live judge benchmark", () => {
  assert.ok(BENCHMARK_WORKFLOWS.length > 0, "expected at least one workflow to run the live judge benchmark");
});

test("every LIVE benchmark invocation paces provider requests", () => {
  for (const file of BENCHMARK_WORKFLOWS) {
    const text = readFileSync(path.join(WORKFLOW_DIR, file), "utf8");
    for (const line of benchmarkInvocations(text)) {
      // --pack-only inspects the fixture pack and makes no provider call, so
      // it needs no pace. Anything else is a LIVE run.
      const live = !line.includes("--pack-only");
      if (!live) continue;
      assert.match(
        line,
        /--pace-ms\s+\d+/,
        `${file}: a live benchmark invocation must pass --pace-ms, or the request gate is off and 429s are scored as judge defects:\n  ${line}`,
      );
    }
  }
});

test("the paced weekly benchmark has a job timeout that can outlast the paced runtime", () => {
  const text = readFileSync(path.join(WORKFLOW_DIR, "judge-benchmark.yml"), "utf8");
  const job = text.slice(text.indexOf("jobs:"));
  const timeout = Number(job.match(/timeout-minutes:\s*(\d+)/)?.[1]);
  assert.ok(Number.isFinite(timeout), "the benchmark job must declare an explicit timeout-minutes");
  // ~936 requests at 15s is ~4h. The timeout must clear that with margin,
  // and must stay under GitHub's 6h ceiling for a hosted runner.
  assert.ok(timeout > 4 * 60, `the benchmark job timeout (${timeout}m) must exceed the paced runtime`);
  assert.ok(timeout <= 360, `the benchmark job timeout (${timeout}m) must stay within GitHub's 6h ceiling`);
});

test("the pace used by the weekly benchmark leaves headroom under the ceiling", () => {
  const text = readFileSync(path.join(WORKFLOW_DIR, "judge-benchmark.yml"), "utf8");
  const pace = Number(text.match(/judge-benchmark\.mjs[^\n]*--pace-ms\s+(\d+)/)?.[1]);
  assert.ok(Number.isFinite(pace) && pace > 0, "the weekly benchmark must declare a pace");
  // Both paceable free tiers here cap at ~300 requests/hour. A pace that
  // exactly equals the ceiling (12000ms = 300/hour) has zero headroom and
  // dies at the window boundary - that is what cost the 2026-10-21 study an
  // arm.
  const requestsPerHour = Math.floor((3600 * 1000) / pace);
  assert.ok(
    requestsPerHour <= 260,
    `the weekly pace (${pace}ms) allows ${requestsPerHour} requests/hour, too close to the ~300/hour ceiling`,
  );
});
