import { describe, expect, it } from "vitest";
import {
  assessGoalOutcome,
  buildCoachingGoal,
  pickFocusDimension,
  snapshotFromAssessment,
  type CoachingSnapshot,
} from "./coachingGoal";
import { assessArgumentGraph, mergeAssessmentGraphs, graphFromTurn } from "./observableAssessment";
import type { SkillMetricPoint, MetricKey } from "./skillLedger";

function point(metrics: Partial<Record<MetricKey, number | null>>, i = 0): SkillMetricPoint {
  const full = {
    unsupportedClaimRate: null,
    rebuttalCoverage: null,
    rebuttalTargeting: null,
    evidenceGrounding: null,
    droppedArguments: null,
    contradictions: null,
    impactHandling: null,
    steelmanQuality: null,
    fallacyRate: null,
    causalOverclaims: null,
    fakePrecisionHits: null,
    uncitedEvidenceRate: null,
    clarity: null,
    ...metrics,
  } as Record<MetricKey, number | null>;
  return { debateId: `d${i}`, completedAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), metrics: full };
}

function assessmentFromRounds(rounds: Array<{ user: string; ai: string }>) {
  const graphs = rounds.map((r, i) => graphFromTurn({ userMessage: r.user, opponentMessage: r.ai, round: i + 1 }));
  return assessArgumentGraph(mergeAssessmentGraphs(graphs), {
    sideA: "a",
    sideB: "ai",
    extractionSource: "deterministic",
    labelA: "You",
    labelB: "AI opponent",
  });
}

describe("pickFocusDimension", () => {
  it("returns null before any debate exists", () => {
    expect(pickFocusDimension([])).toBeNull();
  });

  it("picks the weakest dimension from the ledger", () => {
    const points = [
      point({ rebuttalCoverage: 0.9, evidenceGrounding: 0.2, clarity: 0.8 }, 0),
      point({ rebuttalCoverage: 0.9, evidenceGrounding: 0.25, clarity: 0.8 }, 1),
      point({ rebuttalCoverage: 0.9, evidenceGrounding: 0.3, clarity: 0.8 }, 2),
    ];
    const focus = pickFocusDimension(points);
    expect(focus).toBe("evidence");
  });
});

describe("snapshotFromAssessment", () => {
  it("counts answered responses and unsupported claims from the graph", () => {
    const assessment = assessmentFromRounds([
      { user: "Cities should invest in transit because it reduces congestion, according to NREL data.", ai: "However, remote work already reduces congestion, which undercuts the need for transit spending." },
      { user: "Even if remote work helps, peak travel still requires capacity; Brookings finds transit reliability drives economic growth.", ai: "But autonomous vehicles may solve capacity without transit investment." },
    ]);
    const snapshot = snapshotFromAssessment(assessment);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.responseOpportunities).toBeGreaterThan(0);
    expect(typeof snapshot!.unsupportedClaims).toBe("number");
  });

  it("returns null for an empty assessment", () => {
    expect(snapshotFromAssessment(null)).toBeNull();
  });
});

describe("buildCoachingGoal", () => {
  it("stays qualitative before any snapshot exists", () => {
    const points = [
      point({ rebuttalCoverage: 0.3, clarity: 0.8 }, 0),
      point({ rebuttalCoverage: 0.3, clarity: 0.8 }, 1),
      point({ rebuttalCoverage: 0.3, clarity: 0.8 }, 2),
    ];
    const goal = buildCoachingGoal(points, null);
    expect(goal?.dimension).toBe("rebuttal");
    expect(goal?.numeric).toBe(false);
    expect(goal?.lastLine).toBeNull();
    expect(goal?.goalLine).toBe(goal?.headline);
  });

  it("gives a numeric rebuttal goal when last time had enough opportunities", () => {
    const points = [
      point({ rebuttalCoverage: 0.4, clarity: 0.8 }, 0),
      point({ rebuttalCoverage: 0.4, clarity: 0.8 }, 1),
      point({ rebuttalCoverage: 0.4, clarity: 0.8 }, 2),
    ];
    const snapshot: CoachingSnapshot = {
      responsesAnswered: 2,
      responseOpportunities: 5,
      unsupportedClaims: 0,
      majorClaims: 4,
      droppedOwn: 0,
    };
    const goal = buildCoachingGoal(points, snapshot);
    expect(goal?.dimension).toBe("rebuttal");
    expect(goal?.numeric).toBe(true);
    expect(goal?.goalLine).toMatch(/Answer at least 4 of 5/i);
    expect(goal?.lastLine).toMatch(/answered 2 of 5/i);
  });

  it("does not force numbers when the sample is too small", () => {
    const points = [
      point({ rebuttalCoverage: 0.4, clarity: 0.8 }, 0),
      point({ rebuttalCoverage: 0.4, clarity: 0.8 }, 1),
      point({ rebuttalCoverage: 0.4, clarity: 0.8 }, 2),
    ];
    const snapshot: CoachingSnapshot = {
      responsesAnswered: 1,
      responseOpportunities: 2,
      unsupportedClaims: 0,
      majorClaims: 2,
      droppedOwn: 0,
    };
    const goal = buildCoachingGoal(points, snapshot);
    expect(goal?.numeric).toBe(false);
    expect(goal?.goalLine).toBe(goal?.headline);
  });
});

describe("assessGoalOutcome", () => {
  it("marks the rebuttal goal demonstrated at 80% coverage", () => {
    const ok = assessGoalOutcome("rebuttal", {
      responsesAnswered: 4,
      responseOpportunities: 5,
      unsupportedClaims: 0,
      majorClaims: 3,
      droppedOwn: 0,
    });
    expect(ok.demonstrated).toBe(true);
    const miss = assessGoalOutcome("rebuttal", {
      responsesAnswered: 2,
      responseOpportunities: 5,
      unsupportedClaims: 0,
      majorClaims: 3,
      droppedOwn: 0,
    });
    expect(miss.demonstrated).toBe(false);
  });

  it("reports not-measured for dimensions without an observable proxy", () => {
    const outcome = assessGoalOutcome("impact", {
      responsesAnswered: 0,
      responseOpportunities: 0,
      unsupportedClaims: 0,
      majorClaims: 0,
      droppedOwn: 0,
    });
    expect(outcome.demonstrated).toBeNull();
  });
});
