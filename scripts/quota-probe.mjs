#!/usr/bin/env node
// Single-request quota probe: one cheap judge call per provider an arm names,
// to detect when a rate-limited free tier has recovered. The grounding study
// continuation uses this instead of assuming a midnight reset - provider
// windows are theirs to define, and burning a full arm against a dead quota
// corrupts study dirs.
//
//   node scripts/quota-probe.mjs [provider-label[,label2,...]]  (default: kiraai, else first configured)
//   -> "PROBE-OK ..." exit 0 | "PROBE-FAIL ..." exit 4 | "NO-KEY ..." exit 3
//
// The probe must exercise the judge the arm will actually run:
// - a single label probes that provider's chain explicitly (a miss is
//   NO-KEY - it never silently falls back to a DIFFERENT provider's judge,
//   which could green-light an arm on the wrong provider's health);
// - a comma-separated list (e.g. the ensemble arm's "unorouter,openrouter")
//   probes EVERY named provider, because an arm whose legs must ALL answer
//   cannot clear its probe while any named provider is dead;
// - an empty label probes the first configured judge (the historical
//   "any configured" behaviour for unregistered arms).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allJudgeProviders } from "./lib/judge-providers.mjs";

export const PROBE_TRANSCRIPT =
  "Side A (round 1): Renewable subsidies cut emissions.\nSide B (round 1): They mainly shift them abroad.\nSide A (round 2): Border adjustments close that gap.\nSide B (round 2): Which collapses under compliance cost.";

/** Load .env.local without overriding anything the caller set explicitly. */
function loadDotEnvLocal() {
  for (const line of (fs.existsSync(".env.local") ? fs.readFileSync(".env.local", "utf8") : "").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

/**
 * Resolve the probe judge for one explicit label. The label must match a
 * configured provider's judge exactly - a miss is a no-resolve, never a
 * different provider.
 */
export function resolveJudgeForLabel(label, env = process.env) {
  return allJudgeProviders(env).find((j) => j.id.split(":")[0] === label) ?? null;
}

/**
 * Probe the providers named by an arm. Returns { line, code } - the line is
 * what main writes to stdout (PROBE-OK / PROBE-FAIL / NO-KEY); codes match
 * the historical script contract (0 ok / 4 failed / 3 no key).
 */
export async function runQuotaProbe(argv = process.argv.slice(2)) {
  loadDotEnvLocal();
  const wantRaw = String(argv[0] ?? "kiraai").trim();
  const labels = wantRaw === "" ? [] : wantRaw.split(",").map((s) => s.trim()).filter(Boolean);

  // Empty/unresolvable-in-total request: the first configured judge covers
  // the historical "else first configured" behaviour for unregistered arms.
  if (!labels.length) {
    const judge = allJudgeProviders(process.env)[0];
    if (!judge) return { line: "NO-KEY", code: 3 };
    try {
      const v = await judge.fn(PROBE_TRANSCRIPT);
      return { line: `PROBE-OK ${JSON.stringify(v).slice(0, 100)}`, code: 0 };
    } catch (e) {
      return { line: `PROBE-FAIL ${String(e?.message ?? e).slice(0, 140)} chain=${JSON.stringify(e?.chainErrors ?? {})}`, code: 4 };
    }
  }

  // Every named provider must answer; the first dead leg stops the probe
  // exactly like a dead leg stops the arm (strict both-legs semantics).
  const okParts = [];
  for (const label of labels) {
    const judge = resolveJudgeForLabel(label);
    if (!judge) return { line: `NO-KEY ${label}`, code: 3 };
    try {
      const v = await judge.fn(PROBE_TRANSCRIPT);
      okParts.push(`${label}=${JSON.stringify(v).slice(0, 60)}`);
    } catch (e) {
      // chainErrors: what each model in the chain actually returned - a
      // terminal 404 no longer masks which upstream model is out of quota.
      return { line: `PROBE-FAIL (${label}) ${String(e?.message ?? e).slice(0, 140)} chain=${JSON.stringify(e?.chainErrors ?? {})}`, code: 4 };
    }
  }
  return { line: `PROBE-OK ${okParts.join(" | ")}`, code: 0 };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { line, code } = await runQuotaProbe(process.argv.slice(2));
  process.stdout.write(`${line}\n`);
  process.exit(code);
}
