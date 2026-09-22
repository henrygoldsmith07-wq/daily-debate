#!/usr/bin/env node
// CI entry point for the judge-benchmark health summary. All judgement lives
// in the tested truth table (scripts/lib/benchmark-publication.mjs); this
// script only reads workflow env and renders the lines into the step summary,
// so what CI prints is exactly what the unit tests pinned.
//
// Env (set by .github/workflows/judge-benchmark.yml):
//   BENCH_RAN      "true" | "false"   benchmark step outcome != skipped
//   BENCH_GATES    "true" | "false"   benchmark step outcome == success
//   BENCH_USABLE   "" | "true" | "false" (empty = unknown, see attempts log)
//   ARTIFACT_UPLOADED "true" | "false"
//   PR_CREATED     "true" | "false"
//   PR_MERGED      "" | "true" | "false" (empty = deferred to merge job)

import { appendFileSync } from "node:fs";
import { benchmarkHealth } from "./lib/benchmark-publication.mjs";

const bool = (v) => v === "true";
const tri = (v) => (v === "true" ? true : v === "false" ? false : null);

const health = benchmarkHealth({
  ran: bool(process.env.BENCH_RAN),
  usable: tri(process.env.BENCH_USABLE ?? ""),
  gatesPassed: tri(process.env.BENCH_GATES ?? ""),
  uploaded: bool(process.env.ARTIFACT_UPLOADED ?? "false"),
  prCreated: bool(process.env.PR_CREATED),
  merged: tri(process.env.PR_MERGED ?? ""),
});

const block = `## Judge benchmark health\n${health.summaryLines.join("\n")}\n`;
process.stdout.write(block);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, block);
