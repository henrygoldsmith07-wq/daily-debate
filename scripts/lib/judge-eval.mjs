// Benchmark evaluation core: sample-gated probe statistics, provider
// reliability gating and failure diagnostics. Pure functions (no I/O, no
// provider calls) so the scoring rules are unit-testable — see
// judge-eval.test.mjs, run by `npm run test:scripts` (node --test). The CLI
// script keeps only collection + artifact writing.

import { PROBES } from "./judge-transforms.mjs";

export const GATE_DEFAULTS = {
  positionMirrorMin: 0.97,
  verbosityStabilityMin: 0.95,
  nameStabilityMin: 0.97,
  whitespaceStabilityMin: 0.98,
  styleStabilityMin: 0.95,
  prestigeStabilityMin: 0.95,
  hedgingFlipMax: 0.25,
  confidentToneFlipMax: 0.25,
  falseCitationInfluenceMax: 0.05,
  humanAgreementMin: 0.75,
  eceMax: 0.08,
  // Provider reliability: a judge whose provider fails most calls cannot be
  // validated at all — surviving-call metrics would be survivor bias, not
  // measurement. 75% of ATTEMPTED calls must be usable (failed calls stay in
  // the denominator). Explicit, and unchanged once published.
  providerReliabilityMin: 0.75,
};

export const PROVIDER_RELIABILITY_RATIONALE =
  "successful / attempted benchmark calls across bases, probes and audits; failures stay in the denominator so a small surviving subset cannot qualify a failing provider";

export function probeMinUsable(fixtureCount) {
  return Math.max(4, Math.ceil(fixtureCount / 2));
}

const MIRROR = (w) => (w === "a" ? "b" : w === "b" ? "a" : "tie");

// Provider error classification for diagnostics: the chain transport throws
// "<status>: <body>" on HTTP errors, "empty content"/"no JSON object..." on
// malformed responses, and an AbortError on the 35s timeout.
export function classifyProviderError(message) {
  const m = String(message ?? "");
  if (m === "no-base") return "upstream-failure"; // probe skipped: its base call failed
  if (/^429:/.test(m)) return "rate-limit";
  if (/^4\d\d:/.test(m)) return "4xx";
  if (/^5\d\d:/.test(m)) return "5xx";
  if (/abort/i.test(m)) return "timeout";
  if (/empty content|no JSON|JSON\.parse|Unexpected token/i.test(m)) return "malformed";
  return "network";
}

/**
 * Per-judge failure split (item 10): provider/transport problems must never
 * be reported as model-quality failures and vice versa. Every failed gate
 * lands in exactly one bucket: provider (transport), model-quality (the
 * measured judge answered poorly on usable data), or insufficient-data
 * (too few usable calls to answer either way).
 */
export function failureSummary(gates) {
  const summary = {
    provider: [],
    quality: [],
    insufficient: [],
    allPass: gates.length > 0 && gates.every((c) => c.pass),
  };
  for (const c of gates) {
    if (c.pass) continue;
    if (c.kind === "insufficient-data") summary.insufficient.push(c.name);
    else if (c.kind === "provider") summary.provider.push(c.name);
    else summary.quality.push(c.name);
  }
  return summary;
}

/** Aggregate one probe with explicit sample accounting. */
export function probeReport({ id, expected, rows, minUsable }) {
  const attempted = expected;
  const failed = rows.filter((r) => r.error).length + Math.max(0, expected - rows.length); // includes no-base / skipped
  const usable = rows.filter((r) => !r.error).length;
  const flips = rows.filter((r) => !r.error && r.flip).length;
  const flipRate = usable ? +(flips / usable).toFixed(3) : null;
  return {
    probe: id,
    expectedCalls: attempted,
    usableCalls: usable,
    failedCalls: failed,
    completionRatio: attempted ? +(usable / attempted).toFixed(3) : null,
    minUsableSample: minUsable,
    measurable: usable >= minUsable,
    flips,
    flipRate,
    // stability = 1 - flipRate for non-mirrored probes (null below the gate)
    scoreDelta: usable
      ? +(rows.filter((r) => !r.error).reduce((s, r) => s + (r.scoreDelta ?? 0), 0) / usable).toFixed(1)
      : null,
    confDelta: usable
      ? +(rows.filter((r) => !r.error).reduce((s, r) => s + (r.confDelta ?? 0), 0) / usable).toFixed(3)
      : null,
  };
}

/**
 * PASS/FAIL/INSUFFICIENT DATA for one probe against its threshold. A probe
 * below its minimum usable sample can NEVER pass. min-thresholds compare
 * stability (1 - flipRate); max-thresholds compare the raw flip rate.
 */
export function probeVerdict(report, { max = null, min = null } = {}) {
  if (!report.measurable) {
    return { state: "INSUFFICIENT DATA", pass: false, kind: "insufficient-data" };
  }
  const value = min !== null ? +(1 - report.flipRate).toFixed(3) : report.flipRate;
  const ok = min !== null ? value >= min : value <= max;
  return {
    state: ok ? "PASS" : "FAIL",
    pass: ok,
    kind: "model-quality",
    value,
  };
}

export function reliabilityReport({ attempted, successful }) {
  return {
    attemptedCalls: attempted,
    successfulCalls: successful,
    failedCalls: attempted - successful,
    successRatio: attempted ? +(successful / attempted).toFixed(3) : null,
  };
}

export function reliabilityVerdict(report, min) {
  if (!report.attemptedCalls) {
    return { state: "INSUFFICIENT DATA", pass: false, kind: "insufficient-data" };
  }
  const ok = report.successRatio !== null && report.successRatio >= min;
  return { state: ok ? "PASS" : "FAIL", pass: ok, kind: ok ? "provider" : "provider", value: report.successRatio };
}

// --- Gate construction -------------------------------------------------------

export function baseGateChecks(m, gates) {
  const checks = [];
  const add = (name, value, min, max, kind = "model-quality", probeId = null) => {
    if (value === null || value === undefined) {
      checks.push({ name, pass: false, state: "INSUFFICIENT DATA", detail: "insufficient data", kind: "insufficient-data", probe: probeId });
    } else if (min !== undefined) {
      const ok = value >= min;
      checks.push({ name, pass: ok, state: ok ? "PASS" : "FAIL", detail: `${value} (min ${min})`, kind, probe: probeId });
    } else {
      const ok = value <= max;
      checks.push({ name, pass: ok, state: ok ? "PASS" : "FAIL", detail: `${value} (max ${max})`, kind, probe: probeId });
    }
  };
  add("fixture-label agreement", m.humanAgreement, gates.humanAgreementMin, undefined);
  add("ECE", m.ece, undefined, gates.eceMax);
  return checks;
}

const PROBE_GATES = [
  { id: "position", mirrored: true, min: "positionMirrorMin" },
  { id: "names", min: "nameStabilityMin" },
  { id: "verbosity-up", min: "verbosityStabilityMin" },
  { id: "style-fancy", min: "styleStabilityMin" },
  { id: "whitespace", min: "whitespaceStabilityMin" },
  { id: "prestige", min: "prestigeStabilityMin" },
  { id: "confidence-hedge", max: "hedgingFlipMax" },
  { id: "confident-tone", max: "confidentToneFlipMax" },
  { id: "fake-citation", max: "falseCitationInfluenceMax" },
];

export function probeGateChecks(m, gates) {
  const checks = [];
  for (const g of PROBE_GATES) {
    const report = m.probes[g.id];
    if (!report) continue;
    const v = probeVerdict(report, {
      min: g.min ? gates[g.min] : null,
      max: g.max ? gates[g.max] : null,
    });
    const label = PROBES.find((p) => p.id === g.id)?.label ?? g.id;
    const detail =
      v.state === "INSUFFICIENT DATA"
        ? `usable ${report.usableCalls}/${report.expectedCalls} (min ${report.minUsableSample})`
        : `${v.value} vs threshold`;
    checks.push({ name: `${label} [${g.id}]`, pass: v.pass, detail, kind: v.kind, probe: g.id, state: v.state });
  }
  return checks;
}

export function auditGateChecks(m) {
  const checks = [];
  const audits = m.audits ?? {};
  const political = audits["political-topic"];
  const left = audits["ideology-left"];
  const right = audits["ideology-right"];
  if (political) {
    const usable = political.usableCalls;
    if (usable < political.minUsableSample) {
      checks.push({
        name: "political-topic stability",
        pass: false,
        detail: `usable ${usable}/${political.expectedCalls} (min ${political.minUsableSample})`,
        kind: "insufficient-data",
        probe: "political-topic",
        state: "INSUFFICIENT DATA",
      });
    } else {
      checks.push({
        name: "political-topic stability",
        pass: political.flips === 0,
        detail: `${political.flips} flip(s) over ${usable} usable`,
        kind: "model-quality",
        probe: "political-topic",
        state: political.flips === 0 ? "PASS" : "FAIL",
      });
    }
  }
  if (left && right) {
    const usable = left.usableCalls + right.usableCalls;
    const min = left.minUsableSample + right.minUsableSample;
    if (usable < min) {
      checks.push({
        name: "ideological asymmetry",
        pass: false,
        detail: `usable ${usable} (min ${min})`,
        kind: "insufficient-data",
        probe: "ideology",
        state: "INSUFFICIENT DATA",
      });
    } else {
      const asymmetry = Math.abs(left.flips - right.flips);
      const pass = asymmetry <= 1;
      checks.push({
        name: "ideological asymmetry",
        pass,
        detail: `left ${left.flips} vs right ${right.flips} flips (max diff 1)`,
        kind: "model-quality",
        probe: "ideology",
        state: pass ? "PASS" : "FAIL",
      });
    }
  }
  return checks;
}

export function allGateChecks(m, gates) {
  const reliability = m.reliability;
  const checks = [];
  if (reliability) {
    const v = reliabilityVerdict(reliability, gates.providerReliabilityMin);
    checks.push({
      name: "provider reliability",
      pass: v.pass,
      state: v.state,
      detail: `${reliability.successfulCalls}/${reliability.attemptedCalls} = ${reliability.successRatio} (min ${gates.providerReliabilityMin})`,
      kind: v.state === "INSUFFICIENT DATA" ? "insufficient-data" : "provider",
      probe: null,
    });
  }
  checks.push(...baseGateChecks(m, gates), ...probeGateChecks(m, gates), ...auditGateChecks(m));
  return checks;
}

// --- Diagnostics --------------------------------------------------------------

export function buildDiagnostics(m) {
  const accuracy = [];
  for (const b of m.bases ?? []) {
    if (b.error) continue;
    if (b.winner !== b.expected) {
      accuracy.push({
        fixture: b.fixture,
        issue: b.winner === "tie" ? "tie handling" : "wrong winner",
        expected: b.expected,
        got: b.winner,
        scoreA: b.a,
        scoreB: b.b,
        confidence: b.confidence,
      });
    }
  }

  const calibration = [];
  const bins = m.calibrationBins ?? [];
  for (const bin of bins) {
    if (!bin.total) continue;
    const acc = bin.correct / bin.total;
    const conf = bin.confSum / bin.total;
    const gap = +(conf - acc).toFixed(3);
    if (Math.abs(gap) > 0.2) {
      calibration.push({
        confidenceRange: `${(bin.lo ?? 0).toFixed(1)}-${(bin.hi ?? 0).toFixed(1)}`,
        meanConfidence: +conf.toFixed(3),
        accuracy: +acc.toFixed(3),
        gap,
        direction: gap > 0 ? "overconfidence" : "underconfidence",
        n: bin.total,
      });
    }
  }

  const invariance = [];
  for (const r of m.probeRows ?? []) {
    if (r.error || !r.flip) continue;
    const base = (m.bases ?? []).find((b) => b.fixture === r.fixture);
    invariance.push({
      fixture: r.fixture,
      probe: r.probe,
      baselineWinner: base?.winner ?? null,
      perturbedWinner: r.winner ?? null,
      expectedAfterPerturbation: r.mirrored ? MIRROR(base?.winner ?? "tie") : base?.winner ?? null,
      winnerChanged: true,
      scoreDelta: r.scoreDelta ?? null,
      confidenceDelta: r.confDelta ?? null,
    });
  }
  for (const r of m.auditRows ?? []) {
    if (r.error || !r.flipped) continue;
    const base = (m.bases ?? []).find((b) => b.fixture === r.fixture);
    invariance.push({
      fixture: r.fixture,
      probe: r.id,
      baselineWinner: base?.winner ?? null,
      perturbedWinner: null,
      expectedAfterPerturbation: base?.winner ?? null,
      winnerChanged: true,
      scoreDelta: null,
      confidenceDelta: null,
    });
  }

  const provider = {};
  for (const r of [...(m.bases ?? []), ...(m.probeRows ?? []), ...(m.auditRows ?? [])]) {
    if (!r.error) continue;
    const cls = classifyProviderError(r.error);
    const entry = (provider[cls] ??= { kind: cls, calls: 0, examples: [] });
    entry.calls += 1;
    if (entry.examples.length < 3) entry.examples.push(String(r.error).slice(0, 140));
  }

  return {
    accuracy,
    calibration,
    invariance,
    provider: Object.values(provider),
    counts: {
      accuracy: accuracy.length,
      calibration: calibration.length,
      invariance: invariance.length,
      provider: Object.values(provider).reduce((s, e) => s + e.calls, 0),
    },
  };
}

// --- Artifacts ----------------------------------------------------------------

export function zeroUsableJudges(results) {
  return results.every((m) => (m.reliability?.successfulCalls ?? 0) === 0 || (m.agreementN ?? 0) === 0);
}

export function attemptsLogEntry({ at, limit, results, outcome, reason }) {
  return {
    at,
    limit,
    outcome,
    reason: reason ?? null,
    judges: results.map((m) => ({
      model: m.model,
      attempted: m.reliability?.attemptedCalls ?? m.calls ?? 0,
      successful: m.reliability?.successfulCalls ?? Math.max(0, (m.calls ?? 0) - (m.errors ?? 0)),
      reliability: m.reliability?.successRatio ?? null,
      outcome: m.gates ? (m.gates.every((c) => c.pass) ? "PASS" : "FAIL") : "unusable",
    })),
  };
}

export function appendAttemptsLog(fs, path, entry) {
  const file = path.join(process.cwd(), "docs", "judge-benchmark-attempts.json");
  let log = [];
  try {
    log = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(log)) log = [];
  } catch {
    log = [];
  }
  log.push(entry);
  // Cap the append-only history at 40 runs; the full record lives in git.
  fs.writeFileSync(file, JSON.stringify(log.slice(-40), null, 2));
  return file;
}
