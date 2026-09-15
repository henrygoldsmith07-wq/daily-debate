import test from "node:test";
import assert from "node:assert/strict";
import { basicStats, bootstrapDeltaCi, decideFromRegistration, metricValue, nextArmPlan, runUsability } from "./judge-stats.mjs";

const REG = {
  runsPerArm: 3,
  minimumUsableReliability: 0.75,
  target: { metric: "fake-citation influence", minImprovement: 0.08 },
  protected: { ECE: { maxRegression: 0.04 } },
};

const mkRun = (file, reliability, metrics) => ({ file, at: `at-${file}`, reliability, metrics });
const arm = (runs) => ({ runs });

// fake values: base ~0.23, cand ~0.11 => supported unless a rule vetoes
const GOOD_BASE = [0.24, 0.22, 0.23].map((f, i) => mkRun(`b${i}`, 0.9, { "fake-citation influence": f, ECE: 0.2 }));
const GOOD_CAND = [0.1, 0.12, 0.11].map((f, i) => mkRun(`c${i}`, 0.9, { "fake-citation influence": f, ECE: 0.2 }));

test("basicStats computes raw stats without hiding dispersion", () => {
  const s = basicStats([0.2, 0.3, 0.1]);
  assert.equal(s.n, 3);
  assert.equal(s.min, 0.1);
  assert.equal(s.max, 0.3);
  assert.equal(s.median, 0.2);
  assert.ok(s.sd > 0.08 && s.sd < 0.11);
});

test("bootstrapDeltaCi is deterministic and zero-aware", () => {
  const a = bootstrapDeltaCi([0.2, 0.22, 0.21], [0.1, 0.12, 0.11], { seed: 42 });
  const b = bootstrapDeltaCi([0.2, 0.22, 0.21], [0.1, 0.12, 0.11], { seed: 42 });
  assert.deepEqual(a, b);
  assert.ok(a.ciUpper < 0);
  const none = bootstrapDeltaCi([0.2, 0.22, 0.21], [0.2, 0.21, 0.2], { seed: 42 });
  assert.ok(none.ciLower < 0 && none.ciUpper > 0);
});

test("3/3 + 3/3 usable with clean improvement => supported", () => {
  const v = decideFromRegistration(REG, { baseline: arm(GOOD_BASE), candidate: arm(GOOD_CAND) });
  assert.equal(v.status, "supported");
  assert.equal(v.audit.baseline.usableRuns, 3);
  assert.equal(v.audit.candidate.excluded.length, 0);
});

test("2/3 + 2/3 usable => INCONCLUSIVE (registered count is exact, no reduced power)", () => {
  const base2 = GOOD_BASE.slice(0, 2);
  const cand2 = GOOD_CAND.slice(0, 2);
  const v = decideFromRegistration(REG, { baseline: arm(base2), candidate: arm(cand2) });
  assert.equal(v.status, "inconclusive");
  assert.match(v.reasons[0], /registered requirement not met/);
});

test("3/3 + 2/3 usable => INCONCLUSIVE", () => {
  const v = decideFromRegistration(REG, { baseline: arm(GOOD_BASE), candidate: arm(GOOD_CAND.slice(0, 2)) });
  assert.equal(v.status, "inconclusive");
});

test("1/3 + 3/3 usable => INCONCLUSIVE", () => {
  const base1 = [mkRun("b0", 0.9, { "fake-citation influence": 0.23, ECE: 0.2 }), mkRun("b1", 0.1, { "fake-citation influence": 0.23, ECE: 0.2 })];
  const v = decideFromRegistration(REG, { baseline: arm(base1), candidate: arm(GOOD_CAND) });
  assert.equal(v.status, "inconclusive");
});

test("unreliable runs are EXCLUDED from inference but retained and reported", () => {
  // candidate has 4 runs: three usable (good), one unreliable extreme value
  // that would drag the mean if included.
  const polluted = [...GOOD_CAND, mkRun("cX", 0.05, { "fake-citation influence": 0.9, ECE: 0.9 })];
  const v = decideFromRegistration(REG, { baseline: arm(GOOD_BASE), candidate: arm(polluted) });
  assert.equal(v.status, "supported"); // exclusion keeps the decision honest
  assert.equal(v.audit.candidate.totalRuns, 4);
  assert.equal(v.audit.candidate.usableRuns, 3);
  assert.equal(v.audit.candidate.excluded[0].file, "cX");
  assert.match(v.audit.candidate.excluded[0].reason, /reliability 0.05/);
});

test("unreliable extreme that FLIPS the result if included is proven excluded", () => {
  // With the unreliable run included, candidate mean = (0.1+0.12+0.11+0.8)/4
  // = 0.28 > base mean 0.23 => no improvement. Exclusion must rescue truth.
  const polluted = [...GOOD_CAND, mkRun("cX", 0.2, { "fake-citation influence": 0.8, ECE: 0.8 })];
  const withFilter = decideFromRegistration(REG, { baseline: arm(GOOD_BASE), candidate: arm(polluted) });
  assert.equal(withFilter.status, "supported");
  const included = polluted.map((r) => r.metrics["fake-citation influence"]);
  const naive = included.reduce((s, x) => s + x, 0) / included.length;
  assert.ok(naive > 0.23, "sanity: the unreliable value WOULD have flipped the verdict if included");
});

test("target improvement below registered margin => rejected", () => {
  const small = [0.2, 0.21, 0.19].map((f, i) => mkRun(`c${i}`, 0.9, { "fake-citation influence": f, ECE: 0.2 }));
  const v = decideFromRegistration(REG, { baseline: arm(GOOD_BASE), candidate: arm(small) });
  assert.equal(v.status, "rejected");
  assert.ok(v.reasons.some((r) => r.includes("minimum")));
});

test("bootstrap CI crossing zero => rejected even above raw margin", () => {
  // mean improvement 0.090 >= 0.08 margin, but spread is so wide the 90% CI
  // of the difference straddles zero -> not distinguishable from noise.
  const noisy = [0.02, 0.3, 0.1].map((f, i) => mkRun(`c${i}`, 0.9, { "fake-citation influence": f, ECE: 0.2 }));
  const v = decideFromRegistration(REG, { baseline: arm(GOOD_BASE), candidate: arm(noisy) });
  assert.equal(v.status, "rejected");
  assert.ok(v.reasons.some((r) => r.includes("zero") || r.includes("CI")));
});

test("protected regression beyond cap and pooled sd => rejected", () => {
  const worseEce = GOOD_CAND.map((r, i) => mkRun(`c${i}`, 0.9, { "fake-citation influence": [0.1, 0.12, 0.11][i], ECE: 0.3 }));
  const v = decideFromRegistration(REG, { baseline: arm(GOOD_BASE), candidate: arm(worseEce) });
  assert.equal(v.status, "rejected");
  assert.ok(v.reasons.some((r) => r.startsWith("ECE")));
});

test("latency/token budget violations are ordinary protected regressions", () => {
  const reg = {
    ...REG,
    protected: { "latency p50 ms": { maxRegression: 25000 }, "prompt tokens": { maxRegression: 250000 } },
  };
  const slowCand = [0.1, 0.12, 0.11].map((f, i) =>
    mkRun(`c${i}`, 0.9, { "fake-citation influence": f, ECE: 0.2, "latency p50 ms": 60000, "prompt tokens": 900000 }),
  );
  const slowBase = [0.24, 0.22, 0.23].map((f, i) =>
    mkRun(`b${i}`, 0.9, { "fake-citation influence": f, ECE: 0.2, "latency p50 ms": 14000, "prompt tokens": 400000 }),
  );
  const v = decideFromRegistration(reg, { baseline: arm(slowBase), candidate: arm(slowCand) });
  assert.equal(v.status, "rejected");
  assert.ok(v.reasons.some((r) => r.startsWith("latency p50 ms")));
  assert.ok(v.reasons.some((r) => r.startsWith("prompt tokens")));
});

test("provider reliability below floor on too few usable runs => inconclusive, no quality claim", () => {
  // every run under the floor: availability problem, NOT a model conclusion
  const deadBase = GOOD_BASE.map((r) => ({ ...r, reliability: 0.0 }));
  const deadCand = GOOD_CAND.map((r) => ({ ...r, reliability: 0.1 }));
  const v = decideFromRegistration(REG, { baseline: arm(deadBase), candidate: arm(deadCand) });
  assert.equal(v.status, "inconclusive");
  assert.ok(!v.reasons.some((r) => r.includes("target")));
});

test("missing target metric data on a usable arm => inconclusive", () => {
  const missing = [0.1, null, 0.11].map((f, i) => mkRun(`c${i}`, 0.9, { ECE: 0.2, ...(f !== null ? { "fake-citation influence": f } : {}) }));
  const v = decideFromRegistration(REG, { baseline: arm(GOOD_BASE), candidate: arm(missing) });
  assert.equal(v.status, "inconclusive");
  assert.ok(v.reasons.some((r) => r.includes("usable values")));
});

test("registration without target metric => inconclusive", () => {
  const noTarget = { ...REG };
  delete noTarget.target;
  const v = decideFromRegistration(noTarget, { baseline: arm(GOOD_BASE), candidate: arm(GOOD_CAND) });
  assert.equal(v.status, "inconclusive");
});

test("runUsability labels reliability states precisely", () => {
  assert.equal(runUsability({ reliability: 0.8 }, REG).usable, true);
  assert.equal(runUsability({ reliability: 0.749 }, REG).usable, false);
  assert.match(runUsability({ reliability: null }, REG).reason, /unreported/);
});

test("interleave plan resumes balanced and never double-runs a trailing arm", () => {
  assert.deepEqual(nextArmPlan(0, 0, 3), ["baseline", "candidate", "baseline", "candidate", "baseline", "candidate"]);
  assert.deepEqual(nextArmPlan(1, 1, 3), ["baseline", "candidate", "baseline", "candidate"]);
  assert.deepEqual(nextArmPlan(2, 1, 3), ["candidate", "baseline", "candidate"]);
  assert.deepEqual(nextArmPlan(3, 1, 3), ["candidate", "candidate"]);
  assert.deepEqual(nextArmPlan(3, 3, 3), []);
});

test("metricValue reads the documented result shape", () => {
  assert.equal(metricValue("provider reliability", { reliability: { successRatio: 0.8 } }), 0.8);
  assert.equal(metricValue("names stability", { stability: { names: 0.9 } }), 0.9);
  assert.equal(metricValue("ECE", {}), null);
});
