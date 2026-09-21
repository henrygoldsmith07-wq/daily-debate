import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * WORKFLOW-WIRING REGRESSION TESTS.
 *
 * The production topic path once broke in ways unit tests could not see:
 * generation + verification held valid data while the human-readable log
 * printed target=null / source=null / evidence=null (jq read wrapped paths
 * from unwrapped source files), and `github.run_started_at` expanded empty
 * so created/started collapsed into one timestamp. These tests pin the
 * workflow contract — six-slot ladder, explicit Actions permission, API
 * timestamp resolution, tested evidence module, provider/availability
 * separation, always-on evidence — so configuration cannot silently regress.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKFLOW = readFileSync(path.join(ROOT, ".github", "workflows", "topic-generation.yml"), "utf8");

function cronSlots(text: string): string[] {
  return [...text.matchAll(/-\s*cron:\s*"([^"]+)"/g)].map((m) => m[1]);
}

describe("topic-generation schedule (six-slot retry ladder)", () => {
  it("keeps all six cron slots targeting the same debate date", () => {
    expect(cronSlots(WORKFLOW)).toEqual([
      "0 20 * * *",
      "30 21 * * *",
      "45 22 * * *",
      "40 23 * * *",
      "15 0 * * *",
      "15 2 * * *",
    ]);
  });

  it("never weakens the 03:00 availability SLO wording", () => {
    expect(WORKFLOW).toMatch(/03:00/);
  });

  it("keeps retries idempotent (no cancel-in-progress)", () => {
    expect(WORKFLOW).toMatch(/cancel-in-progress:\s*false/);
  });
});

describe("topic-generation permissions (explicit Actions read)", () => {
  it("grants contents + actions read without relying on public-repo defaults", () => {
    expect(WORKFLOW).toMatch(/contents:\s*read/);
    expect(WORKFLOW).toMatch(/actions:\s*read/);
  });
});

describe("run timestamp resolution (distinct created/started)", () => {
  it("resolves both instants once via the Actions run API", () => {
    expect(WORKFLOW).toContain("id: runtimes");
    expect(WORKFLOW).toMatch(/actions\/runs\/\$\{\{ github\.run_id \}\}/);
    // created and start are separate outputs — never one timestamp twice.
    expect(WORKFLOW).toMatch(/echo "created=/);
    expect(WORKFLOW).toMatch(/echo "start=/);
    expect(WORKFLOW).toContain("RUN_CREATED_AT: ${{ steps.runtimes.outputs.created }}");
    expect(WORKFLOW).toContain("RUN_STARTED_AT: ${{ steps.runtimes.outputs.start }}");
  });

  it("never interpolates the nonexistent github.run_created_at context", () => {
    // The string may appear in comments explaining why the runtimes step
    // exists; what must never happen is an actual ${{ ... }} interpolation.
    expect(WORKFLOW).not.toContain("${{ github.run_created_at }}");
    expect(WORKFLOW).not.toContain("${{ github.run_started_at }}");
  });
});

describe("operational evidence (null-log regression)", () => {
  it("assembles evidence through the tested module, not inline jq paths", () => {
    expect(WORKFLOW).toContain("node scripts/topic-run-evidence.mjs");
    // The bug was reading .generator.* / .freshness.* from the unwrapped
    // source files; the workflow must not contain those inline expressions.
    expect(WORKFLOW).not.toContain(".generator.date");
    expect(WORKFLOW).not.toContain(".generator.source");
    expect(WORKFLOW).not.toContain(".freshness.checks.evidenceCards");
  });

  it("keeps evidence + telemetry + artifact always-on so failures still emit structure", () => {
    const persistIdx = WORKFLOW.indexOf("Persist operational evidence");
    const recordIdx = WORKFLOW.indexOf("Record durable run telemetry");
    const uploadIdx = WORKFLOW.indexOf("upload-artifact");
    expect(persistIdx).toBeGreaterThan(-1);
    expect(recordIdx).toBeGreaterThan(-1);
    expect(uploadIdx).toBeGreaterThan(-1);
    expect(WORKFLOW.slice(persistIdx, recordIdx)).toMatch(/if:\s*always\(\)/);
    expect(WORKFLOW.slice(recordIdx, uploadIdx)).toMatch(/if:\s*always\(\)/);
    expect(WORKFLOW.slice(uploadIdx)).toMatch(/if:\s*always\(\)/);
  });

  it("guards the freshness target and records skipped verification as null, not fail", () => {
    expect(WORKFLOW).toMatch(/\^\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}\$/);
    expect(WORKFLOW).toContain("TELEMETRY_FALLBACK_PATH");
  });
});

describe("provider vs availability separation in telemetry", () => {
  it("reads provider detail from the generator result, not the outcome alone", () => {
    expect(WORKFLOW).toContain("PROVIDER_ERROR");
    expect(WORKFLOW).toContain("PROVIDER_ATTEMPTS");
    expect(WORKFLOW).toMatch(/\.providerAttempts/);
  });
});

describe("production proof separation (six independent facts)", () => {
  it("exposes database, manual, scheduled, idempotent, on-time and AI facts independently", async () => {
    const ops = await import("./opsHealth");
    const now = "2026-09-16T12:00:00Z";
    const fp = "c".repeat(64);
    const slo = ops.assessTopicSlo(
      {
        runs: [
          { event: "schedule", status: "completed", conclusion: "success", createdAt: "2026-09-16T02:00:00Z" },
          { event: "workflow_dispatch", status: "completed", conclusion: "success", createdAt: "2026-09-15T10:00:00Z" },
        ],
        productionDbReadable: true,
        tomorrowReady: true,
        telemetry: [
          { event: "workflow_dispatch", at: "2026-09-15T10:00:00Z", result: "success", delayMs: null, targetDate: "2026-09-17", completedBeforeDeadline: true, freshnessOk: true, topicFingerprint: fp, generatorResult: "ai" },
          { event: "schedule", at: "2026-09-16T02:00:00Z", result: "success", delayMs: 120_000, targetDate: "2026-09-17", completedBeforeDeadline: true, freshnessOk: true, topicFingerprint: fp, generatorResult: "ai" },
        ],
        aiEvidence: { targetDate: "2026-09-17", aiRowPresent: true, sourcesNonEmpty: true, telemetryVerifiedAi: true, rowFingerprint: fp, fingerprintMatched: true },
      },
      now,
    );
    expect(slo.proofs.databaseReachable).toBe(true);
    expect(slo.proofs.manualSuccess).toBe(true);
    expect(slo.proofs.scheduledSuccessAfterManual).toBe(true);
    expect(slo.proofs.sameDateContentIdempotence).toBe(true);
    expect(slo.proofs.onTimeBeforeDeadline).toBe(true);
    expect(slo.proofs.aiGeneratedProductionSuccess).toBe(true);
  });

  it("never infers scheduled proof from dispatch-only or CI-equivalent runs", async () => {
    const ops = await import("./opsHealth");
    const now = "2026-09-16T12:00:00Z";
    const dispatchOnly = ops.assessTopicSlo(
      {
        runs: [{ event: "workflow_dispatch", status: "completed", conclusion: "success", createdAt: "2026-09-15T10:00:00Z" }],
        productionDbReadable: true,
        tomorrowReady: true,
        telemetry: [
          { event: "workflow_dispatch", at: "2026-09-15T10:00:00Z", result: "success", delayMs: null, targetDate: "2026-09-17", completedBeforeDeadline: true, freshnessOk: true, topicFingerprint: "c".repeat(64), generatorResult: "fallback-by-policy" },
        ],
      },
      now,
    );
    expect(dispatchOnly.proofs.manualSuccess).toBe(true);
    expect(dispatchOnly.proofs.scheduledSuccessAfterManual).toBe(false);
    expect(dispatchOnly.proofs.sameDateContentIdempotence).toBe(false);
  });

  it("carries generator result + provider health distinctly in telemetry rows", async () => {
    const ops = await import("./opsHealth");
    const slo = ops.assessTopicSlo(
      {
        runs: [{ event: "schedule", status: "completed", conclusion: "success", createdAt: "2026-09-16T02:00:00Z" }],
        productionDbReadable: true,
        tomorrowReady: true,
        telemetry: [
          {
            event: "schedule", at: "2026-09-16T02:00:00Z", result: "success", delayMs: 60_000,
            queueDelayMs: 5_000, runCreatedAt: "2026-09-16T01:59:55Z", completedAt: "2026-09-16T02:05:00Z",
            targetDate: "2026-09-17", completedBeforeDeadline: true, freshnessOk: true,
            topicFingerprint: "c".repeat(64), generatorResult: "fallback-after-provider-failure",
            providerHealth: "timeout",
          },
        ],
      },
      "2026-09-16T12:00:00Z",
    );
    expect(slo.status).toBe("healthy");
    expect(slo.proofs.onTimeBeforeDeadline).toBe(true);
  });
});
