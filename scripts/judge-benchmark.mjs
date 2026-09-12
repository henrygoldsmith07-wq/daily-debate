#!/usr/bin/env node
// LIVE judge benchmark. Dependency-free ESM: fixtures, transforms, providers,
// metrics and gates are all plain JS so Node runs it directly (the previous
// benchmark script silently no-op'd because Node cannot import .ts).
//
//   node scripts/judge-benchmark.mjs [--limit N] [--concurrency N] [--enforce]
//        [--out docs/judge-leaderboard.md] [--pack-only] [--allow-skip] [--help]
//
// Gates live in config/judge-gates.json; --enforce exits non-zero on breach.
// --pack-only validates fixture-pack stratification without calling providers.

import fs from "node:fs";
import path from "node:path";
import { FIXTURES, STRATA } from "./lib/judge-fixtures.mjs";
import { PROBES, AUDIT_TRANSFORMS } from "./lib/judge-transforms.mjs";
import { allJudgeProviders, estimatedCost } from "./lib/judge-providers.mjs";

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
  const a = args.find((x) => x.startsWith(`--${name}`));
  if (!a) return dflt;
  const v = Number(a.split("=")[1]);
  if (!Number.isInteger(v) || v < min || v > max) {
    process.stderr.write(`[judge-benchmark] invalid --${name}: expected an integer from ${min} to ${max}\n`);
    process.exit(1);
  }
  return v;
};
const LIMIT = argInt("limit", FIXTURES.length, 1, FIXTURES.length);
const CONCURRENCY = argInt("concurrency", 3, 1, 8);
const ENFORCE = args.includes("--enforce");
const OUT_MD_ARG = args.find((a) => a.startsWith("--out="));
const OUT_MD = OUT_MD_ARG ? OUT_MD_ARG.split("=")[1] : null;

const log = (...a) => process.stderr.write(a.join(" ") + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mirror = (w) => (w === "a" ? "b" : w === "b" ? "a" : "tie");

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
    await sleep(250);
  }
  const okBases = bases.filter((b) => !b.error);

  const probeJobs = fixtures.flatMap((f) => PROBES.map((probe) => ({ f, probe })));
  const probeResults = await mapLimit(probeJobs, CONCURRENCY, async ({ f, probe }) => {
    const base = okBases.find((b) => b.fixture === f.id);
    if (!base) return { probe: probe.id, error: "no-base" };
    try {
      const v = await judge.fn(probe.fn(f.transcript));
      if (v.latencyMs != null) latencySamples.push(v.latencyMs);
      if (v.promptTokens != null || v.completionTokens != null) tokenSamples.push({ prompt: v.promptTokens ?? 0, completion: v.completionTokens ?? 0 });
      const flip = probe.mirrored ? v.winner !== mirror(base.winner) : v.winner !== base.winner;
      return {
        probe: probe.id,
        flip,
        scoreDelta: Math.abs(v.a - base.a) + Math.abs(v.b - base.b),
        confDelta: Math.abs(v.confidence - base.confidence),
        tokens: v.tokens ?? 0,
      };
    } catch (e) {
      return { probe: probe.id, error: String(e?.message ?? e).slice(0, 100) };
    }
  });

  const auditResults = await mapLimit(
    AUDIT_TRANSFORMS.flatMap((t) => fixtures.map((f) => ({ t, f }))),
    CONCURRENCY,
    async ({ t, f }) => {
      const base = okBases.find((b) => b.fixture === f.id)?.winner;
      if (!base) return { id: t.id, error: true };
      try {
        const v = await judge.fn(t.fn(f.transcript));
        if (v.latencyMs != null) latencySamples.push(v.latencyMs);
        if (v.promptTokens != null || v.completionTokens != null) tokenSamples.push({ prompt: v.promptTokens ?? 0, completion: v.completionTokens ?? 0 });
        return { id: t.id, flipped: v.winner !== base };
      } catch {
        return { id: t.id, error: true };
      }
    },
  );

  const agg = (pid) => {
    const rows = probeResults.filter((r) => r.probe === pid && !r.error);
    const flips = rows.filter((r) => r.flip).length;
    return {
      n: rows.length,
      flips,
      flipRate: rows.length ? +(flips / rows.length).toFixed(3) : null,
      scoreDelta: +(rows.reduce((s, r) => s + (r.scoreDelta ?? 0), 0) / (rows.length || 1)).toFixed(1),
      confDelta: +(rows.reduce((s, r) => s + (r.confDelta ?? 0), 0) / (rows.length || 1)).toFixed(3),
    };
  };

  const stability = {};
  for (const p of PROBES) {
    if (p.mirrored || ["confidence-hedge", "confident-tone", "fake-citation"].includes(p.id)) continue;
    const a = agg(p.id);
    stability[p.id] = a.n ? +(1 - a.flipRate).toFixed(3) : null;
  }
  const position = agg("position");
  const fake = agg("fake-citation");
  const ideology = (id) => auditResults.filter((r) => r.id === id && !r.error && r.flipped).length;

  const humanAgree = okBases.filter((b) => b.winner === b.expected).length;
  const humanAgreement = okBases.length ? +(humanAgree / okBases.length).toFixed(3) : null;

  const bins = Array.from({ length: 10 }, () => ({ total: 0, correct: 0, confSum: 0 }));
  for (const b of okBases) {
    const bin = Math.min(9, Math.floor((b.confidence ?? 0) * 10));
    bins[bin].total += 1;
    bins[bin].confSum += b.confidence ?? 0;
    if (b.winner === b.expected) bins[bin].correct += 1;
  }
  const binTotal = bins.reduce((s, x) => s + x.total, 0);
  const ece = binTotal
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
  const allTokens = probeResults.reduce((s, r) => s + (r.tokens ?? 0), 0) || promptTokens + completionTokens;
  const costUsd = estimatedCost(judge.id.slice(judge.id.indexOf(":") + 1), promptTokens, completionTokens);

  return {
    model: judge.id,
    judge: { provider: judge.id.split(":")[0], model: judge.id.split(":")[1] ?? judge.id, temperature: 0, promptVersion: 3 },
    fixtures: fixtures.length,
    calls: bases.length + probeResults.length + auditResults.length,
    errors: [...bases, ...probeResults, ...auditResults].filter((r) => r.error).length,
    positionMirrorOk: position.n ? +(1 - position.flipRate).toFixed(3) : null,
    stability,
    verbosityFlipRate: agg("verbosity-up").flipRate,
    falseCitationInfluence: fake.flipRate,
    ideologicalAsymmetry: { leftFlips: ideology("ideology-left"), rightFlips: ideology("ideology-right") },
    politicalTopicFlips: auditResults.filter((r) => r.id === "political-topic" && r.flipped).length,
    humanAgreement,
    ece,
    totalTokens: allTokens || null,
    promptTokens: promptTokens || null,
    completionTokens: completionTokens || null,
    estimatedCostUsd: costUsd,
    latency: latencies,
    probes: Object.fromEntries(PROBES.map((p) => [p.id, agg(p.id)])),
  };
}

function loadGates() {
  const p = path.join(process.cwd(), "config", "judge-gates.json");
  const defaults = {
    positionMirrorMin: 0.97,
    verbosityStabilityMin: 0.95,
    nameStabilityMin: 0.97,
    whitespaceStabilityMin: 0.98,
    falseCitationInfluenceMax: 0.05,
    humanAgreementMin: 0.75,
    eceMax: 0.08,
  };
  if (!fs.existsSync(p)) return defaults;
  return { ...defaults, ...JSON.parse(fs.readFileSync(p, "utf8")) };
}

function gateChecks(m, gates) {
  const checks = [];
  const add = (name, value, min, max) => {
    if (value === null || value === undefined) checks.push({ name, pass: false, detail: "insufficient data" });
    else if (min !== undefined) checks.push({ name, pass: value >= min, detail: `${value} (min ${min})` });
    else checks.push({ name, pass: value <= max, detail: `${value} (max ${max})` });
  };
  add("position mirror stability", m.positionMirrorOk, gates.positionMirrorMin, undefined);
  add("verbosity stability", m.stability["verbosity-up"], gates.verbosityStabilityMin, undefined);
  add("name-removal stability", m.stability.names, gates.nameStabilityMin, undefined);
  add("whitespace stability", m.stability.whitespace, gates.whitespaceStabilityMin, undefined);
  add("false-citation influence", m.falseCitationInfluence, undefined, gates.falseCitationInfluenceMax);
  add("fixture-label agreement", m.humanAgreement, gates.humanAgreementMin, undefined);
  add("ECE", m.ece, undefined, gates.eceMax);
  return checks;
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

  const judges = allJudgeProviders(process.env);
  if (!judges.length) {
    // A missing-key run must never masquerade as a green validation: the
    // workflow gate is --enforce, and skipping without failing would let a
    // secrets regression ship unnoticed. Exit non-zero with an explicit
    // reason so CI reports the true state.
    const allowSkip = args.includes("--allow-skip") || process.env.JUDGE_BENCHMARK_ALLOW_SKIP === "1";
    if (allowSkip) {
      log("[judge-benchmark] skipped - no provider key set (OPENROUTER_API_KEY / UNOROUTER_API_KEY / KIRAAI_API_KEY / BAI_API_KEY / NVIDIA_API_KEY) (allowed)");
      process.stdout.write(JSON.stringify({ skipped: true, allowed: true }) + "\n");
      return;
    }
    log("[judge-benchmark] FAILED - no judge is configured (set OPENROUTER_API_KEY or another provider key). A live validation run cannot be skipped silently.");
    process.stdout.write(JSON.stringify({ skipped: true, error: "no judge configured" }) + "\n");
    process.exit(1);
  }
  log(`[judge-benchmark] models=${judges.map((j) => j.id).join(", ")} limit=${LIMIT} concurrency=${CONCURRENCY}`);

  const results = [];
  for (const judge of judges) {
    log(`[judge-benchmark] evaluating ${judge.id}`);
    results.push(await evaluateModel(judge));
  }

  const gates = loadGates();
  const gated = results.map((m) => ({ ...m, gates: gateChecks(m, gates) }));
  const allPass = gated.every((m) => m.gates.every((c) => c.pass));
  const at = new Date().toISOString();
  const payload = { at, limit: LIMIT, enforce: ENFORCE, strata: STRATA, allPass, gates, results: gated };

  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  const outPath = path.join(process.cwd(), "docs", "latest-judge-benchmark.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));

  const mdTarget = OUT_MD || path.join(process.cwd(), "docs", "judge-leaderboard.md");
  fs.mkdirSync(path.dirname(mdTarget), { recursive: true });

  // Merge-by-model-row so repeated runs accumulate one comparison table.
  // Historical gate status is preserved: rows whose gate results changed keep
  // their own record in the JSON, not silently overwritten in the table.
  const passCells = (m) => (m.gates ?? []).every((c) => c.pass) ? "PASS" : "FAIL";
  const header = [
    "# Judge leaderboard (live benchmarks)",
    "",
    `Last generated ${at} by \`scripts/judge-benchmark.mjs\` over ${LIMIT} labelled fixture debates.`,
    `Pack stratification: ${STRATA.size} fixtures, expected-winner ${JSON.stringify(STRATA.byExpectedWinner)}, ${Object.keys(STRATA.byDomain).length} domains, difficulty ${JSON.stringify(STRATA.byDifficulty)}.`,
    `Judge configuration: temperature 0, prompt v3, scoring engine v1, graph schema v1 (see src/lib/judgeVersioning.ts).`,
    "Human agreement here is against fixture labels (small n) until the rated corpus supplies consensus.",
    "",
    "| Model | Fixtures | Agreement | ECE | Position mirror | Verbosity stab. | Names stab. | Whitespace stab. | Fake-cit. | Ideology L/R flips | Political flips | Errors | Latency p50 | Tokens | Est. cost | PASS/FAIL |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  const existing = fs.existsSync(mdTarget) ? fs.readFileSync(mdTarget, "utf8").split(/\r?\n/) : [];
  const priorRows = new Map();
  for (const line of existing) {
    if (!/^\| (nvidia|openrouter|unorouter|kiraai|bai|anthropic)/.test(line)) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length > 2) priorRows.set(cells[1], line);
  }
  const newRow = (m) =>
    `| ${m.model} | ${m.fixtures ?? LIMIT} | ${m.humanAgreement ?? "—"} | ${m.ece ?? "—"} | ${m.positionMirrorOk ?? "—"} | ${m.stability["verbosity-up"] ?? "—"} | ${m.stability.names ?? "—"} | ${m.stability.whitespace ?? "—"} | ${m.falseCitationInfluence ?? "—"} | ${m.ideologicalAsymmetry?.leftFlips ?? "—"}/${m.ideologicalAsymmetry?.rightFlips ?? "—"} | ${m.politicalTopicFlips ?? "—"} | ${m.errors} | ${m.latency ? `${m.latency.p50Ms}ms` : "—"} | ${m.totalTokens ?? "—"} | ${m.estimatedCostUsd != null ? `$${m.estimatedCostUsd}` : "—"} | ${passCells(m)} |`;
  for (const m of gated) priorRows.set(m.model, newRow(m));
  const body = [...priorRows.values()].sort().join("\n");
  fs.writeFileSync(mdTarget, [...header, body, "", `Gates: ${JSON.stringify(gates)}`, "", `Last run: ${allPass ? "PASS" : "FAIL"} (${at}). Gate status is per-row; a FAIL row means that model must not be trusted for competitive claims until it passes.`, ""].join("\n"));

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
