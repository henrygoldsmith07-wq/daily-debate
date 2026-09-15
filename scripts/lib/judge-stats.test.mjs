import test from "node:test";
import assert from "node:assert/strict";
import { basicStats, bootstrapDeltaCi, decideFromRegistration, metricValue } from "./judge-stats.mjs";

const REG = {
  runsPerArm: 3,
  minimumUsableReliability: 0.75,
  target: { metric: "fake-citation influence", minImprovement: 0.08 },
  protected: { ECE: { maxRegression: 0.04 } },
};

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
  assert.ok(a.point < 0);
  assert.ok(a.ciUpper < 0);
  const none = bootstrapDeltaCi([0.2, 0.22, 0.21], [0.2, 0.21, 0.2], { seed: 42 });
  assert.ok(none.ciLower < 0 && none.ciUpper > 0);
});

test("supported only with margin + CI lower bound past zero + no protected regression", () => {
  const base = { runs: [0.24, 0.22, 0.23].map((x) => ({ reliability: 0.9, metrics: { "fake-citation influence": x, ECE: 0.2 } })) };
  const cand = { runs: [0.1, 0.12, 0.11].map((x) => ({ reliability: 0.9, metrics: { "fake-citation influence": x, ECE: 0.21 } })) };
  const v = decideFromRegistration(REG, { baseline: base, candidate: cand });
  assert.equal(v.status, "supported");
});

test("small improvement beyond noise => rejected on target margin", () => {
  const base = { runs: [0.24, 0.22, 0.23].map((x) => ({ reliability: 0.9, metrics: { "fake-citation influence": x, ECE: 0.2 } })) };
  const cand = { runs: [0.21, 0.22, 0.2].map((x) => ({ reliability: 0.9, metrics: { "fake-citation influence": x, ECE: 0.2 } })) };
  const v = decideFromRegistration(REG, { baseline: base, candidate: cand });
  assert.equal(v.status, "rejected");
  assert.ok(v.reasons.some((r) => r.includes("minimum")));
});

test("target success is vetoed by a protected ECE regression beyond both cap and noise", () => {
  const base = { runs: [0.24, 0.22, 0.23].map((x) => ({ reliability: 0.9, metrics: { "fake-citation influence": x, ECE: 0.2 } })) };
  const cand = { runs: [0.1, 0.12, 0.11].map((x) => ({ reliability: 0.9, metrics: { "fake-citation influence": x, ECE: 0.3 } })) };
  const v = decideFromRegistration(REG, { baseline: base, candidate: cand });
  assert.equal(v.status, "rejected");
  assert.ok(v.reasons.some((r) => r.startsWith("ECE")));
});

test("runs below minimum usable reliability make the study inconclusive, never a pass", () => {
  const base = { runs: [0.24, 0.22, 0.23].map((x) => ({ reliability: 0.2, metrics: { "fake-citation influence": x, ECE: 0.2 } })) };
  const cand = { runs: [0.1, 0.12, 0.11].map((x) => ({ reliability: 0.9, metrics: { "fake-citation influence": x, ECE: 0.2 } })) };
  const v = decideFromRegistration(REG, { baseline: base, candidate: cand });
  assert.equal(v.status, "inconclusive");
  assert.match(v.reasons[0], /insufficient usable runs/);
});

test("regression within run noise is noted, not disqualifying", () => {
  const mk = (fake, eces) => ({
    runs: fake.map((x, i) => ({ reliability: 0.9, metrics: { "fake-citation influence": x, ECE: eces[i] } })),
  });
  const base = mk([0.24, 0.22, 0.23], [0.2, 0.14, 0.26]); // ECE sd ~0.06
  const cand = mk([0.1, 0.12, 0.11], [0.26, 0.2, 0.32]); // ECE mean +0.06 > cap 0.04 but <= pooled sd
  const v = decideFromRegistration(REG, { baseline: base, candidate: cand });
  assert.equal(v.status, "supported");
  assert.ok(v.reasons.some((r) => r.includes("within run noise") || r.startsWith("(note)")));
});

test("metricValue reads the documented result shape", () => {
  assert.equal(metricValue("provider reliability", { reliability: { successRatio: 0.8 } }), 0.8);
  assert.equal(metricValue("names stability", { stability: { names: 0.9 } }), 0.9);
  assert.equal(metricValue("ECE", {}), null);
});
