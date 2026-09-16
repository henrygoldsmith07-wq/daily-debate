#!/usr/bin/env node
// Pre-execution capacity planning (items 12-13): expensive studies must not
// start on hope. Estimates the full registered A/B sequence (fixtures x
// perturbation calls x runs/arm x arms x retry allowance x architecture
// multiplier), compares against an EXPLICIT provider call budget, and refuses
// with BLOCKED - INSUFFICIENT PROVIDER CAPACITY when the budget is missing
// or too small. Unknown capacity is treated as insufficient, never as "try
// it and see with 1,900 calls".
//
//   node scripts/judge-capacity.mjs --registration <file> --budget-calls 2500
//   exit 0 = GO, exit 3 = BLOCKED

import fs from "node:fs";
import path from "node:path";
import { EXPERIMENTS } from "./lib/judge-experiments.mjs";

/** Conservative measured constants from full-pack runs (2026-09): ~200k
 * prompt tokens per 312-job single-prompt run; jobs = 24 base + 216 probes
 * + 72 audits = 312. Transport retry allowance x1.25 (2 attempts, most
 * calls need one). */
export const JOBS_PER_RUN = 312;
export const PROMPT_TOKENS_PER_RUN = 200_000;
export const RETRY_ALLOWANCE = 1.25;

export function callsPerJobForArms(reg) {
  let factor = 0;
  for (const arm of ["baseline", "candidate"]) {
    const exp = EXPERIMENTS[reg.arms[arm].experiment];
    const kind = exp?.kind ?? "single-prompt";
    factor += kind === "single-prompt" ? 1 : 2; // two-pass/ensemble: >= 2 calls per job
  }
  return factor / 2; // average calls/job per arm-run
}

export function estimateCapacity(reg, budgetCalls) {
  const arms = 2;
  const reps = reg.runsPerArm;
  const jobsTotal = JOBS_PER_RUN * reps * arms;
  const expectedCalls = Math.ceil(jobsTotal * callsPerJobForArms(reg) * RETRY_ALLOWANCE);
  const budget = typeof budgetCalls === "number" && budgetCalls > 0 ? budgetCalls : null;
  const decision = budget === null ? "BLOCKED" : expectedCalls <= budget * 0.8 ? "GO" : "BLOCKED";
  return {
    decision,
    expectedJobs: jobsTotal,
    expectedCalls,
    // ~700 prompt tokens per call measured (same transcript each call, plus
    // extraction prompts); rounded up for safety.
    expectedTokensApprox: Math.round(expectedCalls * 700),
    budgetCalls: budget,
    requiredHeadroom: "expected calls must fit 80% of the declared budget",
    rationale:
      budget === null
        ? "no explicit provider call budget declared - unknown capacity is treated as insufficient (item 13)"
        : decision === "GO"
          ? `expected ${expectedCalls} calls fit within 80% of the declared ${budget} budget`
          : `expected ${expectedCalls} calls exceeds 80% of the declared ${budget} budget`,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
if (isMain) {
  const args = process.argv.slice(2);
  const argVal = (n, d) => {
    const eq = args.find((x) => x.startsWith(`--${n}=`));
    if (eq !== undefined) return eq.split("=").slice(1).join("=");
    const i = args.indexOf(`--${n}`);
    return i === -1 ? d : args[i + 1];
  };
  const regPath = argVal("registration", "");
  if (!regPath || !fs.existsSync(regPath)) {
    process.stderr.write("usage: node scripts/judge-capacity.mjs --registration <file> [--budget-calls N]\n");
    process.exit(2);
  }
  const reg = JSON.parse(fs.readFileSync(regPath, "utf8").replace(/^\uFEFF/, ""));
  const budgetRaw = argVal("budget-calls", process.env.JUDGE_DAILY_CALL_BUDGET ?? "");
  const budget = Number(budgetRaw) || null;
  const est = estimateCapacity(reg, budget);
  process.stdout.write(JSON.stringify(est, null, 2) + "\n");
  process.exit(est.decision === "GO" ? 0 : 3);
}
