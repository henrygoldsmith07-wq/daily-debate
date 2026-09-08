import { describe, expect, it } from "vitest";
import { buildFunnelReport, returnRate, type FunnelEventRow } from "./productFunnel";

const NOW = "2026-06-15T12:00:00Z";

function row(user: string, name: string, at: string, extra: Partial<FunnelEventRow> = {}): FunnelEventRow {
  return { user_id: user, name, format: null, reason: null, debate_id: null, created_at: at, ...extra };
}

function event(users: string[], name: string, at: string, extra?: Partial<FunnelEventRow>): FunnelEventRow[] {
  return users.map((u) => row(u, name, at, extra));
}

describe("buildFunnelReport", () => {
  it("computes the today→start rate over distinct users", () => {
    const rows = [
      ...event(["a", "b", "c", "d", "e"], "daily_viewed", "2026-06-14T09:00:00Z"),
      ...event(["a", "b", "c"], "sprint_started", "2026-06-14T09:05:00Z", { format: "sprint" }),
      ...event(["c", "a"], "sprint_started", "2026-06-14T09:05:00Z", { format: "sprint" }), // repeat user
    ];
    const report = buildFunnelReport(rows, { now: NOW, minSample: 3 });
    expect(report.dailyViewed).toBe(5);
    expect(report.startRate.numerator).toBe(3);
    expect(report.startRate.denominator).toBe(5);
    expect(report.startRate.rate).toBeCloseTo(0.6);
  });

  it("computes sprint vs full completion separately by format", () => {
    const rows = [
      ...event(["a", "b", "c", "d", "e"], "sprint_started", "2026-06-14T09:00:00Z", { format: "sprint" }),
      ...event(["a", "b"], "debate_completed", "2026-06-14T09:30:00Z", { format: "sprint" }),
      ...event(["x", "y", "z"], "full_debate_started", "2026-06-14T10:00:00Z", { format: "full" }),
      ...event(["x"], "debate_completed", "2026-06-14T11:00:00Z", { format: "full" }),
    ];
    const report = buildFunnelReport(rows, { now: NOW, minSample: 2 });
    expect(report.sprintCompletion.rate).toBeCloseTo(0.4);
    expect(report.fullCompletion.rate).toBeCloseTo(1 / 3);
  });

  it("computes repair start and completion through the funnel", () => {
    const rows = [
      ...event(["a", "b", "c", "d", "e"], "debate_completed", "2026-06-14T09:30:00Z"),
      ...event(["a", "b", "c"], "repair_started", "2026-06-14T09:35:00Z"),
      ...event(["a", "c"], "repair_completed", "2026-06-14T09:40:00Z"),
    ];
    const report = buildFunnelReport(rows, { now: NOW, minSample: 2 });
    expect(report.repairStart.rate).toBeCloseTo(0.6);
    expect(report.repairCompletion.rate).toBeCloseTo(2 / 3);
  });

  it("counts full-analysis opens and challenge-me reasons", () => {
    const rows = [
      ...event(["a", "b", "c", "d", "e"], "debate_completed", "2026-06-14T09:30:00Z"),
      ...event(["a", "b"], "full_analysis_opened", "2026-06-14T09:36:00Z"),
      ...event(["a"], "challenge_me_selected", "2026-06-14T09:00:00Z", { reason: "side-balance" }),
      ...event(["b", "c"], "challenge_me_selected", "2026-06-14T09:01:00Z", { reason: "side-balance" }),
      ...event(["d"], "challenge_me_selected", "2026-06-14T09:02:00Z", { reason: "random-cold-start" }),
    ];
    const report = buildFunnelReport(rows, { now: NOW, minSample: 2 });
    expect(report.fullAnalysisOpen.rate).toBeCloseTo(0.4);
    expect(report.challengeMe.numerator).toBe(4);
    expect(report.challengeMeReasons).toEqual([
      { reason: "side-balance", count: 3 },
      { reason: "random-cold-start", count: 1 },
    ]);
  });

  it("tracks friend-challenge creation and acceptance", () => {
    const rows = [
      ...event(["a", "b", "c", "d", "e"], "challenge_link_created", "2026-06-14T09:00:00Z"),
      ...event(["f", "a", "b", "c"], "challenge_link_accepted", "2026-06-15T09:00:00Z"),
    ];
    const report = buildFunnelReport(rows, { now: NOW, minSample: 3 });
    expect(report.friendChallenges.createdEvents).toBe(5);
    expect(report.friendChallenges.acceptedEvents).toBe(4);
    expect(report.friendChallenges.acceptRate.rate).toBeCloseTo(0.8);
  });

  it("refuses to report rates below the minimum sample", () => {
    const rows = [
      ...event(["a", "b"], "daily_viewed", "2026-06-14T09:00:00Z"),
      ...event(["a"], "sprint_started", "2026-06-14T09:05:00Z", { format: "sprint" }),
    ];
    const report = buildFunnelReport(rows, { now: NOW, minSample: 5 });
    expect(report.startRate.rate).toBeNull();
    expect(report.startRate.note).toMatch(/not yet measurable/);
    expect(report.startRate.numerator).toBe(1);
    expect(report.startRate.denominator).toBe(2);
  });

  it("respects the analysis window", () => {
    const rows = [
      ...event(["a", "b", "c", "d", "e"], "daily_viewed", "2026-06-14T09:00:00Z"),
      ...event(["a", "b", "c", "d", "e"], "daily_viewed", "2020-01-01T09:00:00Z"), // far outside 90d window
      ...event(["a", "b", "c", "d"], "sprint_started", "2026-06-14T09:05:00Z", { format: "sprint" }),
    ];
    const report = buildFunnelReport(rows, { now: NOW, windowDays: 90, minSample: 3 });
    expect(report.eventsAnalysed).toBe(9); // 5 + 4, old rows excluded
  });
});

describe("session conversion (per-debate funnel)", () => {
  function debateRows(
    user: string,
    debateId: string,
    opts: { started?: boolean; startedName?: string; completed?: boolean; completedFormat?: string; repairStarted?: boolean; repairCompleted?: boolean; analysisOpened?: boolean; at?: string } = {},
  ): FunnelEventRow[] {
    const at = opts.at ?? "2026-06-14T09:00:00Z";
    const isSprint = (opts.startedName ?? "sprint_started") === "sprint_started";
    const rows: FunnelEventRow[] = [];
    if (opts.started !== false) {
      rows.push(row(user, opts.startedName ?? "sprint_started", at, { format: isSprint ? "sprint" : "full", debate_id: debateId }));
    }
    if (opts.completed) {
      rows.push(row(user, "debate_completed", at, { format: opts.completedFormat ?? (isSprint ? "sprint" : "full"), debate_id: debateId }));
    }
    if (opts.repairStarted) rows.push(row(user, "repair_started", at, { debate_id: debateId }));
    if (opts.repairCompleted) rows.push(row(user, "repair_completed", at, { debate_id: debateId }));
    if (opts.analysisOpened) rows.push(row(user, "full_analysis_opened", at, { debate_id: debateId }));
    return rows;
  }

  it("reports session completion separately from user conversion", () => {
    // One user starts 10 sprints and completes only 1.
    const rows: FunnelEventRow[] = [];
    for (let i = 0; i < 10; i++) {
      rows.push(...debateRows("u1", `d-${i}`, { completed: i === 0, at: `2026-06-${10 + i}T09:00:00Z` }));
    }
    const report = buildFunnelReport(rows, { now: NOW, minSample: 1 });
    // User conversion: the user completed ≥1 sprint → 100% (a single user is
    // the whole denominator, so this reads as full success — which is exactly
    // why session conversion exists).
    expect(report.sprintCompletion.rate).toBe(1);
    // Session conversion: 1 of 10 debates completed → 10%.
    expect(report.sessions.sprintCompletion.denominator).toBe(10);
    expect(report.sessions.sprintCompletion.numerator).toBe(1);
    expect(report.sessions.sprintCompletion.rate).toBe(0.1);
    expect(report.sessions.debates).toBe(10);
  });

  it("separates sprint and full sessions by start format", () => {
    const rows = [
      ...debateRows("u1", "d-s1", { completed: true, at: "2026-06-10T09:00:00Z" }),
      ...debateRows("u1", "d-s2", { completed: false, at: "2026-06-11T09:00:00Z" }),
      ...debateRows("u1", "d-f1", { startedName: "full_debate_started", completed: true, completedFormat: "full", at: "2026-06-12T09:00:00Z" }),
      ...debateRows("u1", "d-f2", { startedName: "full_debate_started", completed: false, at: "2026-06-13T09:00:00Z" }),
    ];
    const report = buildFunnelReport(rows, { now: NOW, minSample: 2 });
    expect(report.sessions.sprintCompletion.rate).toBeCloseTo(0.5);
    expect(report.sessions.fullCompletion.rate).toBeCloseTo(0.5);
    expect(report.sessions.coverage).toBe(1);
  });

  it("measures repair and analysis steps per session", () => {
    const rows = [
      ...debateRows("u1", "d-1", { completed: true, repairStarted: true, repairCompleted: true, analysisOpened: true, at: "2026-06-10T09:00:00Z" }),
      ...debateRows("u1", "d-2", { completed: true, repairStarted: true, repairCompleted: false, analysisOpened: false, at: "2026-06-11T09:00:00Z" }),
      ...debateRows("u2", "d-3", { completed: true, repairStarted: false, repairCompleted: false, analysisOpened: false, at: "2026-06-12T09:00:00Z" }),
    ];
    const report = buildFunnelReport(rows, { now: NOW, minSample: 2 });
    expect(report.sessions.repairStart.rate).toBeCloseTo(2 / 3);
    expect(report.sessions.repairCompletion.rate).toBe(0.5);
    expect(report.sessions.fullAnalysisOpen.rate).toBeCloseTo(1 / 3);
  });

  it("excludes legacy events without a session id and reports coverage", () => {
    const rows = [
      // Legacy row (pre-migration-005): no debate_id.
      row("u1", "sprint_started", "2026-06-10T09:00:00Z", { format: "sprint" }),
      row("u1", "debate_completed", "2026-06-10T09:30:00Z", { format: "sprint" }),
      // Session-tagged rows.
      ...debateRows("u2", "d-1", { completed: true, at: "2026-06-12T09:00:00Z" }),
      ...debateRows("u2", "d-2", { completed: false, at: "2026-06-13T09:00:00Z" }),
    ];
    const report = buildFunnelReport(rows, { now: NOW, minSample: 2 });
    expect(report.sessions.debates).toBe(2); // legacy rows excluded
    expect(report.sessions.sprintCompletion.denominator).toBe(2);
    expect(report.sessions.coverage).toBeLessThan(1);
    expect(report.sessions.note).toMatch(/predate session ids/);
  });

  it("stays below the minimum sample threshold for sessions too", () => {
    const rows = [...debateRows("u1", "d-1", { completed: false })];
    const report = buildFunnelReport(rows, { now: NOW });
    expect(report.sessions.sprintCompletion.rate).toBeNull();
    expect(report.sessions.sprintCompletion.note).toMatch(/not yet measurable/);
  });
});

describe("returnRate (D1/D7)", () => {
  it("counts only users with a full N-day window as eligible", () => {
    const rows = [
      // user a: first activity Jun 1, returned Jun 2 → D1-eligible AND returned
      row("a", "daily_viewed", "2026-06-01T09:00:00Z"),
      row("a", "daily_viewed", "2026-06-02T09:00:00Z"),
      // user b: first activity Jun 1, no return → eligible, churned
      row("b", "daily_viewed", "2026-06-01T09:00:00Z"),
      // user c: first activity today → not yet eligible (pending)
      row("c", "daily_viewed", "2026-06-15T09:00:00Z"),
    ];
    const result = returnRate(rows, 1, NOW, 2);
    expect(result.eligibleUsers).toBe(2);
    expect(result.returnedUsers).toBe(1);
    expect(result.pendingUsers).toBe(1);
    expect(result.rate).toBeCloseTo(0.5);
  });

  it("requires N-day separation for D7", () => {
    const rows = [
      row("a", "daily_viewed", "2026-06-01T09:00:00Z"),
      row("a", "daily_viewed", "2026-06-08T09:00:00Z"), // exactly day+7
      row("b", "daily_viewed", "2026-06-01T09:00:00Z"),
      row("b", "daily_viewed", "2026-06-07T09:00:00Z"), // day+6 → not a D7 return
    ];
    const result = returnRate(rows, 7, NOW, 2);
    expect(result.eligibleUsers).toBe(2);
    expect(result.returnedUsers).toBe(1);
  });

  it("stays honest below the minimum sample", () => {
    const rows = [row("a", "daily_viewed", "2026-06-01T09:00:00Z")];
    const result = returnRate(rows, 1, NOW, 5);
    expect(result.rate).toBeNull();
    expect(result.note).toMatch(/not yet measurable/);
  });
});
