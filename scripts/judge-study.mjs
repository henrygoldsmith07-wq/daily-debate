#!/usr/bin/env node
// Pre-registered, probe-gated, interleaved judge architecture study (items 3-7).
//
//   node scripts/judge-study.mjs --registration docs/judge-experiments/registrations/<name>.json
//
// Contract (sealed at run time, enforceable in code):
//  * The registration is copied + hashed into <study-dir>/registration-snapshot.json
//    BEFORE the first arm. If the registration file later differs from the
//    snapshot hash, that is a NEW STUDY: execution refuses to continue or
//    re-decide under the old seal (item 4).
//  * Before EVERY arm: scripts/quota-probe.mjs runs (one real call) and the
//    result is appended to probes.jsonl. Probe failure => stop cleanly,
//    leaving the study resumable. Runs are never stacked on one arm because
//    the other temporarily cannot execute: the interleave planner resumes
//    from existing per-arm counts and keeps them balanced (item 5).
//  * Verdicts use ONLY runs whose provider reliability clears the registered
//    floor, and require the FULL registered count per arm; excluded runs stay
//    in the raw evidence and the report with their exclusion reason
//    (items 1-2, 5).
//  * study.json embeds the registration, its hash, per-run inclusion state
//    and every decision input; nothing is inferred from a later file state.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { EXPERIMENTS } from "./lib/judge-experiments.mjs";
import {
  basicStats,
  bootstrapDeltaCi,
  decideFromRegistration,
  metricValue,
  nextArmPlan,
  runUsability,
  METRIC_DIRECTION,
} from "./lib/judge-stats.mjs";

const args = process.argv.slice(2);
const argVal = (n) => {
  const eq = args.find((x) => x.startsWith(`--${n}=`));
  if (eq !== undefined) return eq.split("=").slice(1).join("=");
  const i = args.indexOf(`--${n}`);
  return i === -1 ? undefined : args[i + 1];
};
const REANALYZE = args.includes("--reanalyze");

const regPath = path.resolve(argVal("registration") ?? "");
if (!argVal("registration") || !fs.existsSync(regPath) || !fs.statSync(regPath).isFile()) {
  process.stderr.write("usage: node scripts/judge-study.mjs --registration docs/judge-experiments/registrations/<name>.json\n");
  process.exit(2);
}
const registrationText = fs.readFileSync(regPath, "utf8").replace(/^\uFEFF/, "");
const reg = JSON.parse(registrationText);
const regHash = createHash("sha256").update(registrationText).digest("hex").slice(0, 16);
for (const armName of ["baseline", "candidate"]) {
  const exp = reg.arms?.[armName]?.experiment;
  if (!exp || !EXPERIMENTS[exp]) {
    process.stderr.write(`registration ${armName} arm references unknown experiment "${exp}"\n`);
    process.exit(2);
  }
}
if (!reg.target?.metric || !reg.runsPerArm) {
  process.stderr.write("registration must define target.metric and runsPerArm\n");
  process.exit(2);
}
const REPS = Number(argVal("reps") ?? reg.runsPerArm);
if (REPS < reg.runsPerArm) {
  process.stderr.write(`--reps ${REPS} is below the registered runsPerArm ${reg.runsPerArm}: verdict would be structurally INCONCLUSIVE\n`);
  process.exit(2);
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9-]+/g, "-");
const studyDir = path.resolve(
  argVal("study-dir") ?? path.join("docs", "judge-runs", `study-${slug(reg.name)}-${new Date().toISOString().slice(0, 10)}`),
);
const dirs = { baseline: path.join(studyDir, "runs-baseline"), candidate: path.join(studyDir, "runs-candidate") };
fs.mkdirSync(dirs.baseline, { recursive: true });
fs.mkdirSync(dirs.candidate, { recursive: true });

const log = (m) => process.stderr.write(`[judge-study] ${m}\n`);

// --- Seal: snapshot registration + hash; refuse drift (item 4) ---------------
const snapshotPath = path.join(studyDir, "registration-snapshot.json");
let sealedHash = regHash;
if (fs.existsSync(snapshotPath)) {
  const snap = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  sealedHash = snap.registrationHash;
  if (sealedHash !== regHash && !REANALYZE) {
    process.stderr.write(
      `[judge-study] registration file (hash ${regHash}) differs from this study's seal (${sealedHash}).\n` +
      `A changed registration is a NEW study: choose a new --study-dir and register again.\n`,
    );
    process.exit(3);
  }
} else {
  fs.writeFileSync(snapshotPath, JSON.stringify({ registrationHash: regHash, sealedAt: new Date().toISOString(), registration: reg }, null, 2));
  log(`sealed registration ${reg.name} hash=${regHash}`);
}

const METRICS = [...new Set([reg.target.metric, ...Object.keys(reg.protected ?? {}), "provider reliability"])];

function collectArm(armDir) {
  if (!fs.existsSync(armDir)) return [];
  const files = fs.readdirSync(armDir).filter((f) => f.endsWith(".json")).sort();
  return files
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

// --- Probe-gated, balanced execution (item 5) --------------------------------
const probesPath = path.join(studyDir, "probes.jsonl");
function probeProvider() {
  const res = spawnSync(process.execPath, ["scripts/quota-probe.mjs", reg.models ?? ""], { encoding: "utf8" });
  const line = `${res.stdout?.trim() || res.stderr?.toString().trim() || "probe-no-output"}`;
  fs.appendFileSync(probesPath, JSON.stringify({ at: new Date().toISOString(), provider: reg.models ?? "any", ok: line.startsWith("PROBE-OK"), detail: line.slice(0, 220) }) + "\n");
  return line.startsWith("PROBE-OK");
}

let stoppedEarly = null;
if (!REANALYZE) {
  let counts = {
    baseline: collectArm(dirs.baseline).length,
    candidate: collectArm(dirs.candidate).length,
  };
  const plan = nextArmPlan(counts.baseline, counts.candidate, REPS);
  log(`resume counts: baseline=${counts.baseline} candidate=${counts.candidate}; plan=${plan.join(",") || "(complete)"}`);
  for (const arm of plan) {
    if (!probeProvider()) {
      stoppedEarly = `provider probe failed before arm ${arm}; study stops cleanly and stays resumable under the same seal`;
      log(`STOPPING: ${stoppedEarly}`);
      break;
    }
    const exp = reg.arms[arm].experiment;
    log(`arm ${arm} (${exp})`);
    const spawnArgs = ["scripts/judge-benchmark.mjs", "--concurrency", "3", "--runs-dir", dirs[arm], "--experiment", exp];
    if (reg.models) spawnArgs.push("--models", reg.models);
    const res = spawnSync(process.execPath, spawnArgs, { stdio: ["ignore", "ignore", "inherit"] });
    log(`  arm ${arm} exited ${res.status} (gate failures are data)`);
    counts[arm] += 1;
  }
}

// --- Decision from ALL preserved runs, usable-only inference ------------------
const baseRuns = collectArm(dirs.baseline).map((r) => ({ ...r, ...runUsability(r, reg) }));
const candRuns = collectArm(dirs.candidate).map((r) => ({ ...r, ...runUsability(r, reg) }));
const armStats = {
  baseline: { runs: baseRuns },
  candidate: { runs: candRuns },
};
const verdict = decideFromRegistration(reg, armStats);

// --- Report ------------------------------------------------------------------
const md = [
  `# Study: ${reg.name}`,
  "",
  `- sealed registration: \`${path.basename(regPath)}\` sha256 ${sealedHash} (full text in \`registration-snapshot.json\`)`,
  `- hypothesis: ${reg.hypothesis}`,
  `- variable: ${reg.singleVariable}`,
  `- design: registered runs/arm=${reg.runsPerArm}, probe-gated serialized interleave, provider=${reg.models ?? "any"}`,
  `- provider: ${stoppedEarly ? `stopped early - ${stoppedEarly}` : "all planned arms executed"}`,
  `- verdict: **${verdict.status.toUpperCase()}**`,
  "",
  "## Decision inputs (usable = reliability >= " + (reg.minimumUsableReliability ?? 0.75) + "; inference uses usable ONLY)",
  "",
  "| arm | total runs | usable | excluded |",
  "|---|---|---|---|",
  `| baseline | ${baseRuns.length} | ${baseRuns.filter((r) => r.usable).length} | ${baseRuns.filter((r) => !r.usable).map((r) => `${r.file} (${r.reason})`).join("<br>") || "—"} |`,
  `| candidate | ${candRuns.length} | ${candRuns.filter((r) => r.usable).length} | ${candRuns.filter((r) => !r.usable).map((r) => `${r.file} (${r.reason})`).join("<br>") || "—"} |`,
  "",
  "## Reasons",
  ...(verdict.reasons.length ? verdict.reasons.map((r) => `- ${r}`) : ["- (none)"]),
  "",
  "## Per-metric uncertainty (all raw values shown; excluded rows marked; stats/CIs from usable rows only)",
  "",
  "| Metric | dir | baseline usable mean/med/sd | candidate usable mean/med/sd | Δ cand-base | bootstrap 90% CI |",
  "|---|---|---|---|---|---|",
];
for (const metric of METRICS) {
  const bU = baseRuns.filter((r) => r.usable).map((r) => r.metrics[metric]).filter((x) => x !== null && x !== undefined);
  const cU = candRuns.filter((r) => r.usable).map((r) => r.metrics[metric]).filter((x) => x !== null && x !== undefined);
  const bs = basicStats(bU);
  const cs = basicStats(cU);
  const ci = bootstrapDeltaCi(bU, cU, { seed: reg.bootstrapSeed ?? 42 });
  md.push(
    `| ${metric} | ${METRIC_DIRECTION[metric] ?? "?"} | ${bs ? `${bs.mean}/${bs.median}/${bs.sd} (n=${bs.n})` : "—"} | ${cs ? `${cs.mean}/${cs.median}/${cs.sd} (n=${cs.n})` : "—"} | ${ci ? ci.point : "—"} | ${ci ? `[${ci.ciLower}, ${ci.ciUpper}]` : "—"} |`,
  );
}
md.push("", "## Every raw run", "");
for (const [armName, runs] of [["baseline", baseRuns], ["candidate", candRuns]]) {
  md.push(`### ${armName}`);
  for (const r of runs) {
    md.push(`- [${r.usable ? "USABLE" : "EXCLUDED"}] \`${r.file}\` ${r.at} model=${r.model} reliability=${r.reliability}${r.usable ? "" : ` reason: ${r.reason}`} gates=${JSON.stringify(r.gateSummary)} metrics=${JSON.stringify(r.metrics)}`);
  }
  md.push("");
}
fs.writeFileSync(path.join(studyDir, "study.md"), md.join("\n"));
fs.writeFileSync(
  path.join(studyDir, "study.json"),
  JSON.stringify(
    {
      name: reg.name,
      registrationHash: sealedHash,
      registration: reg,
      stoppedEarly,
      verdict,
      armStats,
      at: new Date().toISOString(),
    },
    null,
    2,
  ),
);

// Update the live registration only while it still matches the seal.
if (!REANALYZE && sealedHash === regHash) {
  reg.status = "decided";
  reg.decidedAt = new Date().toISOString();
  reg.registrationHash = sealedHash;
  reg.studyDir = path.relative(process.cwd(), studyDir);
  reg.verdict = { status: verdict.status, reasons: verdict.reasons };
  fs.writeFileSync(regPath, JSON.stringify(reg, null, 2) + "\n");
} else if (!REANALYZE) {
  log("registration drifted from seal - not writing verdict back; open a NEW registration + study dir");
}
log(`verdict ${verdict.status} -> ${path.join(studyDir, "study.md")}`);
process.stdout.write(JSON.stringify({ status: verdict.status, stoppedEarly, studyDir }) + "\n");
