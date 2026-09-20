// Operational evidence assembly for the topic-generation workflow.
//
// The generator and the verifier write TWO DIFFERENT files with TWO
// DIFFERENT shapes:
//
//   gen-result.json -> the generator's own result, flat:
//                      { outcome, source, date, title, evidenceCards, fingerprint }
//   verify.json     -> the verifier's report, flat:
//                      { ok, targetDate, checks: { evidenceCards, ... }, provenance }
//
// The previous inline `jq` read `.generator.date` / `.generator.source` from
// the generator file and `.freshness.checks.evidenceCards` from the verifier
// file. Those paths only exist in the *assembled summary*, never in the
// source files, so a successful run still logged:
//
//   target=null source=null evidence=null
//
// while the real values were present. Assembling here (instead of inline)
// makes the field mapping unit-testable, and removes the dependency on a
// jq binary being present and behaving identically across runners.

import fs from "node:fs";

/** Fields that must never be null when the source files carry a value. */
export const REQUIRED_FIELDS = ["targetDate", "source", "evidenceCards", "fingerprint"];

/**
 * Map the two source documents onto one flat evidence record.
 * Every stage that genuinely never ran stays an explicit null.
 */
export function buildEvidence({ generator, freshness, runId, runAttempt, runType, startedAt }) {
  const gen = generator ?? null;
  const ver = freshness ?? null;
  return {
    runId: runId ?? null,
    runAttempt: runAttempt ?? null,
    runType: runType ?? null,
    startedAt: startedAt ?? null,
    // `date` lives on the generator; `targetDate` on the verifier. Prefer the
    // generator (it is what generation actually targeted) and fall back to
    // what the verifier re-read from the database.
    targetDate: gen?.date ?? ver?.targetDate ?? null,
    source: gen?.source ?? null,
    generatorOutcome: gen?.outcome ?? null,
    // Content identity for idempotence proofs; prefer the generator's claim,
    // fall back to what the verifier re-read from the database.
    fingerprint: gen?.fingerprint ?? ver?.checks?.fingerprint ?? null,
    // The verifier's count is authoritative (it re-read the database).
    evidenceCards: ver?.checks?.evidenceCards ?? gen?.evidenceCards ?? null,
    provenance: ver?.provenance ?? null,
    generator: gen,
    freshness: ver,
  };
}

/** The human-readable one-line summary written to the job log. */
export function summarize(evidence) {
  return [
    `run=${evidence.runId ?? "null"}`,
    `event=${evidence.runType ?? "null"}`,
    `target=${evidence.targetDate ?? "null"}`,
    `source=${evidence.source ?? "null"}`,
    `evidence=${evidence.evidenceCards ?? "null"}`,
  ].join(" ");
}

function readJsonIfPresent(path) {
  if (!path) return null;
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    // A missing or truncated file means that stage never produced output;
    // it must degrade to null, never abort the evidence step.
    return null;
  }
}

export function main(env = process.env) {
  const generator = readJsonIfPresent(env.GEN_RESULT_PATH ?? "gen-result.json");
  const freshness = readJsonIfPresent(env.VERIFY_PATH ?? "verify.json");
  const evidence = buildEvidence({
    generator,
    freshness,
    runId: env.RUN_ID,
    runAttempt: env.ATTEMPT,
    runType: env.EVENT,
    startedAt: env.STARTED,
  });

  const json = JSON.stringify(evidence, null, 2) + "\n";
  fs.writeFileSync(env.EVIDENCE_PATH ?? "topic-run-evidence.json", json);
  if (env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `## Topic generation evidence\n\n\`\`\`json\n${json}\`\`\`\n`);
  }
  process.stdout.write(summarize(evidence) + "\n");
  return evidence;
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`;
if (isMain) {
  try {
    main();
  } catch (e) {
    // Evidence is diagnostic: never let it fail the workflow.
    process.stderr.write(`[topic-run-evidence] ${String(e?.message ?? e)}\n`);
  }
}
