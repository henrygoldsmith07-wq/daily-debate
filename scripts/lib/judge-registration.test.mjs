import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  armModels,
  canonicalHash,
  deriveAdoptionRule,
  validateRegistration,
  REGISTRATION_SCHEMA_VERSION,
} from "./judge-registration.mjs";
import { estimateCapacity } from "../judge-capacity.mjs";
import { EXPERIMENTS as LIVE_EXPERIMENTS } from "./judge-experiments.mjs";

const EXPERIMENTS = { baseline: { kind: "single-prompt" }, "grounding-two-pass": { kind: "two-pass-grounding" } };

const VALID = {
  name: "valid-study",
  hypothesis: "a two-pass grounding architecture cuts fake-citation influence",
  singleVariable: "architecture only",
  runsPerArm: 3,
  minimumUsableReliability: 0.75,
  target: { metric: "fake-citation influence", direction: "down", minImprovement: 0.08 },
  protected: { "fixture agreement": { maxRegression: 0.05 }, ECE: { maxRegression: 0.04 } },
  arms: { baseline: { experiment: "baseline" }, candidate: { experiment: "grounding-two-pass" } },
  models: "unorouter",
  bootstrapSeed: 42,
};

test("valid registration passes; warnings only", () => {
  const v = validateRegistration(VALID, { experiments: EXPERIMENTS });
  assert.equal(v.ok, true);
  assert.deepEqual(v.errors, []);
});

test("structured-field violations are refused", () => {
  const cases = [
    ["runsPerArm < 2", { ...VALID, runsPerArm: 1 }, /runsPerArm/],
    ["bad reliability", { ...VALID, minimumUsableReliability: 1.4 }, /minimumUsableReliability/],
    ["unknown target metric", { ...VALID, target: { ...VALID.target, metric: "vibes" } }, /not a known metric/],
    ["contradicted direction", { ...VALID, target: { ...VALID.target, direction: "up" } }, /direction/],
    ["target duplicated in protected", { ...VALID, protected: { ...VALID.protected, "fake-citation influence": { maxRegression: 0.01 } } }, /duplicate/],
    ["unknown arm", { ...VALID, arms: { baseline: { experiment: "nope" }, candidate: VALID.arms.candidate } }, /unknown experiment/],
    ["same arms", { ...VALID, arms: { baseline: { experiment: "baseline" }, candidate: { experiment: "baseline" } } }, /must differ/],
    ["no provider", { ...VALID, models: "" }, /models/],
    ["negative budget", { ...VALID, protected: { ECE: { maxRegression: -1 } } }, /maxRegression/],
  ];
  for (const [label, reg, re] of cases) {
    const v = validateRegistration(reg, { experiments: EXPERIMENTS });
    assert.equal(v.ok, false, label);
    assert.ok(v.errors.some((e) => re.test(e)), `${label}: expected /${re}/ in ${JSON.stringify(v.errors)}`);
  }
});

test("v2 prose must match the derived rule; legacy v1 prose only warns", () => {
  const mismatched = { ...VALID, adoptionRule: "adopt if it feels better" };
  const v2 = validateRegistration({ ...mismatched, schemaVersion: REGISTRATION_SCHEMA_VERSION }, { experiments: EXPERIMENTS });
  assert.equal(v2.ok, false);
  assert.ok(v2.errors.some((e) => e.includes("conflicts")));
  const v1 = validateRegistration({ ...mismatched, schemaVersion: 1 }, { experiments: EXPERIMENTS });
  assert.equal(v1.ok, true);
  assert.ok(v1.warnings.some((w) => w.includes("structured fields govern")));
});

test("derived rule text contains the authoritative numbers", () => {
  const prose = deriveAdoptionRule(VALID);
  assert.ok(prose.includes("3/arm"));
  assert.ok(prose.includes("0.75"));
  assert.ok(prose.includes("0.08"));
  assert.ok(prose.includes("fake-citation influence"));
});

test("canonical hash ignores bookkeeping write-back, catches real edits", () => {
  const sealed = canonicalHash(VALID);
  const afterVerdict = canonicalHash({
    ...VALID,
    status: "decided",
    decidedAt: "2026-09-16T00:00:00Z",
    registrationHash: "x",
    studyDir: "docs/judge-runs/whatever",
    verdict: { status: "supported", reasons: [] },
    capacityAssessment: { decision: "GO" },
  });
  assert.equal(afterVerdict, sealed);
  const edited = canonicalHash({ ...VALID, runsPerArm: 2 });
  assert.notEqual(edited, sealed);
});

test("capacity planner: unknown budget => BLOCKED; sufficient => GO; grounding doubles calls", () => {
  const noBudget = estimateCapacity(VALID, null);
  assert.equal(noBudget.decision, "BLOCKED");
  assert.match(noBudget.rationale, /unknown capacity/);

  const single = estimateCapacity({ ...VALID, arms: { baseline: { experiment: "baseline" }, candidate: { experiment: "baseline" } } }, 10_000);
  const grounded = estimateCapacity(VALID, 10_000);
  assert.ok(grounded.expectedCalls > single.expectedCalls * 1.3, "two-pass arm must plan more calls than single-pass");

  assert.equal(estimateCapacity(VALID, 10_000).decision, "GO");
  assert.equal(estimateCapacity(VALID, 500).decision, "BLOCKED"); // >80% headroom
  assert.ok(estimateCapacity(VALID, 10_000).expectedJobs === 312 * 3 * 2);
});

test("every registration file on disk validates against the live experiment registry", () => {
  const dir = path.join(process.cwd(), "docs", "judge-experiments", "registrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 3, `expected sealed registrations, found ${files.length}`);
  for (const file of files) {
    const reg = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    const v = validateRegistration(reg, { experiments: LIVE_EXPERIMENTS });
    // Sealed registrations whose arm is deliberately unimplemented (stated
    // BLOCKED in executionStatus) must fail ONLY on that pending arm — any
    // other structural error is a real regression.
    const blockedPendingArm = /BLOCKED/i.test(String(reg.executionStatus ?? ""));
    if (blockedPendingArm) {
      assert.ok(v.errors.length > 0, `${file}: a BLOCKED registration should refuse to execute`);
      assert.ok(
        v.errors.every((e) => /not implemented yet/.test(e)),
        `${file}: unexpected validation errors ${JSON.stringify(v.errors)}`,
      );
    } else {
      assert.equal(v.ok, true, `${file}: ${JSON.stringify(v.errors)}`);
    }
    // Adoption prose must equal the structured rule, byte for byte (v2+).
    if ((reg.schemaVersion ?? 1) >= REGISTRATION_SCHEMA_VERSION) {
      assert.equal(String(reg.adoptionRule).trim(), deriveAdoptionRule(reg), `${file}: adoptionRule drifted`);
    }
  }
});

test("pinned-paid-judge is a provider-only variable: prompt byte-identical to baseline", () => {
  const candidate = LIVE_EXPERIMENTS["pinned-paid-judge"];
  assert.ok(candidate, "experiment must exist for the pre-registered arm");
  assert.equal(candidate.kind, "single-prompt");
  assert.equal(candidate.citationClause, LIVE_EXPERIMENTS.baseline.citationClause);
  assert.equal(candidate.implementationPending, undefined);
});

test("armModels: per-arm provider overrides the study-level provider", () => {
  const reg = {
    models: "unorouter",
    arms: { baseline: { experiment: "baseline" }, candidate: { experiment: "pinned-paid-judge", models: "anthropic" } },
  };
  assert.equal(armModels(reg, "baseline"), "unorouter");
  assert.equal(armModels(reg, "candidate"), "anthropic");
  assert.equal(armModels({ models: "x", arms: { baseline: { experiment: "a", models: " y " } } }, "baseline"), "y");
  assert.equal(armModels({ arms: {} }, "baseline"), "");
});
