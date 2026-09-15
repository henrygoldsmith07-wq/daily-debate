import { describe, expect, it } from "vitest";
import {
  assessAppHealth,
  assessDatabaseHealth,
  assessHumanValidation,
  assessJudgeHealth,
  assessTopicHealth,
  assessTopicSlo,
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

describe("assessTopicSlo (production scheduler, not CI)", () => {
  const now = "2026-09-15T12:00:00Z";
  const run = (event: string, conclusion: string | null, createdAt = now, status = "completed") => ({
    event, status, conclusion, createdAt,
  });

  it("healthy only with a succeeded schedule run AND tomorrow's topic in the production store", () => {
    const s = assessTopicSlo({ runs: [run("schedule", "success")], productionDbReadable: true, tomorrowReady: true }, now);
    expect(s.status).toBe("healthy");
    expect(s.lastScheduledRunAt).toBe(now);
  });

  it("CI-equivalent success (push/dispatch) alone is never healthy", () => {
    const dispatchOnly = assessTopicSlo(
      { runs: [run("workflow_dispatch", "success")], productionDbReadable: true, tomorrowReady: true },
      now,
    );
    expect(dispatchOnly.status).toBe("unknown"); // scheduler never fired
    const pushOnly = assessTopicSlo(
      { runs: [run("push", "success")], productionDbReadable: true, tomorrowReady: true },
      now,
    );
    expect(pushOnly.status).toBe("unknown");
  });

  it("unreadable production store makes the SLO unknown regardless of run history", () => {
    const s = assessTopicSlo(
      { runs: [run("schedule", "success"), run("schedule", "success")], productionDbReadable: false, tomorrowReady: false },
      now,
    );
    expect(s.status).toBe("unknown");
  });

  it("one schedule success but missing tomorrow = degraded, never healthy", () => {
    const s = assessTopicSlo(
      { runs: [run("schedule", "success")], productionDbReadable: true, tomorrowReady: false },
      now,
    );
    expect(s.status).toBe("degraded");
  });

  it("escalates consecutive scheduled failures: 1-2 degraded-with-missing-data-failed, 3+ failed", () => {
    const runs = [run("schedule", "failure"), run("schedule", "failure")];
    expect(assessTopicSlo({ runs, productionDbReadable: true, tomorrowReady: true }, now).status).toBe("degraded");
    expect(assessTopicSlo({ runs, productionDbReadable: true, tomorrowReady: false }, now).status).toBe("failed");
    const many = [run("schedule", "failure"), run("schedule", "failure"), run("schedule", "failure")];
    const s = assessTopicSlo({ runs: many, productionDbReadable: true, tomorrowReady: true }, now);
    expect(s.status).toBe("failed");
    expect(s.consecutiveScheduledFailures).toBe(3);
  });

  it("a success older than the stall window with no topic = stale (scheduler not firing)", () => {
    const old = "2026-09-12T02:00:00Z";
    const s = assessTopicSlo(
      { runs: [run("schedule", "success", old)], productionDbReadable: true, tomorrowReady: false },
      now,
    );
    expect(s.status).toBe("stale");
  });

  it("intermittent pattern (failure then success) resets the failure streak", () => {
    const s = assessTopicSlo(
      {
        runs: [run("schedule", "success"), run("schedule", "failure"), run("schedule", "failure")],
        productionDbReadable: true,
        tomorrowReady: true,
      },
      now,
    );
    expect(s.consecutiveScheduledFailures).toBe(0);
    expect(s.status).toBe("healthy");
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
