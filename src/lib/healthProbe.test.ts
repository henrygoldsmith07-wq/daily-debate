import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpsHealthReport } from "./opsHealth";

// The probe route must stay a thin, non-sensitive pass-through: this test
// pins the contract (states + booleans only, no-store, rate-limited, unknown
// never 500s with detail) without booting the full Next runtime.

const loadOpsHealth = vi.fn();

// The route imports the server module via the "@/lib" alias; mock BOTH
// specifiers with the same factory so interception is specifier-independent.
const serverMock = { loadOpsHealth: (...args: unknown[]) => loadOpsHealth(...args) };
vi.mock("./opsHealthServer", () => serverMock);
vi.mock("@/lib/opsHealthServer", () => serverMock);

vi.mock("../rateLimit", () => ({
  checkRateLimit: vi.fn(async () => null),
}));

import { derivePublicHealthState, isUsableProbe, type PublicHealthState } from "./healthProbe";

const now = "2026-09-21T04:00:00.000Z";

function report(over: Partial<OpsHealthReport> = {}): OpsHealthReport {
  return {
    generatedAt: "2026-09-21T03:59:00.000Z",
    topic: {},
    topicSlo: {
      scheduler: { state: "healthy", consecutiveScheduledFailures: 0, lastScheduledRunAt: null, lastScheduledRunConclusion: null },
      availability: { state: "ready", deadlineUtc: "03:00", note: null },
      scheduling: { latestDelayMs: null, medianDelayMs: null, p95DelayMs: null, missedStarts: 0, thresholdMs: 90 * 60_000, note: null },
      status: "healthy",
      lastSuccessfulRun: null,
      proofs: {
        databaseReachable: true,
        manualSuccess: true,
        scheduledSuccessAfterManual: true,
        sameDateContentIdempotence: true,
        onTimeBeforeDeadline: true,
        aiGeneratedProductionSuccess: true,
      },
      note: null,
    },
    judge: {},
    database: { status: "healthy", reachable: true, latencyMs: 5, migrationsApplied: 14, requiredTablesOk: true, missingTables: [], note: null },
    app: {},
    human: { status: "healthy", headline: "", facts: [], note: null },
    training: { status: "healthy", headline: "", facts: [], note: null, measurement: "valid", outcomes: [] },
    ...over,
  } as unknown as OpsHealthReport;
}

describe("derivePublicHealthState (non-sensitive reduction)", () => {
  it("exposes only booleans, states, and timestamps from the report", () => {
    const state = derivePublicHealthState(report(), now);
    expect(state).toEqual({
      topicStatus: "healthy",
      scheduler: "healthy",
      availability: "ready",
      databaseReachable: true,
      databaseRequiredTablesOk: true,
      proofs: { databaseReachable: true, manualSuccess: true, scheduledSuccessAfterManual: true, sameDateContentIdempotence: true, onTimeBeforeDeadline: true, aiGeneratedProductionSuccess: true },
      generatedAt: "2026-09-21T03:59:00.000Z",
      ageMs: 60_000,
    });
    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain("title");
    expect(serialized).not.toContain("prompt");
  });

  it("tracks failure states honestly instead of green-washing", () => {
    const failed = derivePublicHealthState(
      report({
        topicSlo: {
          scheduler: { state: "failed", consecutiveScheduledFailures: 7, lastScheduledRunAt: null, lastScheduledRunConclusion: "failure" },
          availability: { state: "missed-deadline", deadlineUtc: "03:00", note: "S1 BREACH" },
          scheduling: { latestDelayMs: null, medianDelayMs: null, p95DelayMs: null, missedStarts: 2, thresholdMs: 90 * 60_000, note: null },
          status: "failed",
          lastSuccessfulRun: null,
          proofs: { databaseReachable: false, manualSuccess: false, scheduledSuccessAfterManual: false, sameDateContentIdempotence: false, onTimeBeforeDeadline: false, aiGeneratedProductionSuccess: false },
          note: null,
        },
        database: { status: "healthy", reachable: true, latencyMs: 5, migrationsApplied: 14, requiredTablesOk: true, missingTables: [], note: null },
      } as unknown as OpsHealthReport),
      now,
    );
    expect(failed.topicStatus).toBe("failed");
    expect(failed.availability).toBe("missed-deadline");
    expect(failed.proofs.manualSuccess).toBe(false);
  });
});

describe("isUsableProbe (consumer-side sanity gate)", () => {
  const base: PublicHealthState = {
    topicStatus: "healthy",
    scheduler: "healthy",
    availability: "ready",
    databaseReachable: true,
    databaseRequiredTablesOk: true,
    proofs: { databaseReachable: true, manualSuccess: true, scheduledSuccessAfterManual: true, sameDateContentIdempotence: true, onTimeBeforeDeadline: true, aiGeneratedProductionSuccess: true },
    generatedAt: "2026-09-21T03:50:00.000Z",
    ageMs: 600_000, // 10 minutes old at `now`
  };

  it("accepts a fresh, coherent payload", () => {
    expect(isUsableProbe(base, now, 60 * 60_000)).toBe(true);
  });

  it("rejects an internally incoherent payload (ready topic but DB failed)", () => {
    expect(isUsableProbe({ ...base, databaseReachable: false }, now, 60 * 60_000)).toBe(false);
  });

  it("rejects stale payloads and missing timestamps", () => {
    expect(isUsableProbe({ ...base, ageMs: 2 * 60 * 60_000 }, now, 60 * 60_000)).toBe(false);
    expect(isUsableProbe({ ...base, ageMs: null, generatedAt: "not-a-date" }, now, 60 * 60_000)).toBe(false);
  });
});

describe("GET /api/health (route contract)", () => {
  beforeEach(() => {
    loadOpsHealth.mockReset();
  });

  it("serves the derived state with no-store", async () => {
    const { GET } = await import("../app/api/health/route");
    loadOpsHealth.mockResolvedValue(report());
    const res = await GET(new Request("https://dailydebate.app/api/health"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      [
        "ageMs",
        "availability",
        "databaseReachable",
        "databaseRequiredTablesOk",
        "generatedAt",
        "proofs",
        "scheduler",
        "topicStatus",
      ].sort(),
    );
  });

  it("degrades to an explicit unknown 503 when the report fails — never 500 with detail", async () => {
    const { GET } = await import("../app/api/health/route");
    loadOpsHealth.mockRejectedValue(new Error("secret internals"));
    const res = await GET(new Request("https://dailydebate.app/api/health"));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { availability: string; proofs: Record<string, boolean> };
    expect(body.availability).toBe("unknown");
    expect(Object.values(body.proofs).every((v) => v === false)).toBe(true);
    expect(JSON.stringify(body)).not.toContain("secret internals");
  });
});
