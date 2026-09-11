import { describe, expect, it } from "vitest";
import {
  assessAppHealth,
  assessDatabaseHealth,
  assessJudgeHealth,
  assessTopicHealth,
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
  it("takes the worst known state and ignores unknowns", () => {
    expect(rollupOverall(["healthy", "unknown"])).toBe("healthy");
    expect(rollupOverall(["healthy", "degraded", "stale"])).toBe("stale");
    expect(rollupOverall(["blocked", "failed"])).toBe("failed");
    expect(rollupOverall(["unknown"])).toBe("healthy");
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
  it("rolls up the worst known state and lists unknowns separately", () => {
    const r = buildOpsHealthReport({
      generatedAt: "2026-09-11T10:00:00Z",
      topic: assessTopicHealth(null, "2026-09-11T10:00:00Z"),
      judge: assessJudgeHealth(null, "2026-09-11T10:00:00Z"),
      database: assessDatabaseHealth({ reachable: true, latencyMs: 30 }),
      app: assessAppHealth(null, "https://example.invalid/actions"),
    });
    expect(r.overall).toBe("blocked");
    expect(r.unknowns).toEqual(["app/ci"]);
    expect(r.notes.length).toBeGreaterThan(0);
  });
});
