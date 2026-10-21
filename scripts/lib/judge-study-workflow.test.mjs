// Static regression tests for the judge study workflow's RESUMABILITY.
//
// The study is explicitly designed to be resumable across dispatches: a
// long free-tier run is spread over many CI jobs, and each dispatch adds to
// the same seal and the same raw runs. Two defects made that design fail on
// its first real use, and neither was caught by any test:
//
//   1. The persistence step did `git checkout -B "$branch"` with no start
//      point, which resets the branch to the current HEAD (main). A second
//      dispatch therefore committed on top of a DIFFERENT main commit and
//      tried to push a non-fast-forward, which GitHub rejects. Every run the
//      second dispatch had just measured would have been lost - in exactly
//      the case the resumable design exists for.
//   2. The `study_dir` default named one study while the registration named
//      another, so two different studies shared one directory (each with its
//      own registration-snapshot.json) on two different branches.
//
// A third invariant is pinned here because it is the same class of mistake:
// the request pace must sit UNDER the free tier's ceiling. A pace that
// exactly equals the ceiling has zero headroom and fails at the window
// boundary - after the expensive calls have been spent.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKFLOW = readFileSync(path.join(REPO_ROOT, ".github", "workflows", "judge-study.yml"), "utf8");

/** The body of the step named `name`, without YAML comment lines. */
function stepBody(name) {
  const lines = WORKFLOW.split("\n");
  const start = lines.findIndex((l) => l.includes(`- name: ${name}`));
  assert.ok(start >= 0, `workflow must have a step named "${name}"`);
  // Find the run: | block that holds the step's script.
  const runAt = lines.findIndex((l, i) => i > start && /^\s*run:\s*\|\s*$/.test(l));
  assert.ok(runAt > start, `step "${name}" must have a run: | block`);
  const indent = (lines[runAt].match(/^\s*/) ?? [""])[0].length + 2;
  const body = [];
  for (let i = runAt + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") { body.push(""); continue; }
    const lineIndent = (line.match(/^\s*/) ?? [""])[0].length;
    if (lineIndent < indent) break;
    body.push(line.slice(indent));
  }
  return body.join("\n");
}

test("the persistence step builds on the branch tip, so a second dispatch is a fast-forward", () => {
  const body = stepBody("Persist study state on the runs branch");
  // The branch must be created FROM the remote tip when one exists. A bare
  // `git checkout -B "$branch"` resets to HEAD (main) and produces a
  // non-fast-forward push on the next dispatch.
  assert.match(
    body,
    /git checkout -B "\$branch" "origin\/\$branch"/,
    `the persistence step must build the branch on origin/$branch when it exists:\n${body}`,
  );
  assert.match(
    body,
    /git fetch origin "\$branch"/,
    `the persistence step must fetch the branch tip before building on it:\n${body}`,
  );
  assert.match(
    body,
    /ls-remote --exit-code --heads origin "\$branch"/,
    `the persistence step must detect an existing branch before choosing a base:\n${body}`,
  );
});

test("the study directory default matches the registration the workflow defaults to", () => {
  const registrationDefault = WORKFLOW.match(/registration:\s*\n\s*description:[^\n]*\n\s*required:[^\n]*\n\s*default:\s*"([^"]+)"/)?.[1];
  const studyDirDefault = WORKFLOW.match(/study_dir:\s*\n\s*description:[^\n]*\n\s*required:[^\n]*\n\s*default:\s*"([^"]+)"/)?.[1];
  assert.ok(registrationDefault, "the workflow must declare a default registration");
  assert.ok(studyDirDefault, "the workflow must declare a default study_dir");
  const registrationSlug = path.basename(registrationDefault, ".json");
  assert.equal(
    path.basename(studyDirDefault),
    `study-${registrationSlug}`,
    `study_dir (${studyDirDefault}) must be named after the default registration (${registrationDefault}); ` +
      "two studies sharing one directory is how a seal from one gets read as the other's",
  );
});

test("the request pace leaves headroom under the free tier's ceiling", () => {
  const paceDefault = Number(WORKFLOW.match(/pace_ms:\s*\n\s*description:[^\n]*\n\s*required:[^\n]*\n\s*default:\s*"(\d+)"/)?.[1]);
  assert.ok(Number.isFinite(paceDefault) && paceDefault > 0, "the workflow must declare a pace default");
  // cerebras's free tier answers 429 "Requests per hour limit exceeded" at
  // roughly 300 requests/hour. A pace of exactly 12000ms is exactly
  // 300/hour - zero headroom, and it fails at the window boundary.
  const requestsPerHour = Math.floor((3600 * 1000) / paceDefault);
  assert.ok(
    requestsPerHour <= 260,
    `the default pace (${paceDefault}ms) allows ${requestsPerHour} requests/hour; ` +
      "that is too close to the ~300/hour ceiling to survive a window boundary",
  );
});

test("the study step is capped below the job so the state can still be persisted", () => {
  const stepMinutes = Number(WORKFLOW.match(/Run the registered study[\s\S]*?timeout-minutes:\s*(\d+)/)?.[1]);
  const jobMinutes = Number(WORKFLOW.match(/^\s{4}timeout-minutes:\s*(\d+)/m)?.[1]);
  assert.ok(Number.isFinite(stepMinutes) && Number.isFinite(jobMinutes), "both timeouts must be declared");
  assert.ok(
    stepMinutes < jobMinutes,
    `the study step (${stepMinutes}m) must stop before the job (${jobMinutes}m) so the persistence step still runs`,
  );
});
