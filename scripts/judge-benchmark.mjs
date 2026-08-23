#!/usr/bin/env node
// LIVE judge benchmark. Dependency-free ESM: fixtures, transforms, providers,
// metrics and gates are all plain JS so Node runs it directly (the previous
// benchmark script silently no-op'd because Node cannot import .ts).
//
//   node scripts/judge-benchmark.mjs [--limit N] [--concurrency N] [--enforce]
//        [--out docs/judge-leaderboard.md]
//
// Gates live in config/judge-gates.json; --enforce exits non-zero on breach.

import fs from "node:fs";
import path from "node:path";
import { FIXTURES } from "./lib/judge-fixtures.mjs";
import { PROBES, AUDIT_TRANSFORMS } from "./lib/judge-transforms.mjs";
import { primaryChainJudge, anthropicJudge } from "./lib/judge-providers.mjs";

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
const argNum = (name, dflt) => {
  const a = args.find((x) => x.startsWith(`--${name}`));
  if (!a) return dflt;
  const v = a.split("=")[1];
  return Number.isFinite(Number(v)) ? Number(v) : dflt;
};
const LIMIT = argNum("limit", FIXTURES.length);
const CONCURRENCY = argNum("concurrency", 3);
const ENFORCE = args.includes("--enforce");
const OUT_MD_ARG = args.find((a) => a.startsWith("--out="));
const OUT_MD = OUT_MD_ARG ? OUT_MD_ARG.split("=")[1] : null;

const log = (...a) => process.stderr.write(a.join(" ") + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mirror = (w) => (w === "a" ? "b" : w === "b" ? "a" : "tie");

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
  for (const f of fixtures) {
    try {
      bases.push({ fixture: f.id, expected: f.expectedWinner, ...(await judge.fn(f.transcript)) });
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

  const latencies = probeResults.filter((r) => r.latencyMs == null).length >= 0 ? [] : [];
  void latencies;
  const allTokens = probeResults.reduce((s, r) => s + (r.tokens ?? 0), 0);

  return {
    model: judge.id,
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

function leaderboardMd(models, gates, at) {
  const lines = [
    "# Judge leaderboard (live benchmarks)",
    "",
    `Generated ${at} by \`scripts/judge-benchmark.mjs\` over ${LIMIT} labelled fixture debates.`,
    "Human agreement here is against fixture labels (small n) until the rated corpus supplies consensus.",
    "",
    "| Model | Position mirror | Verbosity stab. | Names stab. | Fake-cit. influence | Human agree | ECE | Tokens | Errors |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  for (const m of models) {
    lines.push(
      `| ${m.model} | ${m.positionMirrorOk ?? "—"} | ${m.stability["verbosity-up"] ?? "—"} | ${m.stability.names ?? "—"} | ${m.falseCitationInfluence ?? "—"} | ${m.humanAgreement ?? "—"} | ${m.ece ?? "—"} | ${m.totalTokens ?? "—"} | ${m.errors} |`,
    );
  }
  lines.push("", "Gates: " + JSON.stringify(gates), "");
  return lines.join("\n");
}

async function main() {
  const judges = [primaryChainJudge(), anthropicJudge()].filter(Boolean);
  if (!judges.length) {
    log("[judge-benchmark] skipped - no NVIDIA_API_KEY / OPENROUTER_API_KEY / ANTHROPIC_API_KEY set");
    process.stdout.write(JSON.stringify({ skipped: true }) + "\n");
    return;
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
  const payload = { at, limit: LIMIT, enforce: ENFORCE, allPass, gates, results: gated };

  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  const outPath = path.join(process.cwd(), "docs", "latest-judge-benchmark.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));

  const mdTarget = OUT_MD || path.join(process.cwd(), "docs", "judge-leaderboard.md");
  fs.mkdirSync(path.dirname(mdTarget), { recursive: true });

  // Merge-by-model-row so repeated runs accumulate one comparison table.
  const header = [
    "# Judge leaderboard (live benchmarks)",
    "",
    `Last generated ${at} by \`scripts/judge-benchmark.mjs\` over ${LIMIT} labelled fixture debates.`,
    "Human agreement here is against fixture labels (small n) until the rated corpus supplies consensus.",
    "",
    "| Model | Position mirror | Verbosity stab. | Names stab. | Fake-cit. influence | Human agree | ECE | Tokens | Errors |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  const existing = fs.existsSync(mdTarget) ? fs.readFileSync(mdTarget, "utf8").split(/\r?\n/) : [];
  const priorRows = new Map();
  for (const line of existing) {
    if (!line.startsWith("| nvidia") && !line.startsWith("| openrouter") && !line.startsWith("| anthropic")) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length > 2) priorRows.set(cells[1], line);
  }
  const newRow = (m) =>
    `| ${m.model} | ${m.positionMirrorOk ?? "—"} | ${m.stability["verbosity-up"] ?? "—"} | ${m.stability.names ?? "—"} | ${m.falseCitationInfluence ?? "—"} | ${m.humanAgreement ?? "—"} | ${m.ece ?? "—"} | ${m.totalTokens ?? "—"} | ${m.errors} |`;
  for (const m of gated) priorRows.set(m.model, newRow(m));
  const body = [...priorRows.values()].sort().join("\n");
  fs.writeFileSync(mdTarget, [...header, body, "", "Gates: " + JSON.stringify(gates), ""].join("\n"));

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
