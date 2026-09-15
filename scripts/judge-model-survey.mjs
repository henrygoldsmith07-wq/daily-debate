#!/usr/bin/env node
// Pinned-model survey (item 8): benchmark plausible judge MODELS under
// identical prompts, fixtures, retry rules, gates, temperature and transport.
// Each model is PINNED to a single slug (fallbacks disabled) so a result is
// attributable to that model, not to chain failover. Model QUALITY (gate
// states computed on usable data) is ranked separately from PROVIDER
// RELIABILITY (success ratio) - a model never outranks another on quality it
// had no usable chance to show.
//
//   node scripts/judge-model-survey.mjs --provider kiraai --models glm-5.3-free,hy3-free --reps 1
//
// Pins are passed through the provider's own env overrides
// (<LABEL>_MODEL / <LABEL>_FALLBACK_MODELS="" = single-model chain), so this
// exercises the real transport configuration path, not a parallel one.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PROVIDERS } from "./lib/judge-providers.mjs";
import { metricValue } from "./lib/judge-stats.mjs";

const args = process.argv.slice(2);
const argVal = (n, d) => {
  const eq = args.find((x) => x.startsWith(`--${n}=`));
  if (eq !== undefined) return eq.split("=").slice(1).join("=");
  const i = args.indexOf(`--${n}`);
  return i === -1 ? d : args[i + 1];
};
const providerLabel = argVal("provider");
const models = (argVal("models") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const reps = Number(argVal("reps", "1"));
if (!providerLabel || !models.length) {
  process.stderr.write("usage: --provider <label> --models a,b,c [--reps N]\n");
  process.exit(2);
}
const provider = PROVIDERS.find((p) => p.label === providerLabel);
if (!provider) {
  process.stderr.write(`unknown provider "${providerLabel}"\n`);
  process.exit(2);
}
const upper = providerLabel.toUpperCase();
const surveyDir = path.resolve(argVal("dir") ?? path.join("docs", "judge-runs", `survey-${providerLabel}-${new Date().toISOString().slice(0, 10)}`));

const QUALITY_GATES = ["fixture-label agreement", "ECE", "position mirror stability"];
const log = (m) => process.stderr.write(`[model-survey] ${m}\n`);

for (const model of models) {
  const dir = path.join(surveyDir, model.replace(/[^a-z0-9.]/gi, "_"));
  fs.mkdirSync(dir, { recursive: true });
  for (let r = 1; r <= reps; r++) {
    log(`${providerLabel} :: ${model} :: rep ${r}/${reps} (pinned, no fallbacks)`);
    const res = spawnSync(process.execPath, ["scripts/judge-benchmark.mjs", "--concurrency", "3", "--no-publish", "--runs-dir", dir, "--models", providerLabel], {
      stdio: ["ignore", "ignore", "inherit"],
      env: { ...process.env, [`${upper}_MODEL`]: model, [`${upper}_FALLBACK_MODELS`]: "" },
    });
    log(`  exited ${res.status}`);
  }
}

const rows = [];
const MIN_REL = 0.75;
for (const model of models) {
  const dir = path.join(surveyDir, model.replace(/[^a-z0-9.]/gi, "_"));
  if (!fs.existsSync(dir)) continue;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  let runs = 0;
  let usableRuns = 0;
  let relSum = 0;
  let agreementSum = 0;
  let eceSum = 0;
  let fakeSum = 0;
  let qualityPassSum = 0;
  for (const f of files) {
    const p = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    for (const m of p.results ?? []) {
      runs += 1;
      const rel = m.reliability?.successRatio ?? 0;
      relSum += rel;
      // Item 14: a dead/capped provider is an AVAILABILITY finding, never a
      // quality conclusion - quality stats use only usable runs.
      if (rel < MIN_REL) continue;
      usableRuns += 1;
      agreementSum += metricValue("fixture agreement", m) ?? 0;
      eceSum += metricValue("ECE", m) ?? 0;
      fakeSum += metricValue("fake-citation influence", m) ?? 0;
      qualityPassSum += (m.gates ?? []).filter((g) => g.kind === "model-quality" && g.pass).length;
    }
  }
  if (runs) {
    rows.push({
      model,
      runs,
      usableRuns,
      providerReliability: +(relSum / runs).toFixed(3),
      agreement: usableRuns ? +(agreementSum / usableRuns).toFixed(3) : null,
      ece: usableRuns ? +(eceSum / usableRuns).toFixed(3) : null,
      fakeCitation: usableRuns ? +(fakeSum / usableRuns).toFixed(3) : null,
      qualityGatePassesPerRun: usableRuns ? +(qualityPassSum / usableRuns).toFixed(2) : null,
    });
  }
}
// Rank by provider-reliability-filtered quality: runs below the reliability
// gate (0.75) still appear but sort last on quality, clearly separated.
rows.sort((a, b) => (b.providerReliability >= MIN_REL) - (a.providerReliability >= MIN_REL)
  || (b.qualityGatePassesPerRun ?? -1) - (a.qualityGatePassesPerRun ?? -1)
  || (a.ece ?? 9) - (b.ece ?? 9));
const out = {
  at: new Date().toISOString(),
  provider: providerLabel,
  note: "pinned single-model chains (fallbacks disabled); identical prompts/fixtures/gates/temperature; reliability ranked separately from quality",
  gates: QUALITY_GATES,
  ranking: rows,
};
fs.writeFileSync(path.join(surveyDir, "survey.json"), JSON.stringify(out, null, 2));
const md = ["# Model survey", "", `provider=${providerLabel} pinned models=${models.join(", ")}`, "", "| rank | model | runs | reliability | agreement | ECE | fake-cit | quality gate passes/run |", "|---|---|---|---|---|---|---|---|"];
rows.forEach((r, i) => md.push(`| ${i + 1} | ${r.model} | ${r.runs} | ${r.providerReliability} | ${r.agreement} | ${r.ece} | ${r.fakeCitation} | ${r.qualityGatePassesPerRun} |`));
md.push("", "Models below the 0.75 reliability line cannot be quality-ranked honestly; the sort separates them.", "");
fs.writeFileSync(path.join(surveyDir, "survey.md"), md.join("\n"));
process.stdout.write(path.join(surveyDir, "survey.md") + "\n");
