#!/usr/bin/env node
// Single-request quota probe: one cheap judge call against the kiraai chain
// (falls back to any configured judge) to detect when a rate-limited free
// tier has recovered. The grounding study continuation uses this instead of
// assuming a midnight reset - provider windows are theirs to define, and
// burning a full 312-call arm against a dead quota corrupts study dirs.
//
//   node scripts/quota-probe.mjs [provider-label]   (default: kiraai, else first configured)
//   -> "PROBE-OK ..." exit 0 | "PROBE-FAIL ..." exit 4 | "NO-KEY" exit 3

import fs from "node:fs";
import { allJudgeProviders } from "./lib/judge-providers.mjs";

for (const line of (fs.existsSync(".env.local") ? fs.readFileSync(".env.local", "utf8") : "").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const want = process.argv[2] ?? "kiraai";
const judges = allJudgeProviders(process.env);
const judge = judges.find((j) => j.id.startsWith(`${want}:`)) ?? judges[0];
if (!judge) {
  process.stdout.write("NO-KEY\n");
  process.exit(3);
}
try {
  const v = await judge.fn(
    "Side A (round 1): Renewable subsidies cut emissions.\nSide B (round 1): They mainly shift them abroad.\nSide A (round 2): Border adjustments close that gap.\nSide B (round 2): Which collapses under compliance cost.",
  );
  process.stdout.write(`PROBE-OK ${JSON.stringify(v).slice(0, 100)}\n`);
} catch (e) {
  // chainErrors: what each model in the chain actually returned - a terminal
  // 404 no longer masks which upstream model is out of quota.
  process.stdout.write(`PROBE-FAIL ${String(e?.message ?? e).slice(0, 140)} chain=${JSON.stringify(e?.chainErrors ?? {})}\n`);
  process.exit(4);
}
