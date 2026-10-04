// Server-side loader for judge validation status.
//
// I/O only. The judgement lives in judgeValidation.ts (pure, unit-tested).
//
// The source of truth is `docs/latest-judge-benchmark.json`, the artifact the
// weekly judge-benchmark workflow publishes. It is the same file ops health
// already reads, so there is exactly one benchmark artifact and one reading of
// it.
//
// A read that fails degrades to `unavailable` and is reported as such — it is
// never turned into a pass, and never silently swallowed. A missing artifact
// is an honest unknown, not a healthy judge.

import "server-only";
import fs from "node:fs";
import path from "node:path";
import { assessJudgeValidation, type BenchmarkArtifact, type JudgeValidationReport } from "./judgeValidation";

/** Read the published benchmark artifact, or null when it cannot be read. */
function readArtifact(): BenchmarkArtifact | null {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), "docs", "latest-judge-benchmark.json"), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as BenchmarkArtifact;
  } catch {
    return null;
  }
}

/**
 * Judge validation status for every surface, as of `nowIso`.
 *
 * @param nowIso injected clock, so staleness is deterministic under test and
 *               so a render can never make an old benchmark look current.
 */
export function loadJudgeValidation(nowIso?: string): JudgeValidationReport {
  const now = nowIso ?? new Date().toISOString();
  return assessJudgeValidation({ artifact: readArtifact(), nowIso: now });
}
