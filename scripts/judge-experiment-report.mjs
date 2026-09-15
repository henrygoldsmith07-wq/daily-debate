#!/usr/bin/env node
// Experiment comparison report (items 7-9): given a baseline arm's and a
// candidate arm's judge-runs directories (each with summary.json + raw runs),
// print per-metric dispersion for both arms, the mean delta, and an
// adoption-checklist verdict: candidate must improve its TARGET metric
// without materially regressing any PROTECTED metric. Material = worse by
// more than one pooled run-to-run sd (and worse in mean). Never averages
// away failures: gate pass frequencies from both arms are printed verbatim.

import fs from "node:fs";
import path from "node:path";

const [baseDir, candDir, target] = process.argv.slice(2);
if (!baseDir || !candDir || !target) {
  process.stderr.write("usage: node scripts/judge-experiment-report.mjs <baseline-runs-dir> <candidate-runs-dir> <target-metric-label>\n");
  process.exit(2);
}
const TARGETS = new Set([
  "provider reliability", "fixture agreement", "ECE", "fake-citation influence",
  "position stability", "names stability", "verbosity stability", "style stability",
  "whitespace stability", "prestige stability",
]);
const load = (dir) => JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
const base = load(baseDir);
const cand = load(candDir);
const models = [...new Set([...Object.keys(base.models), ...Object.keys(cand.models)])];

const out = [];
out.push(`# Experiment report: baseline vs candidate`);
out.push("");
out.push(`- baseline: \`${base.experiment}\` (${base.runs} runs) — ${baseDir}`);
out.push(`- candidate: \`${cand.experiment}\` (${cand.runs} runs) — ${candDir}`);
for (const m of models) {
  const B = base.models[m] ?? {};
  const C = cand.models[m] ?? {};
  out.push("", `## ${m}`, "");
  out.push("| Metric | baseline mean (n, sd) | candidate mean (n, sd) | Δ | note |");
  out.push("|---|---|---|---|---|");
  const notes = [];
  for (const metric of [...TARGETS].filter((t) => B[t] || C[t])) {
    const b = B[metric], c = C[metric];
    if (!b || !c) {
      out.push(`| ${metric} | ${b ? b.mean : "—"} | ${c ? c.mean : "—"} | — | arm missing data |`);
      continue;
    }
    const delta = +(c.mean - b.mean).toFixed(3);
    const pooledSd = Math.max(b.sd ?? 0, c.sd ?? 0);
    let note = "";
    if (metric === target) note = "TARGET";
    const directionUpBetter = !["ECE", "fake-citation influence"].includes(metric);
    const improved = directionUpBetter ? delta > 0 : delta < 0;
    const regressed = directionUpBetter ? delta < -pooledSd && delta < 0 : delta > pooledSd && delta > 0;
    if (metric === target && improved) note += " improved";
    if (regressed && metric !== target) {
      note += ` REGRESSED (Δ beyond run sd)`;
      notes.push(`${metric}: ${b.mean} -> ${c.mean}`);
    }
    out.push(`| ${metric} | ${b.mean} (n=${b.n}, sd=${b.sd}) | ${c.mean} (n=${c.n}, sd=${c.sd}) | ${delta >= 0 ? "+" : ""}${delta} | ${note} |`);
  }
  out.push("");
  const targetB = B[target], targetC = C[target];
  const dirUp = !["ECE", "fake-citation influence"].includes(target);
  const targetImproved = targetB && targetC && (dirUp ? targetC.mean > targetB.mean : targetC.mean < targetB.mean);
  const gateLines = [];
  for (const arm of [["baseline", B], ["candidate", C]]) {
    const freq = arm[1].gatesPassFrequency;
    if (freq) gateLines.push(`${arm[0]}: ${Object.entries(freq).map(([g, v]) => `${g} ${v.pass}/${v.runs}`).join("; ")}`);
  }
  if (gateLines.length) out.push("Gate pass frequency (raw, never averaged):", "", ...gateLines.map((l) => `- ${l}`), "");
  out.push(`**Verdict**: ${targetImproved && notes.length === 0 ? "CANDIDATE ELIGIBLE for adoption (target improved, no protected regression beyond run variance)" : notes.length ? `REJECT — protected regressions: ${notes.join("; ")}` : "REJECT — target did not improve"}`);
}
process.stdout.write(out.join("\n") + "\n");
