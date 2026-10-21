import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  armModels,
  canonicalHash,
  deriveAdoptionRule,
  isWithdrawn,
  knownProviderLabels,
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
    if (v.withdrawn) {
      // A WITHDRAWN registration is a historical record, not an executable plan.
      // It is held to a STRICTER standard than a live one, not a looser one:
      // it must state why, it must be refused by the validator (so the runner
      // can never seal it), and every OTHER field must still be sound - a
      // withdrawal must not become a hiding place for a broken record.
      assert.ok(
        String(reg.withdrawalReason ?? "").trim().length >= 40,
        `${file}: withdrawn registration must carry a substantive withdrawalReason`,
      );
      assert.equal(v.ok, false, `${file}: a withdrawn registration must not validate as executable`);
      assert.ok(
        v.errors.some((e) => /WITHDRAWN/.test(e)),
        `${file}: the refusal must say the registration is withdrawn, got ${JSON.stringify(v.errors)}`,
      );
      assert.ok(
        v.errors.every(
          (e) =>
            /WITHDRAWN/.test(e) ||
            /unknown provider/.test(e) ||
            /not implemented yet/.test(e) ||
            /withdrawalReason/.test(e),
        ),
        `${file}: a withdrawn registration may only fail for its own withdrawal reasons, got ${JSON.stringify(v.errors)}`,
      );
    } else if (/BLOCKED/i.test(String(reg.executionStatus ?? "")) && v.errors.length > 0) {
      // An unimplemented arm is the ONLY validation failure a deliberately
      // BLOCKED registration may carry. Other BLOCKED reasons (e.g. capacity,
      // which the runner governs at execution time) leave the registration
      // structurally valid.
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

// --- An arm naming a provider that does not exist can never execute ----------
//
// Guards the defect that withdrew `pinned-paid-judge-default`: PR #135 removed
// the paid `anthropic` transport, but the pre-registered study's candidate arm
// still named it. validateRegistration returned ok=true with no errors and the
// registration kept advertising executionStatus READY, while at run time the
// quota probe answered "NO-KEY anthropic" (exit 3) and the benchmark reported
// "--models anthropic matched no configured provider" (exit 2). The study could
// never reach a verdict, and nothing said so.

test("an arm on an unknown provider is refused (the withdrawn pinned-paid defect)", () => {
  const dead = {
    ...VALID,
    arms: { baseline: { experiment: "baseline" }, candidate: { experiment: "grounding-two-pass", models: "anthropic" } },
  };
  const v = validateRegistration(dead, { experiments: EXPERIMENTS });
  assert.equal(v.ok, false);
  assert.ok(
    v.errors.some((e) => /arms\.candidate\.models names unknown provider "anthropic"/.test(e)),
    `expected an unknown-provider error, got ${JSON.stringify(v.errors)}`,
  );
});

test("an unknown study-level provider is refused too", () => {
  const v = validateRegistration({ ...VALID, models: "unorouter,gpt5" }, { experiments: EXPERIMENTS });
  assert.equal(v.ok, false);
  assert.ok(
    v.errors.some((e) => /models names unknown provider "gpt5"/.test(e)),
    `expected an unknown-provider error, got ${JSON.stringify(v.errors)}`,
  );
});

test("every label the registry exposes is accepted; a removed one is not", () => {
  const known = knownProviderLabels();
  assert.ok(known.length > 0);
  assert.ok(!known.includes("anthropic"), "anthropic was removed from the registry and must not validate");
  for (const label of known) {
    const v = validateRegistration({ ...VALID, models: label }, { experiments: EXPERIMENTS });
    assert.equal(v.ok, true, `known provider ${label} must validate: ${JSON.stringify(v.errors)}`);
  }
});

test("a withdrawn registration states why, and is exempt from execution validation", () => {
  const dir = path.join(process.cwd(), "docs", "judge-experiments", "registrations");
  const withdrawn = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ file: f, reg: JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) }))
    .filter(({ reg }) => /withdrawn/i.test(String(reg.status ?? "")));
  // The pinned-paid registration must stay withdrawn while anthropic is absent.
  const pinned = withdrawn.find(({ file }) => file === "pinned-paid-judge-default.json");
  assert.ok(pinned, "pinned-paid-judge-default must be marked withdrawn while its provider is removed");
  assert.ok(String(pinned.reg.withdrawalReason).includes("anthropic"));
  // And no non-withdrawn registration may name a provider the registry lacks.
  for (const { file, reg } of fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ file: f, reg: JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) }))
    .filter(({ reg }) => !/withdrawn/i.test(String(reg.status ?? "")))) {
    const v = validateRegistration(reg, { experiments: LIVE_EXPERIMENTS });
    assert.equal(v.ok, true, `${file}: ${JSON.stringify(v.errors)}`);
  }
});

// --- A withdrawn registration must never be run -------------------------------
//
// The exemption above is the one place a registration can dodge execution
// validation, so it must not also be a way to RUN a withdrawn study. Before
// this fix the runner happily sealed a withdrawn registration ("sealed
// registration ... canonical hash=..."), planned its arms
// ("plan=baseline,candidate,...") and only stopped at the provider probe -
// leaving a study directory that looked like real evidence for a study nobody
// was running, and never once mentioning the withdrawal.

test("the study runner refuses a withdrawn registration and creates nothing", () => {
  const base = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "docs", "judge-experiments", "registrations", "grounding-two-pass-verbosity-v2.json"), "utf8"),
  );
  // A withdrawn copy of a HEALTHY registration: every field still validates.
  // Only the withdrawal marker differs - so the refusal cannot be an accident
  // of a broken registration. The base must itself be a live registration:
  // basing this on an already-withdrawn one would make the copy's withdrawal
  // ambiguous (is the runner refusing because of the copy's marker, or
  // because the base was already dead?) and would stop proving anything.
  assert.equal(isWithdrawn(base), false, "the base registration must be live for this test to mean anything");
  const withdrawn = {
    ...base,
    name: "withdrawn-runner-probe",
    status: "withdrawn",
    withdrawalReason: "withdrawn so the runner must refuse to seal or execute it (regression probe)",
  };
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-withdrawn-"));
  const regPath = path.join(parent, "withdrawn.json");
  fs.writeFileSync(regPath, JSON.stringify(withdrawn, null, 2));
  const studyDir = path.join(parent, "study");
  try {
    const res = spawnSync(
      process.execPath,
      ["scripts/judge-study.mjs", "--registration", regPath, "--study-dir", studyDir, "--budget-calls", "100000"],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;
    assert.equal(res.status, 2, `a withdrawn registration must exit 2, got ${res.status}: ${output}`);
    // The refusal must come from the RUNNER's own withdrawal check, not merely
    // from the validator's error list: a generic "registration INVALID" would
    // also exit 2, so only the explicit withdrawal message proves the runner
    // refuses a withdrawn study for the right reason.
    assert.match(output, /WITHDRAWN/, `the refusal must name the withdrawal: ${output}`);
    assert.match(output, /withdrawalReason|reason:/, `the refusal must cite the recorded reason: ${output}`);
    assert.ok(
      !/registration INVALID/.test(output),
      `the runner must refuse a withdrawn registration explicitly, not via the generic invalid path: ${output}`,
    );
    assert.ok(!/sealed registration/.test(output), `a withdrawn registration must never be sealed: ${output}`);
    assert.ok(!/plan=/.test(output), `a withdrawn registration must never be planned: ${output}`);
    assert.ok(!fs.existsSync(studyDir), "a withdrawn registration must not create a study directory");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("a withdrawn registration is refused by the validator, with a reason", () => {
  const withdrawn = { ...VALID, status: "withdrawn", withdrawalReason: "x".repeat(60) };
  const v = validateRegistration(withdrawn, { experiments: EXPERIMENTS });
  assert.equal(v.ok, false);
  assert.equal(v.withdrawn, true);
  assert.ok(v.errors.some((e) => /WITHDRAWN/.test(e)), JSON.stringify(v.errors));
  // A withdrawal without a stated reason is not an honest withdrawal.
  const noReason = validateRegistration({ ...VALID, status: "withdrawn" }, { experiments: EXPERIMENTS });
  assert.equal(noReason.ok, false);
  assert.ok(noReason.errors.some((e) => /withdrawalReason/.test(e)), JSON.stringify(noReason.errors));
  // A live registration is not withdrawn.
  assert.equal(validateRegistration(VALID, { experiments: EXPERIMENTS }).withdrawn, false);
  // isWithdrawn is the single definition of "withdrawn"; the runner and the
  // validator must agree on it, or a status string could mean two things.
  assert.equal(isWithdrawn({ status: "withdrawn" }), true);
  assert.equal(isWithdrawn({ status: "superseded" }), true);
  assert.equal(isWithdrawn({ status: "registered" }), false);
  assert.equal(isWithdrawn({ status: "decided" }), false);
  assert.equal(isWithdrawn({}), false);
  assert.equal(isWithdrawn(undefined), false);
  assert.equal(isWithdrawn(withdrawn), true);
  assert.equal(isWithdrawn(VALID), false);
});
