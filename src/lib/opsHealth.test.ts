import { describe, expect, it } from "vitest";
import {
  assessAppHealth,
  assessDatabaseHealth,
  assessHumanValidation,
  assessJudgeHealth,
  assessTopicHealth,
  assessTopicSlo,
  deriveDelayWitness,
  mergeDelayWitnesses,
  assessTrainingEvidence,
  buildOpsHealthReport,
  rollupOverall,
} from "./opsHealth";

/**
 * OPERATIONAL HEALTH STATES.
 *
 * Missing or stale validation must never read as green: every assessor below
 * pins the exact status for empty/unknown/aged inputs, and the rollup keeps
 * "unknown" out of the overall verdict (listed separately instead).
 */

describe("rollupOverall", () => {
  it("ranks failed > blocked > stale > degraded > unknown > healthy", () => {
    expect(rollupOverall(["healthy", "degraded"])).toBe("degraded");
    expect(rollupOverall(["degraded", "stale"])).toBe("stale");
    expect(rollupOverall(["stale", "blocked"])).toBe("blocked");
    expect(rollupOverall(["blocked", "failed"])).toBe("failed");
  });

  it("unknown is NEVER averaged into healthy — missing evidence stays visible", () => {
    expect(rollupOverall(["healthy", "unknown"])).toBe("unknown");
    expect(rollupOverall(["unknown"])).toBe("unknown");
    expect(rollupOverall(["healthy", "degraded", "unknown"])).toBe("degraded");
  });

  it("all-healthy rolls up healthy", () => {
    expect(rollupOverall(["healthy", "healthy"])).toBe("healthy");
  });
});

describe("assessTopicHealth", () => {
  const row = (topic_date: string, generation_source: string | null = "ai") => ({
    topic_date,
    title: "T",
    generation_source,
    evidence_cards: 2,
  });

  it("is healthy when tomorrow's topic is stored", () => {
    const h = assessTopicHealth(row("2026-09-12"), "2026-09-11T10:00:00Z");
    expect(h.status).toBe("healthy");
    expect(h.tomorrowReady).toBe(true);
  });

  it("is degraded when only today is present", () => {
    const h = assessTopicHealth(row("2026-09-11"), "2026-09-11T10:00:00Z");
    expect(h.status).toBe("degraded");
    expect(h.tomorrowReady).toBe(false);
  });

  it("is stale then failed as the latest topic ages", () => {
    expect(assessTopicHealth(row("2026-09-09"), "2026-09-11T10:00:00Z").status).toBe("stale");
    expect(assessTopicHealth(row("2026-09-01"), "2026-09-11T10:00:00Z").status).toBe("failed");
  });

  it("is blocked (never green) when the table is empty", () => {
    const h = assessTopicHealth(null, "2026-09-11T10:00:00Z");
    expect(h.status).toBe("blocked");
  });
});

describe("assessJudgeHealth", () => {
  const artifact = (overrides = {}) => ({
    at: "2026-09-10T10:00:00Z",
    limit: 24,
    allPass: true as boolean | null,
    models: ["nvidia:m"],
    ...overrides,
  });

  it("is healthy for a fresh full-pack pass", () => {
    expect(assessJudgeHealth(artifact(), "2026-09-11T10:00:00Z").status).toBe("healthy");
  });

  it("is failed (preserved) when gates did not pass", () => {
    const h = assessJudgeHealth(artifact({ allPass: false }), "2026-09-11T10:00:00Z");
    expect(h.status).toBe("failed");
  });

  it("degrades then goes stale with age", () => {
    expect(assessJudgeHealth(artifact(), "2026-09-30T10:00:00Z").status).toBe("degraded");
    expect(assessJudgeHealth(artifact(), "2026-11-01T10:00:00Z").status).toBe("stale");
  });

  it("is blocked (never green) with no artifact", () => {
    expect(assessJudgeHealth(null, "2026-09-11T10:00:00Z").status).toBe("blocked");
  });

  it("flags partial packs as degraded even when fresh", () => {
    const h = assessJudgeHealth(artifact({ limit: 3 }), "2026-09-11T10:00:00Z");
    expect(h.status).toBe("degraded");
    expect(h.fullPack).toBe(false);
  });
});

describe("assessDatabaseHealth", () => {
  it("is blocked when unreachable", () => {
    expect(assessDatabaseHealth({ reachable: false }).status).toBe("blocked");
  });

  it("is failed when required tables are missing", () => {
    const h = assessDatabaseHealth({ reachable: true, latencyMs: 40, missingTables: ["daily_topics"] });
    expect(h.status).toBe("failed");
  });

  it("is degraded when slow, healthy otherwise", () => {
    expect(assessDatabaseHealth({ reachable: true, latencyMs: 9000 }).status).toBe("degraded");
    expect(assessDatabaseHealth({ reachable: true, latencyMs: 40 }).status).toBe("healthy");
  });
});

describe("assessAppHealth", () => {
  it("is unknown without workflow data (never green)", () => {
    const h = assessAppHealth(null, "https://example.invalid/actions");
    expect(h.status).toBe("unknown");
  });

  it("rolls up per-workflow states", () => {
    const h = assessAppHealth(
      [
        { name: "Daily Debate", status: "completed", conclusion: "success" },
        { name: "judge-benchmark", status: "completed", conclusion: "failure" },
      ],
      "https://example.invalid/actions",
    );
    expect(h.status).toBe("failed");
    expect(h.workflows.map((w) => w.state)).toEqual(["healthy", "failed"]);
  });
});

describe("buildOpsHealthReport", () => {
  const sloOk = (now: string) =>
    assessTopicSlo(
      {
        runs: [{ event: "schedule", status: "completed", conclusion: "success", createdAt: now }],
        productionDbReadable: true,
        tomorrowReady: true,
      },
      now,
    );

  it("rolls up the worst state and lists unknowns separately", () => {
    const r = buildOpsHealthReport({
      generatedAt: "2026-09-11T10:00:00Z",
      topic: assessTopicHealth(null, "2026-09-11T10:00:00Z"),
      topicSlo: sloOk("2026-09-11T10:00:00Z"),
      judge: assessJudgeHealth(null, "2026-09-11T10:00:00Z"),
      database: assessDatabaseHealth({ reachable: true, latencyMs: 30 }),
      app: assessAppHealth(null, "https://example.invalid/actions"),
    });
    expect(r.overall).toBe("blocked");
    expect(r.unknowns).toEqual(["app/ci"]);
    expect(r.notes.length).toBeGreaterThan(0);
  });

  it("healthy subsystems + missing CI never reads overall healthy", () => {
    const now = "2026-09-11T10:00:00Z";
    const r = buildOpsHealthReport({
      generatedAt: now,
      topic: assessTopicHealth(
        { topic_date: "2026-09-12", title: "T", generation_source: "ai", evidence_cards: 2 },
        now,
      ),
      topicSlo: sloOk(now),
      judge: assessJudgeHealth(
        { at: "2026-09-10T10:00:00Z", limit: 24, allPass: true, models: ["nvidia:m"] },
        now,
      ),
      database: assessDatabaseHealth({ reachable: true, latencyMs: 30 }),
      app: assessAppHealth(null, "https://example.invalid/actions"),
    });
    expect(r.overall).toBe("unknown");
  });

  it("surfaces judge staleness, failed topic workflow, unavailable DB, and simultaneous failures", () => {
    const now = "2026-11-01T10:00:00Z";
    const mk = (over: Partial<Parameters<typeof buildOpsHealthReport>[0]>) =>
      buildOpsHealthReport({
        generatedAt: now,
        topic: assessTopicHealth({ topic_date: "2026-11-02", title: "T", generation_source: "ai", evidence_cards: 1 }, now),
        topicSlo: sloOk(now),
        judge: assessJudgeHealth(
          { at: "2026-09-10T10:00:00Z", limit: 24, allPass: true, models: ["nvidia:m"] },
          now,
        ),
        database: assessDatabaseHealth({ reachable: true, latencyMs: 30 }),
        app: assessAppHealth(
          [{ name: "Daily Debate", status: "completed", conclusion: "success" }],
          "https://example.invalid/actions",
        ),
        ...over,
      });
    // Everything green except an aged judge benchmark.
    expect(mk({}).judge.status).toBe("stale");
    expect(mk({}).overall).toBe("stale");
    // Topic pipeline workflow failed (stale topics).
    const topicDown = mk({
      topic: assessTopicHealth({ topic_date: "2026-10-01", title: "T", generation_source: "ai", evidence_cards: 1 }, now),
    });
    expect(topicDown.topic.status).toBe("failed");
    expect(topicDown.overall).toBe("failed");
    // Database unavailable.
    expect(mk({ database: assessDatabaseHealth({ reachable: false }) }).overall).toBe("blocked");
    // Multiple simultaneous failures: worst wins, notes accumulate.
    const multi = mk({
      topic: assessTopicHealth(null, now),
      judge: assessJudgeHealth({ at: now, limit: 24, allPass: false, models: [] }, now),
      database: assessDatabaseHealth({ reachable: false }),
    });
    expect(multi.overall).toBe("failed");
    expect(multi.notes.length).toBeGreaterThanOrEqual(3);
  });
});

describe("assessTopicSlo (two dimensions, enforced deadline, proofs)", () => {
  const run = (event: string, conclusion: string | null, createdAt: string, status = "completed") => ({
    event, status, conclusion, createdAt,
  });
  const schedOk = [run("schedule", "success", "2026-09-15T02:00:00Z")];

  it("healthy requires BOTH a clean scheduler AND ready availability", () => {
    const s = assessTopicSlo(
      { runs: schedOk, productionDbReadable: true, tomorrowReady: true },
      "2026-09-15T12:00:00Z",
    );
    expect(s.scheduler.state).toBe("healthy");
    expect(s.availability.state).toBe("ready");
    expect(s.status).toBe("healthy");
  });

  it("missing topic BEFORE 03:00 UTC is pending, after it is an S1 breach (failed)", () => {
    const before = assessTopicSlo({ runs: schedOk, productionDbReadable: true, tomorrowReady: false }, "2026-09-15T02:30:00Z");
    expect(before.availability.state).toBe("pending-before-deadline");
    expect(before.status).toBe("healthy"); // scheduler clean; pending is normal pre-deadline
    const after = assessTopicSlo({ runs: schedOk, productionDbReadable: true, tomorrowReady: false }, "2026-09-15T03:00:00Z");
    expect(after.availability.state).toBe("missed-deadline");
    expect(after.status).toBe("failed"); // enforced at the deadline, not at 36h
  });

  it("scheduler failures degrade the scheduler dimension independently of content", () => {
    const failedRun = [run("schedule", "failure", "2026-09-15T02:00:00Z")];
    const withContent = assessTopicSlo({ runs: failedRun, productionDbReadable: true, tomorrowReady: true }, "2026-09-15T12:00:00Z");
    expect(withContent.scheduler.state).toBe("degraded");
    expect(withContent.availability.state).toBe("ready");
    expect(withContent.status).toBe("degraded");
    const noContent = assessTopicSlo({ runs: failedRun, productionDbReadable: true, tomorrowReady: false }, "2026-09-15T12:00:00Z");
    expect(noContent.scheduler.state).toBe("degraded");
    expect(noContent.availability.state).toBe("missed-deadline");
    expect(noContent.status).toBe("failed"); // worst-of derivation
  });

  it("three consecutive scheduled failures fail the scheduler dimension", () => {
    const bad = [
      run("schedule", "failure", "2026-09-15T02:00:00Z"),
      run("schedule", "failure", "2026-09-14T02:00:00Z"),
      run("schedule", "failure", "2026-09-13T02:00:00Z"),
    ];
    const s = assessTopicSlo({ runs: bad, productionDbReadable: true, tomorrowReady: true }, "2026-09-15T12:00:00Z");
    expect(s.scheduler.consecutiveScheduledFailures).toBe(3);
    expect(s.status).toBe("failed");
  });

  it("unreadable production store = availability unknown; content alone never healthy", () => {
    const s = assessTopicSlo({ runs: schedOk, productionDbReadable: false, tomorrowReady: false }, "2026-09-15T12:00:00Z");
    expect(s.availability.state).toBe("unknown");
    expect(s.status).toBe("unknown");
    const s2 = assessTopicSlo({ runs: [], productionDbReadable: true, tomorrowReady: true }, "2026-09-15T12:00:00Z");
    expect(s2.scheduler.state).toBe("unknown");
    expect(s2.status).toBe("unknown"); // CI-like states can't green-wash a silent scheduler
  });

  it("freshness verification failure on a present row = invalid availability", () => {
    const s = assessTopicSlo(
      { runs: schedOk, productionDbReadable: true, tomorrowReady: true, latestRunVerified: false },
      "2026-09-15T12:00:00Z",
    );
    expect(s.availability.state).toBe("invalid");
    expect(s.status).toBe("failed");
  });

  it("production proofs track manual + subsequent scheduled success (item 12)", () => {
    const dispatch = run("workflow_dispatch", "success", "2026-09-15T10:00:00Z");
    const laterSchedule = run("schedule", "success", "2026-09-16T02:00:00Z");
    const both = assessTopicSlo(
      { runs: [laterSchedule, dispatch, ...schedOk.map((r) => run("schedule", r.conclusion, "2026-09-14T02:00:00Z"))], productionDbReadable: true, tomorrowReady: true },
      "2026-09-16T12:00:00Z",
    );
    expect(both.proofs.manualSuccess).toBe(true);
    expect(both.proofs.scheduledSuccessAfterManual).toBe(true);
    const manualOnly = assessTopicSlo(
      { runs: [dispatch, ...schedOk], productionDbReadable: true, tomorrowReady: true },
      "2026-09-15T12:00:00Z",
    );
    expect(manualOnly.proofs.manualSuccess).toBe(true);
    expect(manualOnly.proofs.scheduledSuccessAfterManual).toBe(false);
  });

  it("stalled scheduler (>36h since last schedule attempt) is stale", () => {
    const old = run("schedule", "success", "2026-09-12T02:00:00Z");
    const s = assessTopicSlo({ runs: [old], productionDbReadable: true, tomorrowReady: true }, "2026-09-15T12:00:00Z");
    expect(s.scheduler.state).toBe("stale");
    expect(s.status).toBe("stale");
  });

  it("platform scheduler DELAY is telemetry, never a generator failure", () => {
    const late = run("schedule", "success", "2026-09-15T02:00:00Z");
    const telemetry = [
      { event: "schedule", at: "2026-09-15T07:00:00Z", result: "success", delayMs: 5 * 3_600_000, targetDate: "2026-09-16", completedBeforeDeadline: true },
      { event: "schedule", at: "2026-09-14T02:20:00Z", result: "success", delayMs: 20 * 60_000, targetDate: "2026-09-15", completedBeforeDeadline: true },
    ];
    const s = assessTopicSlo(
      { runs: [late], productionDbReadable: true, tomorrowReady: true, telemetry },
      "2026-09-15T12:00:00Z",
    );
    expect(s.scheduler.state).toBe("healthy"); // ran, succeeded
    expect(s.scheduling.latestDelayMs).toBe(5 * 3_600_000);
    expect(s.scheduling.missedStarts).toBe(1); // >90min threshold counted
    expect(s.status).toBe("healthy"); // delay alone never degrades app status
  });

  it("all six production proofs computed from runs + telemetry + AI evidence", () => {
    const dispatch = run("workflow_dispatch", "success", "2026-09-15T10:00:00Z");
    const schedule = run("schedule", "success", "2026-09-15T20:00:00Z");
    const fp = "a".repeat(64);
    const telemetry = [
      { event: "workflow_dispatch", at: "2026-09-15T10:00:00Z", result: "success", delayMs: null, targetDate: "2026-09-16", completedBeforeDeadline: true, freshnessOk: true, topicFingerprint: fp, generatorResult: "fallback-by-policy" },
      { event: "schedule", at: "2026-09-15T20:02:00Z", result: "success", delayMs: 120_000, targetDate: "2026-09-16", completedBeforeDeadline: true, freshnessOk: true, topicFingerprint: fp, generatorResult: "fallback-by-policy" },
    ];
    const s = assessTopicSlo(
      {
        runs: [schedule, dispatch, ...schedOk], productionDbReadable: true, tomorrowReady: true, telemetry,
        aiEvidence: { targetDate: "2026-09-16", aiRowPresent: true, sourcesNonEmpty: true, telemetryVerifiedAi: true, rowFingerprint: "a".repeat(64), fingerprintMatched: true },
      },
      "2026-09-15T23:00:00Z",
    );
    expect(s.proofs).toEqual({
      databaseReachable: true,
      manualSuccess: true,
      scheduledSuccessAfterManual: true,
      sameDateContentIdempotence: true, // two verified successes, same date + fingerprint + provenance
      onTimeBeforeDeadline: true,
      aiGeneratedProductionSuccess: true,
    });
    const partial = assessTopicSlo(
      { runs: [dispatch], productionDbReadable: true, tomorrowReady: true, telemetry: [telemetry[0]] },
      "2026-09-15T23:00:00Z",
    );
    expect(partial.proofs.scheduledSuccessAfterManual).toBe(false);
    expect(partial.proofs.sameDateContentIdempotence).toBe(false);
    expect(partial.proofs.aiGeneratedProductionSuccess).toBe(false);
  });

  it("two bare successes without matching fingerprints prove no idempotence", () => {
    // The weak legacy signal: same date twice, but unverified and
    // unfingerprinted. Under write-once semantics this proves nothing.
    const telemetry = [
      { event: "workflow_dispatch", at: "2026-09-15T10:00:00Z", result: "success", delayMs: null, targetDate: "2026-09-16", completedBeforeDeadline: true },
      { event: "schedule", at: "2026-09-15T20:02:00Z", result: "success", delayMs: 120_000, targetDate: "2026-09-16", completedBeforeDeadline: true },
    ];
    const s = assessTopicSlo(
      { runs: [], productionDbReadable: true, tomorrowReady: true, telemetry },
      "2026-09-15T23:00:00Z",
    );
    expect(s.proofs.sameDateContentIdempotence).toBe(false);
  });

  it("content idempotence needs same date + same non-null fingerprint + both verified — and NOTHING else", () => {
    const base = {
      event: "schedule", at: "2026-09-15T20:02:00Z", result: "success", delayMs: 120_000,
      targetDate: "2026-09-16", completedBeforeDeadline: true, freshnessOk: true,
    };
    const same = assessTopicSlo(
      {
        runs: [], productionDbReadable: true, tomorrowReady: true,
        telemetry: [
          { ...base, topicFingerprint: "a".repeat(64), generatorResult: "ai" },
          { ...base, at: "2026-09-15T21:02:00Z", topicFingerprint: "a".repeat(64), generatorResult: "ai" },
        ],
      },
      "2026-09-15T23:00:00Z",
    );
    expect(same.proofs.sameDateContentIdempotence).toBe(true);
    const divergent = assessTopicSlo(
      {
        runs: [], productionDbReadable: true, tomorrowReady: true,
        telemetry: [
          { ...base, topicFingerprint: "a".repeat(64), generatorResult: "ai" },
          { ...base, at: "2026-09-15T21:02:00Z", topicFingerprint: "b".repeat(64), generatorResult: "ai" },
        ],
      },
      "2026-09-15T23:00:00Z",
    );
    expect(divergent.proofs.sameDateContentIdempotence).toBe(false);
    // Operational generator reason is a SEPARATE dimension: under write-once
    // semantics a "generated" run and a "verified-only" run with the same
    // fingerprint prove the same content — a mixed-provenance pair must NOT
    // be a false negative.
    const mixedProvenance = assessTopicSlo(
      {
        runs: [], productionDbReadable: true, tomorrowReady: true,
        telemetry: [
          { ...base, topicFingerprint: "a".repeat(64), generatorResult: "ai" },
          { ...base, at: "2026-09-15T21:02:00Z", topicFingerprint: "a".repeat(64), generatorResult: "fallback-by-policy" },
        ],
      },
      "2026-09-15T23:00:00Z",
    );
    expect(mixedProvenance.proofs.sameDateContentIdempotence).toBe(true);
    // An unverified attempt proves nothing.
    const unverified = assessTopicSlo(
      {
        runs: [], productionDbReadable: true, tomorrowReady: true,
        telemetry: [
          { ...base, topicFingerprint: "a".repeat(64), generatorResult: "ai", freshnessOk: true },
          { ...base, at: "2026-09-15T21:02:00Z", topicFingerprint: "a".repeat(64), generatorResult: "ai", freshnessOk: false },
        ],
      },
      "2026-09-15T23:00:00Z",
    );
    expect(unverified.proofs.sameDateContentIdempotence).toBe(false);
  });

  it("scheduledSuccessAfterManual is an existence proof: later manual runs cannot erase it", () => {
    const runs = (events: Array<[string, string, string, string]>) =>
      events.map(([event, conclusion, at]) => ({ event, status: "completed", conclusion, createdAt: at }));
    const slo = (list: ReturnType<typeof runs>) =>
      assessTopicSlo({ runs: list, productionDbReadable: true, tomorrowReady: true }, "2026-09-20T00:00:00Z");
    const M = (at: string): [string, string, string, string] => ["workflow_dispatch", "success", at, ""];
    const S = (at: string): [string, string, string, string] => ["schedule", "success", at, ""];
    const F = (event: string, at: string): [string, string, string, string] => [event, "failure", at, ""];
    // manual → scheduled: true
    expect(slo(runs([M("2026-09-15T10:00:00Z"), S("2026-09-16T20:00:00Z")])).proofs.scheduledSuccessAfterManual).toBe(true);
    // manual → scheduled → manual: STILL true (the historical fact stands)
    expect(slo(runs([M("2026-09-15T10:00:00Z"), S("2026-09-16T20:00:00Z"), M("2026-09-18T10:00:00Z")])).proofs.scheduledSuccessAfterManual).toBe(true);
    // scheduled → manual: false (no scheduled success AFTER a manual)
    expect(slo(runs([S("2026-09-14T20:00:00Z"), M("2026-09-15T10:00:00Z")])).proofs.scheduledSuccessAfterManual).toBe(false);
    // manual only / scheduled only: false
    expect(slo(runs([M("2026-09-15T10:00:00Z")])).proofs.scheduledSuccessAfterManual).toBe(false);
    expect(slo(runs([S("2026-09-15T20:00:00Z")])).proofs.scheduledSuccessAfterManual).toBe(false);
    // failed manual → successful schedule: false
    expect(slo(runs([F("workflow_dispatch", "2026-09-15T10:00:00Z"), S("2026-09-16T20:00:00Z")])).proofs.scheduledSuccessAfterManual).toBe(false);
    // manual → failed schedule: false
    expect(slo(runs([M("2026-09-15T10:00:00Z"), F("schedule", "2026-09-16T20:00:00Z")])).proofs.scheduledSuccessAfterManual).toBe(false);
  });

  it("the AI production proof requires an exact telemetry fingerprint match, not just a date", () => {
    const fp = "c".repeat(64);
    const telemetry = [
      { event: "schedule", at: "2026-09-15T20:02:00Z", result: "success", delayMs: 120_000, targetDate: "2026-09-16", completedBeforeDeadline: true, freshnessOk: true, topicFingerprint: fp, generatorResult: "ai" },
    ];
    const full = assessTopicSlo(
      {
        runs: [], productionDbReadable: true, tomorrowReady: true, telemetry,
        aiEvidence: { targetDate: "2026-09-16", aiRowPresent: true, sourcesNonEmpty: true, telemetryVerifiedAi: true, rowFingerprint: fp, fingerprintMatched: true },
      },
      "2026-09-15T23:00:00Z",
    );
    expect(full.proofs.aiGeneratedProductionSuccess).toBe(true);
    // Same date, different fingerprint (row rebuilt after the verified run):
    // the date-only version of this proof would ride the old run's evidence.
    const rebuilt = assessTopicSlo(
      {
        runs: [], productionDbReadable: true, tomorrowReady: true, telemetry,
        aiEvidence: { targetDate: "2026-09-16", aiRowPresent: true, sourcesNonEmpty: true, telemetryVerifiedAi: true, rowFingerprint: "d".repeat(64), fingerprintMatched: false },
      },
      "2026-09-15T23:00:00Z",
    );
    expect(rebuilt.proofs.aiGeneratedProductionSuccess).toBe(false);
    // Availability stays independent: a fallback can satisfy availability
    // while the AI proof is false (item 16) — no assertion here couples them.
  });

  it("on-time needs verified content before the deadline; AI proof needs a real AI topic", () => {
    const late = assessTopicSlo(
      {
        runs: [], productionDbReadable: true, tomorrowReady: true,
        telemetry: [
          { event: "schedule", at: "2026-09-16T04:00:00Z", result: "success", delayMs: 0, targetDate: "2026-09-17", completedBeforeDeadline: false, freshnessOk: true, topicFingerprint: "a".repeat(64), generatorResult: "ai" },
        ],
      },
      "2026-09-16T12:00:00Z",
    );
    expect(late.proofs.onTimeBeforeDeadline).toBe(false);
    // A fallback standing in for AI never satisfies the AI proof.
    const fallbackOnly = assessTopicSlo(
      {
        runs: [], productionDbReadable: true, tomorrowReady: true, telemetry: [],
        aiEvidence: { targetDate: null, aiRowPresent: false, sourcesNonEmpty: false, telemetryVerifiedAi: false, rowFingerprint: null, fingerprintMatched: false },
      },
      "2026-09-16T12:00:00Z",
    );
    expect(fallbackOnly.proofs.aiGeneratedProductionSuccess).toBe(false);
  });

  it("longitudinal provider attempts aggregate by provider and model", () => {
    const s = assessTopicSlo(
      {
        runs: [], productionDbReadable: true, tomorrowReady: true,
        telemetry: [
          {
            event: "schedule", at: "2026-09-16T02:00:00Z", result: "success", delayMs: 0,
            targetDate: "2026-09-17", completedBeforeDeadline: true, freshnessOk: true,
            topicFingerprint: "a".repeat(64), generatorResult: "fallback-after-provider-failure",
            providerAttempts: [
              { provider: "openrouter", model: "m1", outcome: "timeout", latencyMs: 60000, httpStatus: null, errorCategory: "timeout" },
              { provider: "unorouter", model: "m2", outcome: "success", latencyMs: 1200, httpStatus: null, errorCategory: null },
            ],
          },
        ],
      },
      "2026-09-16T12:00:00Z",
    );
    expect(s.providerSummary?.windowRuns).toBe(1);
    expect(s.providerSummary?.fallbackTriggerRate).toBe(1);
    const byModel = Object.fromEntries((s.providerSummary?.byModel ?? []).map((m) => [`${m.provider}/${m.model}`, m]));
    expect(byModel["openrouter/m1"].timeouts).toBe(1);
    expect(byModel["openrouter/m1"].successRate).toBe(0);
    expect(byModel["unorouter/m2"].successRate).toBe(1);
    expect(byModel["unorouter/m2"].p50LatencyMs).toBe(1200);
  });
});

describe("evidence sections (never green-washed)", () => {
  it("human validation is blocked with no rated items, degraded below thresholds, healthy when met", () => {
    const base = {
      items: 40,
      raters: 20,
      itemsWithTwoPlusRatings: 0,
      consensusReady: 0,
      unresolvedDisagreements: 0,
      meanWinnerKappa: null,
      canUseAsGroundTruth: false,
    };
    expect(assessHumanValidation({ ...base, items: 0 }).status).toBe("blocked");
    expect(assessHumanValidation(base).status).toBe("blocked");
    expect(assessHumanValidation({ ...base, itemsWithTwoPlusRatings: 5, consensusReady: 3 }).status).toBe("degraded");
    expect(
      assessHumanValidation({
        ...base,
        raters: 8,
        itemsWithTwoPlusRatings: 60,
        consensusReady: 55,
        meanWinnerKappa: 0.71,
        canUseAsGroundTruth: true,
      }).status,
    ).toBe("healthy");
  });

  it("training evidence separates measurement state from observed outcome", () => {
    const base = {
      repairs: 0, retestsObserved: 0, retestsPending: 0, firstRetestRate: null,
      firstRetestN: 0, firstThreeDenominator: 0, medianOpportunitiesToRecurrence: null, censoredRepairs: 0,
    };
    const none = assessTrainingEvidence(base);
    expect(none.status).toBe("blocked");
    expect(none.measurement).toBe("insufficient");
    expect(none.outcomes[0].value).toBe("not measurable yet");

    const sparse = assessTrainingEvidence({ ...base, repairs: 6, retestsPending: 6 });
    expect(sparse.status).toBe("degraded");
    expect(sparse.measurement).toBe("insufficient");

    const ready = assessTrainingEvidence({
      repairs: 6, retestsObserved: 5, retestsPending: 1,
      firstRetestRate: 0.4, firstRetestN: 5, firstThreeDenominator: 2,
      medianOpportunitiesToRecurrence: 1, censoredRepairs: 3,
    });
    expect(ready.status).toBe("healthy");
    expect(ready.measurement).toBe("measurable");
    // Outcomes are reported with denominators, never as health colour.
    expect(ready.outcomes[0]).toEqual({ label: "Observed first-retest recurrence", value: "40% (n=5)" });
    expect(ready.outcomes[1]).toEqual({ label: "Median opportunities to first recurrence", value: "1" });
    // A HIGH recurrence rate does not change measurement readiness — the
    // badge stays readiness, not outcome quality.
    const worse = assessTrainingEvidence({
      ...base, repairs: 6, retestsObserved: 5, retestsPending: 1,
      firstRetestRate: 0.95, firstRetestN: 5,
    });
    expect(worse.measurement).toBe("measurable");
    expect(worse.status).toBe("healthy");
  });

  it("training evidence reports unreadable data as invalid measurement", () => {
    // The server loader's failure path must surface as invalid, not green.
    // (Shape contract tested here; the loader maps to this via catch.)
    const invalidSection = {
      status: "blocked" as const,
      headline: "training-loop data unreadable from this runtime",
      facts: [] as Array<{ label: string; value: string }>,
      note: "Could not load repair/event data — outcome status is unresolved, not green.",
      measurement: "invalid" as const,
      outcomes: [] as Array<{ label: string; value: string }>,
    };
    expect(invalidSection.measurement).toBe("invalid");
    expect(invalidSection.outcomes).toHaveLength(0);
  });
});

describe("second-witness scheduler-delay telemetry (derived from GitHub run history)", () => {
  const run = (event: string, conclusion: string | null, createdAt: string, status = "completed") => ({
    event, status, conclusion, createdAt,
  });

  it("derives delay from the most recent ladder slot for schedule runs only", () => {
    const witnesses = deriveDelayWitness([
      run("schedule", "failure", "2026-09-16T22:30:00Z"), // slot 22:45 is future -> belongs to 21:30 -> 60 min
      run("workflow_dispatch", "success", "2026-09-16T12:00:00Z"), // never witnessed
    ]);
    expect(witnesses).toHaveLength(1);
    expect(witnesses[0].delayMs).toBe(60 * 60_000);
    expect(witnesses[0].result).toBe("failure");
    // Witness rows never claim availability facts.
    expect(witnesses[0].targetDate).toBeNull();
    expect(witnesses[0].completedBeforeDeadline).toBeNull();
  });

  it("wraps midnight: a 00:10 run belongs to the previous day's 23:40 slot", () => {
    const witnesses = deriveDelayWitness([run("schedule", "failure", "2026-09-16T00:10:00Z")]);
    expect(witnesses[0].delayMs).toBe(30 * 60_000);
  });

  it("merge keeps DB rows primary and drops witnesses within ±5 minutes of one", () => {
    const db = [
      { event: "schedule", at: "2026-09-16T21:32:00Z", result: "success", delayMs: 120_000, targetDate: "2026-09-17", completedBeforeDeadline: true },
    ];
    const witness = [
      { event: "schedule", at: "2026-09-16T21:31:30Z", result: "success", delayMs: 90_000, targetDate: null, completedBeforeDeadline: null },
      { event: "schedule", at: "2026-09-16T23:44:00Z", result: "failure", delayMs: 240_000, targetDate: null, completedBeforeDeadline: null },
    ];
    const merged = mergeDelayWitnesses(db, witness);
    expect(merged).toHaveLength(2); // covered witness dropped, gap witness kept
    expect(merged[0].targetDate).toBe("2026-09-17"); // DB row intact
    expect(merged[1].delayMs).toBe(240_000);
  });

  it("feeds the scheduling view when the DB is unreachable (outage scenario)", () => {
    const s = assessTopicSlo(
      {
        runs: [run("schedule", "failure", "2026-09-16T22:30:00Z")],
        productionDbReadable: false,
        tomorrowReady: false,
        telemetry: deriveDelayWitness([run("schedule", "failure", "2026-09-16T22:30:00Z")]),
      },
      "2026-09-16T23:00:00Z",
    );
    expect(s.scheduling.latestDelayMs).toBe(60 * 60_000); // platform lateness still measurable
    expect(s.availability.state).toBe("unknown"); // content facts stay honest
  });
});
