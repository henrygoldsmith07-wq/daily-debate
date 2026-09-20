// Provider-resilience regression tests.
//
// The first real production AI attempt failed with malformed JSON from one
// model and timeouts from two others. The repair below must recover ONLY safe
// syntax defects and must never let structurally invalid content through,
// because the repaired text is revalidated by the same schema checks.

import test from "node:test";
import assert from "node:assert/strict";

import { classifyAttempt, repairJson } from "../generate-topics.mjs";

const VALID = '{"topics":[{"title":"t","prompt":"p","category":"c","sources":["https://a"]}]}';

test("valid JSON is returned unchanged (repair never rewrites good input)", () => {
  assert.equal(repairJson(VALID), VALID);
});

test("safe syntax defects are repaired", () => {
  // Trailing comma before a closing brace.
  assert.deepEqual(JSON.parse(repairJson('{"a":1,}')), { a: 1 });
  // Trailing comma before a closing bracket.
  assert.deepEqual(JSON.parse(repairJson('{"a":[1,2,]}')), { a: [1, 2] });
  // Smart quotes around a key and value.
  assert.deepEqual(JSON.parse(repairJson('{\u201Ca\u201D:\u201Cb\u201D}')), { a: "b" });
  // A stray control character inside the document.
  assert.deepEqual(JSON.parse(repairJson('{"a":\u0007"b"}')), { a: "b" });
});

test("repair does not invent, drop or reorder content", () => {
  const damaged = '{"topics":[{"title":"t","prompt":"p","category":"c","sources":["https://a"],}]}';
  assert.deepEqual(JSON.parse(repairJson(damaged)), JSON.parse(VALID));
});

test("repair cannot rescue structurally broken JSON", () => {
  for (const broken of ['{"a":', '{"a" 1}', "{'a':1}", "not json at all", '{"a":1}{"b":2}']) {
    assert.throws(() => JSON.parse(repairJson(broken)), `${broken} must still fail`);
  }
});

test("attempt failures bucket into the provider-health vocabulary", () => {
  assert.equal(classifyAttempt("The operation was aborted due to timeout"), "timeout");
  assert.equal(classifyAttempt("429 Too Many Requests"), "rate-limit");
  assert.equal(classifyAttempt("401 Unauthorized"), "authentication");
  assert.equal(classifyAttempt("insufficient_quota: budget exceeded"), "quota");
  assert.equal(classifyAttempt("Unexpected token } in JSON at position 4"), "invalid-response");
  assert.equal(classifyAttempt("no usable topics after schema validation"), "invalid-response");
  assert.equal(classifyAttempt("socket hang up"), "other");
  assert.equal(classifyAttempt(""), "other");
});

test("every bucket is one of the declared provider-health values", () => {
  const allowed = new Set([
    "success", "invalid-response", "timeout", "rate-limit", "authentication", "quota", "other",
  ]);
  for (const msg of ["timeout", "429", "401", "quota", "bad json", "", "weird"]) {
    assert.ok(allowed.has(classifyAttempt(msg)), `unexpected bucket for ${JSON.stringify(msg)}`);
  }
});
