#!/usr/bin/env node
// Repeated-run judge variance study (item 9): a single benchmark run is not
// the whole truth when providers sample with noise. Runs the full pack N times
// for one experiment arm, keeps EVERY raw artifact under --runs-dir, and
// aggregates dispersion per model per metric - mean, median, min, max, stdev
// and gate-pass frequency. Failures are never averaged away: each gate's
// per-run PASS/FAIL is preserved and counted.
//
//   node scripts/judge-variance.mjs --runs 2 --experiment citation-zero-weight \
//        --models kiraai [--runs-dir docs/judge-runs/czw-2026-09-14]
//
// Nothing here publishes to docs/latest-judge-benchmark.json or the
// leaderboard: variance runs are experiment evidence, not the validation
// record (the weekly scheduled run remains the sole publisher).

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const eq = args.find((x) => x.startsWith(`--${name}=`));
  if (eq !== undefined) return eq.split("=")[1];
  const i = args.indexOf(`--${name}`);
  return i === -1 ? dflt : args[i + 1];
};
const RUNS = Number(argVal("runs", "2"));
if (!Number.isInteger(RUNS) || RUNS < 2 || RUNS > 8) {
  process.stderr.write("--runs must be an integer 2-8\n");
  process.exit(2);
}
const EXPERIMENT = argVal("experiment", "baseline");
const MODELS = argVal("models", "") || "";
const SLUG = argVal("slug", EXPERIMENT.replace(/[^a-z0-9-]/gi, ""));
const RUNS_DIR = argVal("dir")
  ? path.resolve(argVal("dir"))
  : path.join(process.cwd(), "docs", "judge-runs", `${SLUG}-${new Date().toISOString().slice(0, 10)}`);
fs.mkdirSync(RUNS_DIR, { recursive: true });

const log = (m) => process.stderr.write(`[judge-variance] ${m}\n`);
const runIdx = argVal("from", "1");
for (let i = Number(runIdx); i <= RUNS; i++) {
  log(`run ${i}/${RUNS} (experiment=${EXPERIMENT})`);
  const cmdArgs = ["scripts/judge-benchmark.mjs", "--concurrency", "3", "--runs-dir", RUNS_DIR, "--experiment", EXPERIMENT];
  if (MODELS) cmdArgs.push("--models", MODELS);
  const res = spawnSync(process.execPath, cmdArgs, { stdio: ["ignore", "ignore", "inherit"] });
  // Gate failures (exit 1) are data, not disasters: every raw run is saved.
  log(`run ${i} exited ${res.status}`);
}

// --- aggregate every raw run in the directory --------------------------------
const files = fs.readdirSync(RUNS_DIR).filter((f) => f.endsWith(".json") && f !== "summary.json").sort();
const runs = files.map((f) => JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), "utf8")));
if (!runs.length) {
  process.stderr.write("no raw run artifacts found; nothing to aggregate.\n");
  process.exit(1);
}

const METRICS = [
  ["provider reliability", (m) => m.reliability.successRatio],
  ["fixture agreement", (m) => m.humanAgreement],
  ["ECE", (m) => m.ece],
  ["fake-citation influence", (m) => m.falseCitationInfluence],
  ["position stability", (m) => m.positionMirrorOk],
  ["names stability", (m) => m.stability.names],
  ["verbosity stability", (m) => m.stability["verbosity-up"]],
  ["style stability", (m) => m.stability["style-fancy"]],
  ["whitespace stability", (m) => m.stability.whitespace],
  ["prestige stability", (m) => m.stability.prestige],
];
const stats = (xs) => {
  const v = xs.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const median = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  const sd = v.length > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (v.length - 1)) : 0;
  return { n: v.length, mean: +mean.toFixed(3), median: +median.toFixed(3), min: +v[0].toFixed(3), max: +v[v.length - 1].toFixed(3), sd: +sd.toFixed(3) };
};

const byModel = new Map();
for (const run of runs) {
  for (const m of run.results) {
    const arr = byModel.get(m.model) ?? [];
    arr.push({ run, m });
    byModel.set(m.model, arr);
  }
}

const summary = { at: new Date().toISOString(), experiment: EXPERIMENT, runs: runs.length, files, models: {} };
const md = [
  `# Judge variance — experiment \`${EXPERIMENT}\``,
  "",
  `${runs.length} full-pack raw run(s), all preserved in \`docs/judge-runs/${path.basename(RUNS_DIR)}/\`.`,
  `Prompt hash(es): ${[...new Set(runs.map((r) => r.versions?.promptHash).filter(Boolean))].join(", ")}`,
  "",
  "Failures are never averaged away: dispersion is descriptive, gate decisions stay per-run.",
  "",
];
for (const [model, entries] of byModel) {
  md.push(`## ${model}`, "", "| Metric | n | mean | median | min | max | sd |", "|---|---|---|---|---|---|---|");
  summary.models[model] = { perRun: {}, gatesPassFrequency: {} };
  for (const [label, pick] of METRICS) {
    const s = stats(entries.map((e) => pick(e.m)));
    if (s) md.push(`| ${label} | ${s.n} | ${s.mean} | ${s.median} | ${s.min} | ${s.max} | ${s.sd} |`);
    else md.push(`| ${label} | 0 | — | — | — | — | — |`);
    summary.models[model][label] = s;
  }
  const gateNames = [...new Set(entries.flatMap((e) => e.m.gates.map((g) => g.name)))];
  md.push("", "Gate pass frequency (per run, never averaged):", "");
  for (const name of gateNames) {
    const results = entries.map((e) => {
      const g = e.m.gates.find((x) => x.name === name);
      if (!g) return "MISSING";
      // Older raw artifacts lack an explicit state on base gates; derive it
      // from pass/kind so summaries re-aggregate faithfully.
      return g.state ?? (g.pass ? "PASS" : g.kind === "insufficient-data" ? "INSUFFICIENT DATA" : "FAIL");
    });
    const pass = results.filter((x) => x === "PASS").length;
    md.push(`- \`${name}\`: ${pass}/${entries.length} PASS (states: ${results.join(", ")})`);
    summary.models[model].gatesPassFrequency[name] = { pass, runs: entries.length, states: results };
  }
  summary.models[model].perRun = Object.fromEntries(entries.map((e) => [
    e.run.at,
    {
      reliability: e.m.reliability.successRatio,
      agreement: e.m.humanAgreement,
      ece: e.m.ece,
      fakeCitation: e.m.falseCitationInfluence,
      promptHash: e.run.versions?.promptHash,
      allPassRun: e.m.gates.every((g) => g.pass),
    },
  ]));
  md.push("");
}
fs.writeFileSync(path.join(RUNS_DIR, "summary.json"), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(RUNS_DIR, "summary.md"), md.join("\n"));
log(`aggregated ${files.length} raw run(s) -> ${path.join(RUNS_DIR, "summary.md")}`);
process.stdout.write(path.join(RUNS_DIR, "summary.md") + "\n");
