import { describe, expect, it } from "vitest";
import { buildFunnelReport, returnRate, type FunnelEventRow } from "./productFunnel";

const NOW = "2026-06-15T12:00:00Z";

function row(user: string, name: string, at: string, extra: Partial<FunnelEventRow> = {}): FunnelEventRow {
  return { user_id: user, name, format: null, reason: null, created_at: at, ...extra };
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
