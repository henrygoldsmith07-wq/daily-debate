#!/usr/bin/env node
// LIVE judge benchmark. Dependency-free ESM: fixtures, transforms, providers
// and artifact writing live here; every scoring rule (sample gates, provider
// reliability, diagnostics) lives in scripts/lib/judge-eval.mjs, which is
// unit-tested. Node runs both directly (the previous benchmark script
// silently no-op'd because Node cannot import .ts).
//
//   node scripts/judge-benchmark.mjs [--limit N] [--concurrency N] [--enforce]
//        [--out docs/judge-leaderboard.md] [--pack-only] [--allow-skip] [--help]
//
// Gates live in config/judge-gates.json; --enforce exits non-zero on breach.
// --pack-only validates fixture-pack stratification without calling providers.
//
// State truthfulness: docs/latest-judge-benchmark.json holds the LAST VALID
// run only. Every run (including unusable ones) is appended to
// docs/judge-benchmark-attempts.json. A run where no judge produced usable
// base data is recorded there but never overwrites the last valid artifact.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { FIXTURES, STRATA } from "./lib/judge-fixtures.mjs";
import { PROBES, AUDIT_TRANSFORMS } from "./lib/judge-transforms.mjs";
import { allJudgeProviders, estimatedCost, VERDICT_PROMPT_VERSION, buildVerdictSystem, verdictUser, RETRY_POLICY } from "./lib/judge-providers.mjs";
import { EXPERIMENTS, experimentSystem } from "./lib/judge-experiments.mjs";
import {
  GATE_DEFAULTS,
  PROVIDER_RELIABILITY_RATIONALE,
  probeMinUsable,
  probeReport,
  reliabilityReport,
  buildDiagnostics,
  allGateChecks,
  failureSummary,
  zeroUsableJudges,
  attemptsLogEntry,
  appendAttemptsLog,
} from "./lib/judge-eval.mjs";

function loadEnvLocal() {
  const p = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
loadEnvLocal();

const args = process.argv.slice(2);
const argInt = (name, dflt, min, max) => {
  if (args.includes("--help") || args.includes("-h")) return dflt;
  // Accept both --name=N and --name N forms.
  const eq = args.find((x) => x.startsWith(`--${name}=`));
  const raw = eq !== undefined ? eq.split("=")[1] : (() => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? undefined : args[i + 1];
  })();
  if (raw === undefined) return dflt;
  const v = Number(raw);
  if (!Number.isInteger(v) || v < min || v > max) {
    process.stderr.write(`[judge-benchmark] invalid --${name}: expected an integer from ${min} to ${max}\n`);
    process.exit(1);
  }
  return v;
};
const LIMIT = argInt("limit", FIXTURES.length, 1, FIXTURES.length);
const CONCURRENCY = argInt("concurrency", 3, 1, 8);
const ENFORCE = args.includes("--enforce");
const argVal = (name) => {
  const eq = args.find((x) => x.startsWith(`--${name}=`));
  if (eq !== undefined) return eq.split("=")[1];
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
// Experiment discipline (items 7-10): one controlled single-variable prompt
// change per named experiment, repeatable runs saved raw WITHOUT touching the
// published validation record, and per-judge versioning that makes every
// metric attributable to an exact prompt/pack/gates/retry configuration.
const EXPERIMENT = argVal("experiment") ?? "baseline";
const MODELS = (argVal("models") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean); // provider labels to restrict to (e.g. "kiraai") for repeat studies
const RUNS_DIR = argVal("runs-dir"); // save raw run artifacts here; implies no-publish
const NO_PUBLISH = args.includes("--no-publish") || RUNS_DIR !== undefined;
const OUT_MD_ARG = args.find((a) => a.startsWith("--out="));
const OUT_MD = OUT_MD_ARG ? OUT_MD_ARG.split("=")[1] : null;

const log = (...a) => process.stderr.write(a.join(" ") + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Pack integrity: the fixture pack must stay balanced and multi-domain, or the
// agreement/ECE gates degenerate into small-n noise. Runs before any provider
// call so a broken pack fails even without keys (and in --pack-only mode).
function assertPackIntegrity() {
  const errs = [];
  if (STRATA.size < 8) errs.push(`pack too small: ${STRATA.size} fixtures (need >= 8)`);
  for (const [label, n] of Object.entries(STRATA.byExpectedWinner)) {
    if (n < 2) errs.push(`expected-winner stratum "${label}" has only ${n} fixture(s) (need >= 2)`);
  }
  const domains = Object.keys(STRATA.byDomain).length;
  if (domains < 5) errs.push(`only ${domains} domain(s) represented (need >= 5)`);
  const difficulties = Object.keys(STRATA.byDifficulty).length;
  if (difficulties < 2) errs.push(`only ${difficulties} difficulty class(es) represented (need >= 2)`);
  for (const f of FIXTURES) {
    if (!["a", "b", "tie"].includes(f.expectedWinner)) errs.push(`${f.id}: invalid expectedWinner "${f.expectedWinner}"`);
    if (f.transcript.split("\n").length < 4) errs.push(`${f.id}: transcript shorter than 4 turns`);
    if (!f.domain || !f.difficulty) errs.push(`${f.id}: missing domain/difficulty stratification`);
  }
  if (errs.length) {
    process.stderr.write("[judge-benchmark] fixture-pack integrity failed:\n  - " + errs.join("\n  - ") + "\n");
    process.exit(1);
  }
  log(`[judge-benchmark] pack: ${STRATA.size} fixtures, winners=${JSON.stringify(STRATA.byExpectedWinner)}, domains=${domains}, difficulties=${difficulties}`);
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    }),
  );
  return out;
}

async function evaluateModel(judge) {
  const fixtures = FIXTURES.slice(0, LIMIT);
  const bases = [];
  const latencySamples = [];
  const tokenSamples = [];
  // Progress visibility: the probe/audit phases are silent, so a slow free
  // pool looked like a hang. Count every completed call against the judge's
  // total budget (base + probes + audits).
  const totalCalls = fixtures.length + fixtures.length * PROBES.length + fixtures.length * AUDIT_TRANSFORMS.length;
  let doneCalls = 0;
  const tick = (label) => {
    doneCalls += 1;
    if (doneCalls % 24 === 0 || doneCalls === totalCalls) {
      log(`  [${judge.id}] ${doneCalls}/${totalCalls} calls (${label})`);
    }
  };
  for (const f of fixtures) {
    try {
      const v = await judge.fn(f.transcript);
      bases.push({ fixture: f.id, expected: f.expectedWinner, ...v });
      if (v.latencyMs != null) latencySamples.push(v.latencyMs);
      if (v.promptTokens != null || v.completionTokens != null) tokenSamples.push({ prompt: v.promptTokens ?? 0, completion: v.completionTokens ?? 0 });
    } catch (e) {
      log(`  [base] ${f.id}: ${String(e?.message ?? e).slice(0, 120)}`);
      bases.push({ fixture: f.id, expected: f.expectedWinner, error: String(e?.message ?? e) });
    }
    tick("base");
    await sleep(250);
  }
  const okBases = bases.filter((b) => !b.error);

  const probeJobs = fixtures.flatMap((f) => PROBES.map((probe) => ({ f, probe })));
  const probeRows = await mapLimit(probeJobs, CONCURRENCY, async ({ f, probe }) => {
    const base = okBases.find((b) => b.fixture === f.id);
    if (!base) { tick("probe"); return { fixture: f.id, probe: probe.id, mirrored: probe.mirrored === true, error: "no-base" }; }
    try {
      const v = await judge.fn(probe.fn(f.transcript));
      if (v.latencyMs != null) latencySamples.push(v.latencyMs);
      if (v.promptTokens != null || v.completionTokens != null) tokenSamples.push({ prompt: v.promptTokens ?? 0, completion: v.completionTokens ?? 0 });
      const flip = probe.mirrored ? v.winner !== mirror(base.winner) : v.winner !== base.winner;
      tick("probes");
      return {
        fixture: f.id,
        probe: probe.id,
        mirrored: probe.mirrored === true,
        flip,
        winner: v.winner,
        scoreDelta: Math.abs(v.a - base.a) + Math.abs(v.b - base.b),
        confDelta: Math.abs(v.confidence - base.confidence),
        tokens: v.tokens ?? 0,
      };
    } catch (e) {
      tick("probes");
      return { fixture: f.id, probe: probe.id, mirrored: probe.mirrored === true, error: String(e?.message ?? e).slice(0, 100) };
    }
  });

  const auditRows = await mapLimit(
    AUDIT_TRANSFORMS.flatMap((t) => fixtures.map((f) => ({ t, f }))),
    CONCURRENCY,
    async ({ t, f }) => {
      const base = okBases.find((b) => b.fixture === f.id);
      if (!base) { tick("audits"); return { id: t.id, fixture: f.id, error: "no-base" }; }
      try {
        const v = await judge.fn(t.fn(f.transcript));
        if (v.latencyMs != null) latencySamples.push(v.latencyMs);
        if (v.promptTokens != null || v.completionTokens != null) tokenSamples.push({ prompt: v.promptTokens ?? 0, completion: v.completionTokens ?? 0 });
        tick("audits");
        return { id: t.id, fixture: f.id, winner: v.winner, flipped: v.winner !== base.winner };
      } catch (e) {
        tick("audits");
        return { id: t.id, fixture: f.id, error: String(e?.message ?? e).slice(0, 100) };
      }
    },
  );

  // --- Scoring: all rules live in judge-eval.mjs (unit-tested) ------------
  const minUsable = probeMinUsable(fixtures.length);
  const probeReports = {};
  for (const p of PROBES) {
    const rows = probeRows.filter((r) => r.probe === p.id);
    probeReports[p.id] = probeReport({
      id: p.id,
      expected: fixtures.length,
      rows,
      minUsable,
    });
  }
  const auditReports = {};
  for (const t of AUDIT_TRANSFORMS) {
    const rows = auditRows.filter((r) => r.id === t.id);
    const report = probeReport({
      id: t.id,
      expected: fixtures.length,
      rows: rows.map((r) => ({ ...r, flip: r.flipped })),
      minUsable,
    });
    auditReports[t.id] = report;
  }

  // Provider reliability: actual calls issued vs calls that returned usable
  // data. No-base rows issued no provider call, so they are excluded from
  // the denominator here (their cause is already counted as a base failure)
  // but surface in diagnostics as upstream failures.
  const actualProbeCalls = probeRows.filter((r) => r.error !== "no-base");
  const actualAuditCalls = auditRows.filter((r) => r.error !== "no-base");
  const reliability = reliabilityReport({
    attempted: bases.length + actualProbeCalls.length + actualAuditCalls.length,
    successful:
      okBases.length +
      actualProbeCalls.filter((r) => !r.error).length +
      actualAuditCalls.filter((r) => !r.error).length,
  });

  const stability = {};
  for (const p of PROBES) {
    const report = probeReports[p.id];
    if (p.mirrored) continue;
    stability[p.id] = report.measurable ? +(1 - report.flipRate).toFixed(3) : null;
  }
  const position = probeReports.position;

  // Minimum-sample gating for the two base-verdict metrics: agreement/ECE
  // from a handful of calls is noise, not measurement. Half the pack is the
  // floor; thresholds themselves are unchanged.
  const MIN_AGREEMENT_SAMPLES = minUsable;
  const humanAgree = okBases.filter((b) => b.winner === b.expected).length;
  const agreementN = okBases.length;
  const humanAgreement = agreementN >= MIN_AGREEMENT_SAMPLES
    ? +(humanAgree / agreementN).toFixed(3)
    : null;

  const bins = Array.from({ length: 10 }, (_, i) => ({ lo: i / 10, hi: (i + 1) / 10, total: 0, correct: 0, confSum: 0 }));
  for (const b of okBases) {
    const bin = Math.min(9, Math.floor((b.confidence ?? 0) * 10));
    bins[bin].total += 1;
    bins[bin].confSum += b.confidence ?? 0;
    if (b.winner === b.expected) bins[bin].correct += 1;
  }
  const binTotal = bins.reduce((s, x) => s + x.total, 0);
  const ece = agreementN >= MIN_AGREEMENT_SAMPLES && binTotal
    ? +(bins.reduce((s, x) => (x.total ? s + (x.total / binTotal) * Math.abs(x.correct / x.total - x.confSum / x.total) : s), 0)).toFixed(3)
    : null;

  const latencies = latencySamples.length
    ? {
        n: latencySamples.length,
        meanMs: Math.round(latencySamples.reduce((s, x) => s + x, 0) / latencySamples.length),
        p50Ms: latencySamples.slice().sort((a, b) => a - b)[Math.floor(latencySamples.length / 2)],
        maxMs: Math.max(...latencySamples),
      }
    : null;
  const promptTokens = tokenSamples.reduce((s, x) => s + (x.prompt || 0), 0);
  const completionTokens = tokenSamples.reduce((s, x) => s + (x.completion || 0), 0);
  const allTokens = promptTokens + completionTokens;
  const costUsd = estimatedCost(judge.id.slice(judge.id.indexOf(":") + 1), promptTokens, completionTokens);

  const scoringModel = {
    model: judge.id,
    bases,
    probeRows,
    auditRows,
    calibrationBins: bins,
  };
  const diagnostics = buildDiagnostics(scoringModel);

  return {
    model: judge.id,
    judge: { provider: judge.id.split(":")[0], model: judge.id.split(":")[1] ?? judge.id, temperature: 0, promptVersion: VERDICT_PROMPT_VERSION, tieThreshold: 5 },
    fixtures: fixtures.length,
    bases: bases.map((b) => ({ fixture: b.fixture, expected: b.expected, winner: b.winner ?? null, model: b.model ?? null, a: b.a ?? null, b: b.b ?? null, confidence: b.confidence ?? null, error: b.error ? String(b.error).slice(0, 120) : undefined })),
    calls: bases.length + probeRows.length + auditRows.length,
    errors: [...bases, ...probeRows, ...auditRows].filter((r) => r.error).length,
    reliability,
    // Transport truthfulness (item 11): retries make the measurement match
    // production behaviour, but the ATTEMPT counts below expose exactly how
    // much retrying happened - systematic provider unreliability cannot hide
    // behind successful retries.
    transport: judge.stats ? {
      jobs: judge.stats.jobs,
      transportAttempts: judge.stats.attempts,
      succeededAttempts: judge.stats.succeeded,
      failedAttempts: judge.stats.errors,
      retryOverheadAttempts: judge.stats.attempts - judge.stats.jobs,
      backoffMsSpent: judge.stats.backoffMs,
      attemptsByModel: judge.stats.byModel,
    } : null,
    // legacy convenience fields (derived; gates read the reports below)
    positionMirrorOk: position.measurable ? +(1 - (position.flipRate ?? 0)).toFixed(3) : null,
    stability,
    falseCitationInfluence: probeReports["fake-citation"].flipRate,
    ideologicalAsymmetry: { leftFlips: auditReports["ideology-left"].flips, rightFlips: auditReports["ideology-right"].flips },
    politicalTopicFlips: auditReports["political-topic"].flips,
    humanAgreement,
    agreementN,
    minAgreementSamples: MIN_AGREEMENT_SAMPLES,
    ece,
    totalTokens: allTokens || null,
    promptTokens: promptTokens || null,
    completionTokens: completionTokens || null,
    estimatedCostUsd: costUsd,
    latency: latencies,
    probes: probeReports,
    audits: auditReports,
    diagnostics,
    probeExceptions: probeRows
      .filter((r) => r.error || r.flip)
      .map((r) => ({ fixture: r.fixture, probe: r.probe, error: r.error, flip: r.flip ?? null, scoreDelta: r.scoreDelta ?? null, confDelta: r.confDelta ?? null })),
    auditExceptions: auditRows
      .filter((r) => r.error || r.flipped)
      .map((r) => ({ fixture: r.fixture, audit: r.id, error: r.error ?? null })),
  };
}

function mirror(w) {
  return w === "a" ? "b" : w === "b" ? "a" : "tie";
}

function loadGates() {
  const p = path.join(process.cwd(), "config", "judge-gates.json");
  if (!fs.existsSync(p)) return GATE_DEFAULTS;
  return { ...GATE_DEFAULTS, ...JSON.parse(fs.readFileSync(p, "utf8")) };
}

async function main() {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(
      [
        "Live judge benchmark over the 24-fixture pack.",
        "",
        "Usage:",
        "  node scripts/judge-benchmark.mjs [--limit N] [--concurrency N] [--enforce] [--out PATH] [--pack-only] [--allow-skip]",
        "",
        "  --limit N        fixtures to judge (1-24; default 24)",
        "  --concurrency N  parallel provider calls (1-8; default 3)",
        "  --enforce        exit non-zero when any gate fails",
        "  --experiment NAME single-variable prompt experiment (see scripts/lib/judge-experiments.mjs)",
        "  --runs-dir DIR   save the raw run artifact there and do NOT touch published records",
        "  --no-publish     compute and print only; never write docs/ records",
        "  --pack-only      validate fixtures only; never calls providers",
        "  --allow-skip     allow a no-key run to exit 0 (deliberate key-less contexts only)",
        "",
      ].join("\n"),
    );
    return;
  }
  assertPackIntegrity();
  if (args.includes("--pack-only")) {
    process.stdout.write(JSON.stringify({ packOnly: true, strata: STRATA }) + "\n");
    return;
  }

  let system;
  try {
    system = experimentSystem(EXPERIMENT).system;
  } catch (e) {
    process.stderr.write(`[judge-benchmark] ${String(e?.message ?? e)}\n`);
    process.exit(2);
  }
  const judges = allJudgeProviders(process.env, { system }).filter(
    (j) => MODELS.length === 0 || MODELS.includes(j.id.split(":")[0]),
  );
  if (MODELS.length > 0 && judges.length === 0) {
    process.stderr.write(`[judge-benchmark] --models ${MODELS.join(",")} matched no configured provider.\n`);
    process.exit(2);
  }
  if (!judges.length) {
    // A missing-key run must never masquerade as a green validation: the
    // workflow gate is --enforce, and skipping without failing would let a
    // secrets regression ship unnoticed. Exit non-zero with an explicit
    // reason so CI reports the true state.
    const allowSkip = args.includes("--allow-skip") || process.env.JUDGE_BENCHMARK_ALLOW_SKIP === "1";
    if (allowSkip) {
      log("[judge-benchmark] skipped - no provider key set (OPENROUTER_API_KEY / UNOROUTER_API_KEY / KIRAAI_API_KEY / NVIDIA_API_KEY) (allowed)");
      process.stdout.write(JSON.stringify({ skipped: true, allowed: true }) + "\n");
      return;
    }
    log("[judge-benchmark] FAILED - no judge is configured (set OPENROUTER_API_KEY or another provider key). A live validation run cannot be skipped silently.");
    process.stdout.write(JSON.stringify({ skipped: true, error: "no judge configured" }) + "\n");
    process.exit(1);
  }
  log(`[judge-benchmark] models=${judges.map((j) => j.id).join(", ")} limit=${LIMIT} concurrency=${CONCURRENCY} experiment=${EXPERIMENT} publish=${NO_PUBLISH ? "off" : "on"}`);

  const results = [];
  for (const judge of judges) {
    log(`[judge-benchmark] evaluating ${judge.id}`);
    results.push(await evaluateModel(judge));
  }

  const gates = loadGates();
  const gated = results.map((m) => {
    const checks = allGateChecks(m, gates);
    return { ...m, gates: checks, failures: failureSummary(checks) };
  });
  const allPass = gated.every((m) => m.gates.every((c) => c.pass));
  const at = new Date().toISOString();

  // Full attributability (item 10): every artifact records the EXACT prompt
  // (hash), fixture pack, gates file and retry policy that produced it, so a
  // metric movement maps to one controlled change, never to "a new prompt".
  const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);
  const experimentMeta = EXPERIMENTS[EXPERIMENT]
    ? { name: EXPERIMENT, hypothesis: EXPERIMENTS[EXPERIMENT].hypothesis, label: EXPERIMENTS[EXPERIMENT].label }
    : { name: EXPERIMENT, hypothesis: null, label: null };
  const versions = {
    promptVersion: VERDICT_PROMPT_VERSION,
    promptHash: sha(system + "\n---\n" + verdictUser("")),
    defaultPromptHash: sha(buildVerdictSystem() + "\n---\n" + verdictUser("")),
    experiment: experimentMeta,
    fixturePackHash: sha(JSON.stringify(FIXTURES.map((f) => [f.id, f.expectedWinner, f.transcript]))),
    fixturePackSize: FIXTURES.length,
    scoringEngineVersion: 1,
    graphSchemaVersion: 1,
    retryPolicy: RETRY_POLICY,
    gatesHash: sha(JSON.stringify(gates)),
  };

  // State truthfulness: every attempt is logged (append-only, capped); the
  // "latest" artifact holds the last run with at least one usable judge. A
  // total outage is recorded as an attempt, never as current validation.
  // Experiment/repeat runs (--no-publish or --runs-dir) save raw artifacts
  // only - they never overwrite or append to the published record.
  const unusable = zeroUsableJudges(gated);
  const attemptEntry = attemptsLogEntry({
    at,
    limit: LIMIT,
    results: gated,
    outcome: unusable ? "insufficient-data" : allPass ? "pass" : "gate-failure",
    reason: unusable ? "no judge produced usable base data (provider outage?)" : null,
  });
  const attemptsPath = NO_PUBLISH ? null : appendAttemptsLog(fs, path, attemptEntry);

  const payload = { at, limit: LIMIT, enforce: ENFORCE, strata: STRATA, allPass, gates, versions, results: gated };
  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");

  if (RUNS_DIR) {
    fs.mkdirSync(RUNS_DIR, { recursive: true });
    const slug = gated.map((m) => m.model.split(":")[0]).join("+");
    const file = path.join(RUNS_DIR, `${at.replace(/[:.]/g, "")}-${slug}.json`);
    fs.writeFileSync(file, JSON.stringify(payload, null, 2));
    log(`[judge-benchmark] raw run saved to ${file} (published record untouched)`);
  }
  if (NO_PUBLISH) {
    for (const m of gated) {
      log(`--- ${m.model} (unpublished) ---`);
      for (const c of m.gates) log(`  ${c.pass ? "PASS" : "FAIL"} ${c.name}: ${c.detail}`);
    }
    log(`[judge-benchmark] allPass=${allPass} (run not published)`);
    return;
  }

  if (unusable) {
    log(`[judge-benchmark] OUTAGE: no judge produced usable base data. Attempt recorded in ${attemptsPath}; last valid artifact NOT overwritten.`);
    process.stdout.write(JSON.stringify({ zeroUsable: true, at, attemptsFile: path.basename(attemptsPath) }) + "\n");
    if (ENFORCE) process.exit(1);
    return;
  }

  const outPath = path.join(process.cwd(), "docs", "latest-judge-benchmark.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));

  const mdTarget = OUT_MD || path.join(process.cwd(), "docs", "judge-leaderboard.md");
  fs.mkdirSync(path.dirname(mdTarget), { recursive: true });

  // The leaderboard publishes the CURRENT validation state, one row per
  // judge in this run. History lives in git, the JSON artifact and the
  // attempts log; stale rows never accumulate into current validation.
  const passCells = (m) => (m.gates ?? []).every((c) => c.pass) ? "PASS" : "FAIL";
  const header = [
    "# Judge leaderboard (live benchmarks)",
    "",
    `Last generated ${at} by \`scripts/judge-benchmark.mjs\` over ${LIMIT} labelled fixture debates.`,
    `Pack stratification: ${STRATA.size} fixtures, expected-winner ${JSON.stringify(STRATA.byExpectedWinner)}, ${Object.keys(STRATA.byDomain).length} domains, difficulty ${JSON.stringify(STRATA.byDifficulty)}.`,
    `Judge configuration: temperature 0, prompt v${VERDICT_PROMPT_VERSION}, scoring engine v1, graph schema v1 (benchmark verdict prompt aligned with the production judging policy; see src/lib/judgeVersioning.ts for the app's versioned judge).`,
    `Provider reliability gate: successful/attempted calls ≥ ${gates.providerReliabilityMin} (${PROVIDER_RELIABILITY_RATIONALE}). A probe with fewer than half the pack's usable calls reports INSUFFICIENT DATA — it can never pass on a small surviving sample.`,
    "Human agreement here is against fixture labels (small n) until the rated corpus supplies consensus.",
    "",
    "| Model | Fixtures | Reliability (ok/att) | Agreement (usable n) | ECE | Position mirror | Verbosity stab. | Names stab. | Whitespace stab. | Fake-cit. | Ideology L/R flips | Political flips | Latency p50 | Tokens | Est. cost | PASS/FAIL |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  const newRow = (m) =>
    `| ${m.model} | ${m.fixtures ?? LIMIT} | ${m.reliability.successfulCalls}/${m.reliability.attemptedCalls} (${Math.round((m.reliability.successRatio ?? 0) * 100)}%) | ${m.humanAgreement ?? "—"} (n=${m.agreementN ?? 0}) | ${m.ece ?? "—"} | ${m.positionMirrorOk ?? "—"} | ${m.stability["verbosity-up"] ?? "—"} | ${m.stability.names ?? "—"} | ${m.stability.whitespace ?? "—"} | ${m.falseCitationInfluence ?? "—"} | ${m.ideologicalAsymmetry?.leftFlips ?? "—"}/${m.ideologicalAsymmetry?.rightFlips ?? "—"} | ${m.politicalTopicFlips ?? "—"} | ${m.latency ? `${m.latency.p50Ms}ms` : "—"} | ${m.totalTokens ?? "—"} | ${m.estimatedCostUsd != null ? `$${m.estimatedCostUsd}` : "—"} | ${passCells(m)} |`;
  const body = gated.map(newRow).sort().join("\n");

  // Per-model gate detail: every check's state, including INSUFFICIENT DATA,
  // is public. Thresholds live in config/judge-gates.json.
  const detailLines = [];
  for (const m of gated) {
    detailLines.push("", `### ${m.model} — ${passCells(m)}`);
    for (const c of m.gates) detailLines.push(`- ${c.pass ? "PASS" : c.state === "INSUFFICIENT DATA" ? "INSUFFICIENT DATA" : "FAIL"} ${c.name}: ${c.detail}`);
    const f = m.failures;
    if (f && !(f.provider.length === 0 && f.quality.length === 0 && f.insufficient.length === 0)) {
      detailLines.push(`- failure split: ${f.provider.length} provider-reliability, ${f.quality.length} model-quality, ${f.insufficient.length} insufficient-data (provider problems are never blamed on the model and vice versa)`);
    }
    if (m.diagnostics?.counts) {
      const dc = m.diagnostics.counts;
      detailLines.push(`- diagnostics: ${dc.accuracy} accuracy issue(s), ${dc.calibration} calibration bin(s) flagged, ${dc.invariance} invariance flip(s), ${dc.provider} provider error call(s) — full detail in docs/latest-judge-benchmark.json`);
    }
  }
  fs.writeFileSync(
    mdTarget,
    [
      ...header,
      body,
      "",
      "## Per-model gate detail",
      ...detailLines,
      "",
      `Gates: ${JSON.stringify(gates)}`,
      "",
      `Last run: ${allPass ? "PASS" : "FAIL"} (${at}). Gate status is per-row; a FAIL row means that model must not be trusted for competitive claims until it passes. Run history: docs/judge-benchmark-attempts.json.`,
      "",
    ].join("\n"),
  );

  for (const m of gated) {
    log(`--- ${m.model} ---`);
    for (const c of m.gates) log(`  ${c.pass ? "PASS" : "FAIL"} ${c.name}: ${c.detail}`);
  }
  log(`[judge-benchmark] allPass=${allPass}`);
  if (ENFORCE && !allPass) process.exit(1);
}

main().catch((e) => {
  process.stderr.write(String(e?.stack ?? e) + "\n");
  process.exit(1);
});
