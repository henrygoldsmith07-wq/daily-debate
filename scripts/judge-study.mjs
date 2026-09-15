#!/usr/bin/env node
// Pre-registered, interleaved judge architecture study (items 3-7).
//
//   node scripts/judge-study.mjs --registration docs/judge-experiments/registrations/<name>.json
//
// Reads the registration (hypothesis, arms, target/protected metrics,
// margins, run counts, adoption rule) BEFORE running, executes the arms
// SERIALIZED and INTERLEAVED (A,B,A,B,... - never concurrent against
// rate-limited providers), preserves every raw run under the study dir, and
// applies the registered decision rule verbatim. The verdict is computed by
// the same pure function the unit tests pin (scripts/lib/judge-stats.mjs),
// so acceptance criteria cannot shift after the data exists.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { EXPERIMENTS } from "./lib/judge-experiments.mjs";
import { basicStats, bootstrapDeltaCi, decideFromRegistration, metricValue, METRIC_DIRECTION } from "./lib/judge-stats.mjs";

const args = process.argv.slice(2);
const argVal = (n) => {
  const eq = args.find((x) => x.startsWith(`--${n}=`));
  if (eq !== undefined) return eq.split("=").slice(1).join("=");
  const i = args.indexOf(`--${n}`);
  return i === -1 ? undefined : args[i + 1];
};
const regPath = path.resolve(argVal("registration") ?? "");
if (!argVal("registration") || !fs.existsSync(regPath) || !fs.statSync(regPath).isFile()) {
  process.stderr.write("usage: node scripts/judge-study.mjs --registration docs/judge-experiments/registrations/<name>.json\n");
  process.exit(2);
}
const registrationText = fs.readFileSync(regPath, "utf8").replace(/^\uFEFF/, "");
const reg = JSON.parse(registrationText);
const regHash = createHash("sha256").update(registrationText).digest("hex").slice(0, 16);
for (const arm of ["baseline", "candidate"]) {
  const exp = reg.arms?.[arm]?.experiment;
  if (!exp || !EXPERIMENTS[exp]) {
    process.stderr.write(`registration ${arm} arm references unknown experiment "${exp}"\n`);
    process.exit(2);
  }
}
if (!reg.target?.metric || !reg.runsPerArm) {
  process.stderr.write("registration must define target.metric and runsPerArm\n");
  process.exit(2);
}
const REPS = Number(argVal("reps") ?? reg.runsPerArm);

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9-]+/g, "-");
const studyDir = path.resolve(
  argVal("study-dir") ?? path.join("docs", "judge-runs", `study-${slug(reg.name)}-${new Date().toISOString().slice(0, 10)}`),
);
fs.mkdirSync(path.join(studyDir, "runs-baseline"), { recursive: true });
fs.mkdirSync(path.join(studyDir, "runs-candidate"), { recursive: true });

const log = (m) => process.stderr.write(`[judge-study] ${m}\n`);
log(`registration ${reg.name} hash=${regHash} arms=${reg.arms.baseline.experiment}/${reg.arms.candidate.experiment} reps=${REPS} interleaved serial`);

const METRICS = [...new Set([reg.target.metric, ...Object.keys(reg.protected ?? {}), "provider reliability"])];

function collectArm(armDir) {
  const files = fs.readdirSync(armDir).filter((f) => f.endsWith(".json") && f !== "study.json");
  return files
    .sort()
    .map((f) => {
      const payload = JSON.parse(fs.readFileSync(path.join(armDir, f), "utf8"));
      return payload.results.map((m) => ({
        at: payload.at,
        file: f,
        model: m.model,
        reliability: m.reliability?.successRatio ?? null,
        metrics: Object.fromEntries(METRICS.map((k) => [k, metricValue(k, m)])),
        gateSummary: m.failures ? { provider: m.failures.provider.length, quality: m.failures.quality.length, insufficient: m.failures.insufficient.length } : null,
        allPassRun: m.gates?.every((g) => g.pass) ?? false,
      }));
    })
    .flat();
}

if (args.includes("--reanalyze")) {
  log("re-analyze mode: skipping execution");
} else {
  for (let rep = 1; rep <= REPS; rep++) {
    for (const arm of ["baseline", "candidate"]) {
      const exp = reg.arms[arm].experiment;
      const dir = path.join(studyDir, `runs-${arm}`);
      log(`rep ${rep}/${REPS}: arm ${arm} (${exp})`);
      const spawnArgs = ["scripts/judge-benchmark.mjs", "--concurrency", "3", "--runs-dir", dir, "--experiment", exp];
      if (reg.models) spawnArgs.push("--models", reg.models);
      const res = spawnSync(process.execPath, spawnArgs, { stdio: ["ignore", "ignore", "inherit"] });
      log(`  arm ${arm} rep ${rep} exited ${res.status} (gate failures are data)`);
    }
  }
}

const baseRuns = collectArm(path.join(studyDir, "runs-baseline"));
const candRuns = collectArm(path.join(studyDir, "runs-candidate"));
const armStats = { baseline: { runs: baseRuns }, candidate: { runs: candRuns } };
const verdict = decideFromRegistration(reg, armStats);

const md = [
  `# Study: ${reg.name}`,
  "",
  `- registration: \`${path.basename(regPath)}\` (sha256 ${regHash}) sealed before execution`,
  `- hypothesis: ${reg.hypothesis}`,
  `- variable: ${reg.singleVariable}`,
  `- design: ${REPS} reps/arm, serialized interleaved A,B,A,B; models=${reg.models ?? "all"}`,
  `- verdict: **${verdict.status.toUpperCase()}**`,
  "",
  "## Reasons",
  ...(verdict.reasons.length ? verdict.reasons.map((r) => `- ${r}`) : ["- (none)"]),
  "",
  "## Per-metric uncertainty (every raw value preserved; nothing hidden behind a mean)",
  "",
  "| Metric | dir | baseline raw | baseline mean/med/sd | candidate raw | candidate mean/med/sd | Δ cand-base | bootstrap 90% CI |",
  "|---|---|---|---|---|---|---|---|",
];
for (const metric of METRICS) {
  const bv = baseRuns.map((r) => r.metrics[metric]).filter((x) => x !== null);
  const cv = candRuns.map((r) => r.metrics[metric]).filter((x) => x !== null);
  const bs = basicStats(bv);
  const cs = basicStats(cv);
  const ci = bootstrapDeltaCi(bv, cv, { seed: reg.bootstrapSeed ?? 42 });
  md.push(
    `| ${metric} | ${METRIC_DIRECTION[metric] ?? "?"} | ${bv.join(", ") || "—"} | ${bs ? `${bs.mean}/${bs.median}/${bs.sd} (n=${bs.n})` : "—"} | ${cv.join(", ") || "—"} | ${cs ? `${cs.mean}/${cs.median}/${cs.sd} (n=${cs.n})` : "—"} | ${ci ? ci.point : "—"} | ${ci ? `[${ci.ciLower}, ${ci.ciUpper}]` : "—"} |`,
  );
}
md.push("", "## Raw runs", "");
for (const [arm, runs] of [["baseline", baseRuns], ["candidate", candRuns]]) {
  md.push(`### ${arm}`);
  for (const r of runs) md.push(`- \`${r.file}\` ${r.at} model=${r.model} reliability=${r.reliability} gates=${JSON.stringify(r.gateSummary)} metrics=${JSON.stringify(r.metrics)}`);
  md.push("");
}
fs.writeFileSync(path.join(studyDir, "study.md"), md.join("\n"));
fs.writeFileSync(
  path.join(studyDir, "study.json"),
  JSON.stringify({ name: reg.name, registrationHash: regHash, registration: reg, verdict, armStats, at: new Date().toISOString() }, null, 2),
);

if (!args.includes("--reanalyze")) {
  reg.status = "decided";
  reg.decidedAt = new Date().toISOString();
  reg.registrationHash = regHash;
  reg.studyDir = path.relative(process.cwd(), studyDir);
  reg.verdict = { status: verdict.status, reasons: verdict.reasons };
  fs.writeFileSync(regPath, JSON.stringify(reg, null, 2) + "\n");
}
log(`verdict ${verdict.status} -> ${path.join(studyDir, "study.md")}`);
process.stdout.write(JSON.stringify({ status: verdict.status, reasons: verdict.reasons, studyDir }) + "\n");
