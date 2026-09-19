// Static regression tests for GitHub Actions output wiring.
//
// The topic-generation workflow mixes valid and invalid GitHub Actions output
// syntax. These tests scan the workflows so invalid output references cannot
// silently return:
//
//   1. every `steps.<id>.<prop>` reference must use a supported property
//      (outputs / outcome / conclusion) - `steps.gen.outcome` and
//      `steps.gen.target` are the invalid forms that silently expand to empty;
//   2. `github.run_created_at` is NOT a supported Actions context field and
//      must never return (use github.run_started_at);
//   3. every `steps.<id>.outputs.<key>` reference must match a key that step
//      actually emits (declared `outputs:` names or GITHUB_OUTPUT echo lines);
//   4. the fresh verifier must consume the exact target the generator emits
//      (steps.gen.outputs.target) and a YYYY-MM-DD guard must precede it.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKFLOWS = ["topic-generation.yml", "daily-debate.yml", "judge-benchmark.yml"]
  .map((f) => ({ name: f, text: readFileSync(path.join(REPO_ROOT, ".github", "workflows", f), "utf8") }));

const SUPPORTED_STEP_PROPS = ["outputs", "outcome", "conclusion"];
const GITHUB_CONTEXT_KEYS = new Set([
  "event_name", "event_path", "event", "run_id", "run_number", "run_attempt",
  "repository", "repository_owner", "sha", "ref", "ref_name", "ref_type", "ref_protected",
  "workflow", "workflow_ref", "workflow_sha", "head_ref", "base_ref", "job", "job_status",
  "action", "action_path", "action_ref", "action_repository", "actor", "api_url",
  "graphql_url", "server_url", "workspace", "retention_days", "triggering_actor",
  "token", "path", "env", "schedule",
]);

/** Strip YAML comment lines (a # preceded by whitespace or line start). */
function withoutComments(text) {
  return text.replace(/(^|\n)(\s*#[^\n]*)/g, "$1");
}

/** All GITHUB_OUTPUT keys a step emits, from `echo "key=..." >> "$GITHUB_OUTPUT"`. */
function emittedOutputKeys(text) {
  const keys = new Set();
  for (const m of text.matchAll(/(?:^|\n)\s*(?:echo\s+)?["']?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*.*?\$\{\{[^}]*\}\}.*?"?\s*>>\s*["']?\$GITHUB_OUTPUT["']?/g)) {
    keys.add(m[1]);
  }
  // Simpler, robust fallback for the common one-line form.
  for (const m of text.matchAll(/(?:echo\s+)?["']?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*.*?>>\s*["']?\$GITHUB_OUTPUT["']?/g)) {
    keys.add(m[1]);
  }
  return keys;
}

test("no unsupported step properties are referenced (steps.gen.target / steps.gen.outcome)", () => {
  for (const wf of WORKFLOWS) {
    for (const m of withoutComments(wf.text).matchAll(/steps\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)/g)) {
      const [, stepId, prop] = m;
      assert.ok(
        SUPPORTED_STEP_PROPS.includes(prop),
        `${wf.name}: steps.${stepId}.${prop} is not a supported step property (use steps.${stepId}.outputs.${prop} for output keys, or steps.${stepId}.outcome / .conclusion for step state)`,
      );
    }
  }
});

test("github.run_created_at is never referenced (unsupported context field)", () => {
  for (const wf of WORKFLOWS) {
    assert.ok(
      !withoutComments(wf.text).includes("github.run_created_at"),
      `${wf.name}: github.run_created_at is not a supported GitHub context field (use github.run_started_at and document it as observed start)`,
    );
  }
});

test("all referenced github.<key> context fields are actually supported", () => {
  for (const wf of WORKFLOWS) {
    for (const m of withoutComments(wf.text).matchAll(/(?<![:/.])github\.([A-Za-z0-9_]+)/g)) {
      const key = m[1];
      assert.ok(
        GITHUB_CONTEXT_KEYS.has(key),
        `${wf.name}: github.${key} is not a known supported GitHub Actions context field`,
      );
    }
  }
});

test("every steps.<id>.outputs.<key> reference matches a key the step actually emits", () => {
  for (const wf of WORKFLOWS) {
    const clean = withoutComments(wf.text);
    const emitted = emittedOutputKeys(clean);
    for (const m of clean.matchAll(/steps\.([A-Za-z0-9_-]+)\.outputs\.([A-Za-z0-9_-]+)/g)) {
      const [, stepId, key] = m;
      assert.ok(
        emitted.has(key),
        `${wf.name}: steps.${stepId}.outputs.${key} references an output the step does not emit (emitted keys: ${[...emitted].join(", ") || "-"})`,
      );
    }
  }
});

test("job-level outputs must reference step outputs, not step properties", () => {
  for (const wf of WORKFLOWS) {
    const outputsBlock = withoutComments(wf.text).match(/\n\s+outputs:\n((?:\s+[^\n]*\n)*)/);
    if (!outputsBlock) continue;
    for (const m of outputsBlock[1].matchAll(/\$\{\{\s*steps\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_.-]+)\s*\}\}/g)) {
      const [, stepId, ref] = m;
      assert.ok(
        ref.startsWith("outputs.") || ref === "outcome" || ref === "conclusion",
        `${wf.name}: job output references steps.${stepId}.${ref} (must be steps.${stepId}.outputs.<key>, .outcome, or .conclusion)`,
      );
    }
  }
});

test("the freshness verifier consumes the exact generated target with a YYYY-MM-DD guard", () => {
  const wf = WORKFLOWS.find((w) => w.name === "topic-generation.yml");
  const verifyIdx = wf.text.indexOf("verify-topic-stored.mjs");
  assert.ok(verifyIdx !== -1, "topic-generation.yml must run the freshness verifier");
  const verifySection = wf.text.slice(0, verifyIdx);
  const guardIdx = verifySection.lastIndexOf("YYYY-MM-DD");
  const targetRef = wf.text.match(/TARGET:\s*\$\{\{\s*steps\.gen\.outputs\.([A-Za-z0-9_-]+)\s*\}\}/);
  assert.ok(targetRef, "the verifier must consume steps.gen.outputs.target");
  assert.equal(targetRef[1], "target", `the verifier must consume the exact emitted output key 'target', got '${targetRef[1]}'`);
  assert.ok(guardIdx !== -1, "a YYYY-MM-DD target guard must precede the verifier invocation");
  // The guard must actually reject (a conditional that exits before the verifier).
  const afterGuard = wf.text.slice(guardIdx);
  const exitIdx = afterGuard.indexOf("exit 1");
  assert.ok(exitIdx !== -1, "the guard must exit on a malformed target");
  assert.ok(exitIdx < wf.text.slice(guardIdx).indexOf("verify-topic-stored.mjs"), "the guard must reject before the verifier is invoked");
});
