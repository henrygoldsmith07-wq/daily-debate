// Unit tests for the benchmark scoring rules (node --test). These encode the
// acceptance rules: probes below their minimum sample can never pass, failed
// calls stay in denominators, provider reliability is gated separately from
// model quality, and diagnostics group failures by cause.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  GATE_DEFAULTS,
  probeMinUsable,
  probeReport,
  probeVerdict,
  reliabilityReport,
  reliabilityVerdict,
  allGateChecks,
  failureSummary,
  buildDiagnostics,
  classifyProviderError,
  zeroUsableJudges,
  attemptsLogEntry,
  appendAttemptsLog,
} from "./judge-eval.mjs";

const MIN = probeMinUsable(24); // 12

function okRow(over = {}) {
  return { error: null, flip: false, scoreDelta: 1, confDelta: 0.02, ...over };
}

function probeWithUsable(usable, flips = 0, expected = 24) {
  const rows = Array.from({ length: usable }, (_, i) => okRow({ flip: i < flips }));
  return probeReport({ id: "names", expected, rows, minUsable: MIN });
}

test("probeReport counts failures in the denominator and never drops them", () => {
  const report = probeReport({
    id: "names",
    expected: 24,
    rows: [
      ...Array.from({ length: 5 }, () => okRow()),
      { error: "500: upstream", flip: null },
    ],
    minUsable: MIN,
  });
  assert.equal(report.usableCalls, 5);
  assert.equal(report.failedCalls, 19); // 18 not-issued + 1 errored
  assert.equal(report.completionRatio, 0.208);
  assert.equal(report.measurable, false);
});

test("a probe below the minimum usable sample can never pass", () => {
  const report = probeWithUsable(MIN - 1, 0);
  const verdict = probeVerdict(report, { max: 0.05 });
  assert.equal(verdict.state, "INSUFFICIENT DATA");
  assert.equal(verdict.pass, false);
  assert.equal(verdict.kind, "insufficient-data");
});

test("an error-free probe at the sample floor still measures", () => {
  const report = probeWithUsable(MIN, 1); // 1 flip of 12 -> 0.083 flip rate
  assert.equal(report.measurable, true);
  const verdict = probeVerdict(report, { max: 0.05 });
  assert.equal(verdict.state, "FAIL");
  assert.equal(verdict.pass, false);
  assert.equal(verdict.kind, "model-quality"); // quality failure, not provider
});

test("a passing probe at the floor reports PASS with model-quality kind", () => {
  const report = probeWithUsable(MIN, 0);
  const verdict = probeVerdict(report, { max: 0.05 });
  assert.equal(verdict.state, "PASS");
  assert.equal(verdict.pass, true);
});

test("probeMinUsable floors at 4 for tiny packs", () => {
  assert.equal(probeMinUsable(24), 12);
  assert.equal(probeMinUsable(4), 4);
  assert.equal(probeMinUsable(2), 4);
});

test("probeVerdict keeps stability semantics for min-threshold probes", () => {
  // position probe: 24 usable, 1 flip -> stability 0.958 vs min 0.97 -> FAIL
  const report = probeWithUsable(24, 1);
  const verdict = probeVerdict(report, { min: 0.97 });
  assert.equal(verdict.state, "FAIL");
  assert.equal(verdict.value, 0.958);
});

test("reliabilityVerdict fails a provider below threshold, not the model", () => {
  const report = reliabilityReport({ attempted: 312, successful: 120 });
  const verdict = reliabilityVerdict(report, GATE_DEFAULTS.providerReliabilityMin);
  assert.equal(verdict.pass, false);
  assert.equal(verdict.kind, "provider");
  assert.equal(report.failedCalls, 192);
  assert.equal(report.successRatio, 0.385);
});

test("reliabilityVerdict passes at threshold and distinguishes zero-attempt", () => {
  assert.equal(reliabilityVerdict(reliabilityReport({ attempted: 100, successful: 75 }), 0.75).pass, true);
  const zero = reliabilityVerdict(reliabilityReport({ attempted: 0, successful: 0 }), 0.75);
  assert.equal(zero.pass, false);
  assert.equal(zero.kind, "insufficient-data");
});

test("allGateChecks includes the provider-reliability gate first", () => {
  const m = {
    humanAgreement: 0.8,
    ece: 0.05,
    probes: {
      position: probeWithUsable(24, 0),
      names: probeWithUsable(24, 0),
      "verbosity-up": probeWithUsable(24, 0),
      "style-fancy": probeWithUsable(24, 0),
      whitespace: probeWithUsable(24, 0),
      prestige: probeWithUsable(24, 0),
      "confidence-hedge": probeWithUsable(24, 0),
      "confident-tone": probeWithUsable(24, 0),
      "fake-citation": probeWithUsable(24, 0),
    },
    audits: {
      "political-topic": probeReport({
        id: "political-topic",
        expected: 24,
        rows: Array.from({ length: 24 }, () => okRow()),
        minUsable: MIN,
      }),
      "ideology-left": probeReport({
        id: "ideology-left",
        expected: 24,
        rows: Array.from({ length: 24 }, () => okRow()),
        minUsable: MIN,
      }),
      "ideology-right": probeReport({
        id: "ideology-right",
        expected: 24,
        rows: Array.from({ length: 24 }, () => okRow()),
        minUsable: MIN,
      }),
    },
    reliability: reliabilityReport({ attempted: 312, successful: 300 }),
  };
  const checks = allGateChecks(m, GATE_DEFAULTS);
  assert.equal(checks[0].name, "provider reliability");
  assert.equal(checks[0].pass, true);
  const names = checks.map((c) => c.name);
  for (const required of [
    "fixture-label agreement",
    "ECE",
    "Names removed [names]",
    "Position swap [position]",
    "Verbosity inflated [verbosity-up]",
    "Style: sophisticated wording [style-fancy]",
    "Whitespace normalised [whitespace]",
    "Source prestige swapped [prestige]",
    "Confidence hedged [confidence-hedge]",
    "Confident tone added [confident-tone]",
    "Fake citation injected [fake-citation]",
    "political-topic stability",
    "ideological asymmetry",
  ]) {
    assert.ok(names.includes(required), `missing gate: ${required}`);
  }
  assert.ok(checks.every((c) => c.pass), JSON.stringify(checks.filter((c) => !c.pass)));
});

test("allGateChecks refuses to let a decimated sample pass", () => {
  // Only 3 of 24 probes usable — every probe gate must read INSUFFICIENT DATA,
  // never PASS, even with zero flips among survivors.
  const tiny = {
    humanAgreement: null,
    ece: null,
    probes: Object.fromEntries(
      ["position", "names", "verbosity-up", "style-fancy", "whitespace", "prestige", "confidence-hedge", "confident-tone", "fake-citation"].map((id) => [
        id,
        probeWithUsable(3, 0),
      ]),
    ),
    audits: {
      "political-topic": probeWithUsable(3, 0),
      "ideology-left": probeWithUsable(2, 0),
      "ideology-right": probeWithUsable(2, 0),
    },
    reliability: reliabilityReport({ attempted: 312, successful: 30 }),
  };
  const checks = allGateChecks(tiny, GATE_DEFAULTS);
  const insufficient = checks.filter((c) => c.state === "INSUFFICIENT DATA" || c.kind === "insufficient-data");
  assert.ok(insufficient.length >= 10);
  assert.ok(checks.every((c) => !c.pass), "a decimated run must not pass any gate");
  const reliability = checks.find((c) => c.name === "provider reliability");
  assert.equal(reliability.kind, "provider");
  assert.equal(reliability.pass, false);
});

test("buildDiagnostics groups accuracy, calibration, invariance and provider failures", () => {
  const m = {
    bases: [
      { fixture: "f1", expected: "a", winner: "b", a: 40, b: 55, confidence: 0.9, error: null },
      { fixture: "f2", expected: "a", winner: "tie", a: 50, b: 52, confidence: 0.6, error: null },
      { fixture: "f3", expected: "a", winner: "a", a: 60, b: 40, confidence: 0.7, error: null },
      { fixture: "f4", expected: "a", winner: null, error: "429: rate limited" },
    ],
    probeRows: [
      { fixture: "f1", probe: "names", error: null, flip: true, mirrored: false, winner: "b", scoreDelta: 30, confDelta: 0.4 },
      { fixture: "f2", probe: "names", error: null, flip: false, scoreDelta: 2, confDelta: 0.1 },
      { fixture: "f3", probe: "position", error: null, flip: false, mirrored: true },
      { fixture: "f4", probe: "names", error: "503: upstream unavailable" },
    ],
    auditRows: [
      { id: "ideology-left", fixture: "f1", error: null, flipped: true },
      { id: "ideology-left", fixture: "f2", error: null, flipped: false },
      { id: "political-topic", fixture: "f3", error: "This operation was aborted" },
    ],
    calibrationBins: [
      { lo: 0.8, hi: 0.9, total: 5, correct: 1, confSum: 4.4 }, // conf 0.88 vs acc 0.2 -> overconf
      { lo: 0.5, hi: 0.6, total: 4, correct: 4, confSum: 2.0 }, // conf 0.5 vs acc 1.0 -> underconf
    ],
  };
  const d = buildDiagnostics(m);
  assert.equal(d.accuracy.length, 2);
  assert.equal(d.accuracy[0].issue, "wrong winner");
  assert.equal(d.accuracy[1].issue, "tie handling");
  assert.equal(d.calibration.length, 2);
  assert.equal(d.calibration[0].direction, "overconfidence");
  assert.equal(d.calibration[1].direction, "underconfidence");
  assert.equal(d.invariance.length, 2);
  const namesFlip = d.invariance.find((x) => x.probe === "names");
  assert.equal(namesFlip.fixture, "f1");
  assert.equal(namesFlip.baselineWinner, "b");
  assert.equal(namesFlip.perturbedWinner, "b");
  assert.equal(namesFlip.scoreDelta, 30);
  const providerKinds = d.provider.map((p) => p.kind).sort();
  assert.deepEqual(providerKinds, ["5xx", "rate-limit", "timeout"]);
  assert.equal(d.counts.provider, 3);
});

test("classifyProviderError buckets transport failures", () => {
  assert.equal(classifyProviderError("429: rate limited"), "rate-limit");
  assert.equal(classifyProviderError("400: bad request"), "4xx");
  assert.equal(classifyProviderError("503: upstream unavailable"), "5xx");
  assert.equal(classifyProviderError("This operation was aborted"), "timeout");
  assert.equal(classifyProviderError("empty content"), "malformed");
  assert.equal(classifyProviderError("no JSON object in output"), "malformed");
  assert.equal(classifyProviderError("fetch failed"), "network");
  assert.equal(classifyProviderError("no-base"), "upstream-failure");
});

test("failureSummary keeps provider, quality and insufficient buckets separate", () => {
  const checks = [
    { name: "provider reliability", pass: false, kind: "provider" },
    { name: "fixture-label agreement", pass: false, kind: "model-quality" },
    { name: "Names removed [names]", pass: false, kind: "insufficient-data" },
    { name: "ECE", pass: true, kind: "model-quality" },
  ];
  const f = failureSummary(checks);
  assert.deepEqual(f.provider, ["provider reliability"]);
  assert.deepEqual(f.quality, ["fixture-label agreement"]);
  assert.deepEqual(f.insufficient, ["Names removed [names]"]);
  assert.equal(f.allPass, false);
  assert.equal(failureSummary([{ name: "x", pass: true, kind: "model-quality" }]).allPass, true);
});

test("zeroUsableJudges detects a full outage", () => {
  assert.equal(zeroUsableJudges([{ reliability: reliabilityReport({ attempted: 312, successful: 0 }) }]), true);
  assert.equal(
    zeroUsableJudges([{ reliability: reliabilityReport({ attempted: 312, successful: 0 }), agreementN: 0 }]),
    true,
  );
  assert.equal(
    zeroUsableJudges([
      { reliability: reliabilityReport({ attempted: 312, successful: 5 }), agreementN: 5 },
    ]),
    false,
  );
  assert.equal(
    zeroUsableJudges([
      { reliability: reliabilityReport({ attempted: 312, successful: 0 }), agreementN: 0 },
      { reliability: reliabilityReport({ attempted: 312, successful: 20 }), agreementN: 20 },
    ]),
    false,
  );
});

test("attempts log appends without losing history and caps at 40", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jb-"));
  const orig = process.cwd();
  process.chdir(dir);
  try {
    fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
    const entry = (i) => attemptsLogEntry({ at: `2026-09-14T00:00:${String(i).padStart(2, "0")}Z`, limit: 24, results: [{ model: "x", calls: 312, errors: 10 }], outcome: "gate-failure" });
    for (let i = 0; i < 45; i++) appendAttemptsLog(fs, path, entry(i));
    const log = JSON.parse(fs.readFileSync(path.join(dir, "docs", "judge-benchmark-attempts.json"), "utf8"));
    assert.equal(log.length, 40);
    assert.equal(log[0].at, "2026-09-14T00:00:05Z"); // oldest dropped, newest kept
    assert.equal(log[39].at, "2026-09-14T00:00:44Z");
  } finally {
    process.chdir(orig);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
