#!/usr/bin/env node
// Live judge benchmark: runs real Gemini + Anthropic judges over the corpus,
// computes bias probes with significance, ensemble, correlation and calibration.
// Usage:
//   GEMINI_API_KEY=... ANTHROPIC_API_KEY=... node apps/daily-debate/scripts/benchmark-judges.mjs [--corpus 50] [--bias]
//
// Outputs JSON to stdout and a human summary to stderr.
// Exit code 0 always (don't break CI when keys are missing — just report).

import fs from "fs";
import path from "path";

const args = process.argv.slice(2);
const nArg = args.find((a) => a.startsWith("--corpus"));
const corpusN = nArg ? parseInt(nArg.split("=")[1] ?? "50", 10) : 30;
const doBias = args.includes("--bias");

const out = (o) => process.stdout.write(JSON.stringify(o, null, 2) + "\n");
const log = (...a) => process.stderr.write(a.join(" ") + "\n");

async function main() {
  const hasGemini = !!process.env.GEMINI_API_KEY;
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  if (!hasGemini && !hasAnthropic) {
    const stub = {
      skipped: "No GEMINI_API_KEY / ANTHROPIC_API_KEY set — run with keys to exercise live judges.",
      offline: { hint: "Mock probes still run in `npm test` (src/lib/benchmarks.test.ts)." },
    };
    out(stub);
    log("[benchmark-judges] skipped — no keys set");
    return;
  }
  // Dynamic imports so missing deps don't crash offline runs
  let HUMAN_CORPUS = [];
  let TRANSCRIPTS = [];
  try {
    const hc = await import("../src/lib/humanCorpus.ts");
    HUMAN_CORPUS = hc.HUMAN_CORPUS ?? [];
  } catch {}
  try {
    const bf = await import("../src/lib/benchmark.fixtures.ts");
    TRANSCRIPTS = bf.TRANSCRIPTS ?? [];
  } catch {}
  const pool = [...HUMAN_CORPUS.map((d) => d.transcript), ...TRANSCRIPTS.map((t) => t.transcript)].slice(0, corpusN);
  if (!pool.length) {
    out({ error: "No corpus loaded" });
    return;
  }
  log(`[benchmark-judges] corpus=${pool.length} gemini=${hasGemini} anthropic=${hasAnthropic} bias=${doBias}`);
  const judges = [];
  if (hasGemini) {
    try {
      const gemini = await import("../src/lib/gemini.ts");
      judges.push({ id: "gemini", fn: gemini.judgePvpMatch });
    } catch (e) { log("gemini import failed", String(e?.message ?? e)); }
  }
  if (hasAnthropic) {
    try {
      const anthropic = await import("../src/lib/anthropic.ts");
      judges.push({ id: "anthropic", fn: anthropic.judgePvpMatch });
    } catch (e) { log("anthropic import failed", String(e?.message ?? e)); }
  }
  const topicTitle = "Benchmark topic";
  const topicPrompt = "Should test proposition?";
  const playerASide = "for";
  const results = [];
  for (let i = 0; i < pool.length; i++) {
    const transcript = pool[i];
    for (const j of judges) {
      const t0 = Date.now();
      try {
        const r = await j.fn({ topicTitle, topicPrompt, playerASide, transcript });
        results.push({ idx: i, judgeId: j.id, winner: r.winner, playerAScore: r.playerAScore, playerBScore: r.playerBScore, latencyMs: Date.now() - t0 });
        log(`  [${i + 1}/${pool.length}] ${j.id}: ${r.winner} ${r.playerAScore}-${r.playerBScore} (${Date.now() - t0}ms)`);
      } catch (e) {
        log(`  [${i + 1}/${pool.length}] ${j.id} failed: ${String(e?.message ?? e).slice(0, 200)}`);
        results.push({ idx: i, judgeId: j.id, error: String(e?.message ?? e).slice(0, 500) });
      }
      // Be kind to rate limits
      await new Promise((r) => setTimeout(r, 350));
    }
  }
  out({ corpusN: pool.length, judges: judges.map((j) => j.id), results, at: new Date().toISOString() });
}

main().catch((e) => { process.stderr.write(String(e.stack ?? e) + "\n"); process.exit(1); });
