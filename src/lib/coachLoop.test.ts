import { describe, it, expect } from "vitest";
import {
  computeLoopStatuses,
  measureDebateImprovement,
  checkRetention,
  formatCoachPrompt,
  dimensionTimeline,
} from "./coachLoop";
import type { DrillAssignmentLite } from "./coachLoop";

function pt(i: number, metrics: Partial<Record<string, number | null>>) {
  return {
    completedAt: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
    metrics: { unsupportedClaimRate: null, rebuttalCoverage: null, evidenceGrounding: null, droppedArguments: null, contradictions: null, impactHandling: null, steelmanQuality: null, fallacyRate: null, causalOverclaims: null, fakePrecisionHits: null, uncitedEvidenceRate: null, clarity: null, ...metrics },
  };
}

function assignment(overrides?: Partial<DrillAssignmentLite>): DrillAssignmentLite {
  return {
    id: "a1",
    dimension: "impact",
    assignedDate: "2026-01-03",
    createdAt: "2026-01-03T12:00:00Z",
    beforeScore: 40,
    attemptText: "Impact A outweighs impact B because...",
    attemptScore: 70,
    movement: null,
    status: "attempted",
    ...overrides,
  };
}

describe("dimensionTimeline", () => {
  it("extracts goodness-normalised values for a metric", () => {
    // fallacyRate is lower-better: 0.3 → goodness 0.7
    const pts = [pt(0, { fallacyRate: 0.3 }), pt(1, { fallacyRate: 0.1 })];
    const tl = dimensionTimeline(pts, "logic");
    expect(tl).toHaveLength(2);
    expect(tl[0].value).toBeCloseTo(0.7);
    expect(tl[1].value).toBeCloseTo(0.9);
  });
});

describe("measureDebateImprovement", () => {
  it("detects improvement when post-drill values are higher", () => {
    const pts = [
      pt(0, { impactHandling: 0.4 }),
      pt(1, { impactHandling: 0.5 }),
      pt(2, { impactHandling: 0.8 }), // drill assigned at this point
      pt(3, { impactHandling: 0.9 }),
    ];
    const m = measureDebateImprovement(dimensionTimeline(pts, "impact"), pts[2].completedAt, 1);
    expect(m.improved).toBe(true);
    expect(m.delta).toBeGreaterThan(0);
  });

  it("returns null when drill date is after all data points", () => {
    const pts = [pt(0, { impactHandling: 0.4 }), pt(1, { impactHandling: 0.5 })];
    const tl = dimensionTimeline(pts, "impact");
    const m = measureDebateImprovement(tl, "2026-03-01T00:00:00Z", 2);
    expect(m.improved).toBeNull();
  });
});

describe("checkRetention", () => {
  it("confirms retention when all post-improvement values stay above baseline", () => {
    const pts = [
      pt(0, { impactHandling: 0.3 }),
      pt(1, { impactHandling: 0.35 }),
      pt(2, { impactHandling: 0.8 }), // drill assigned here
      pt(3, { impactHandling: 0.85 }),
      pt(4, { impactHandling: 0.82 }),
    ];
    const r = checkRetention(dimensionTimeline(pts, "impact"), pts[2].completedAt, 1, 2);
    expect(r).toBe(true);
  });

  it("detects regression when values fall back to baseline", () => {
    const pts = [
      pt(0, { impactHandling: 0.5 }),
      pt(1, { impactHandling: 0.8 }), // drill assigned here
      pt(2, { impactHandling: 0.85 }), // spike
      pt(3, { impactHandling: 0.45 }), // regressed
      pt(4, { impactHandling: 0.48 }),
    ];
    const r = checkRetention(dimensionTimeline(pts, "impact"), pts[1].completedAt, 1, 2);
    expect(r).toBe(false);
  });
});

describe("computeLoopStatuses", () => {
  it("full lifecycle: detected → practised → improved in drill → improved in debate", () => {
    const points = [
      pt(0, { impactHandling: 0.3 }),
      pt(1, { impactHandling: 0.35 }),
      pt(2, { impactHandling: 0.4 }), // drill assigned around here
      pt(3, { impactHandling: 0.75 }), // improved!
      pt(4, { impactHandling: 0.80 }), // sustained
    ];
    const assignments = [assignment()];
    const statuses = computeLoopStatuses(points, assignments);

    expect(statuses).toHaveLength(1);
    const s = statuses[0];
    expect(s.dimension).toBe("impact");
    expect(["improved_in_debate", "retained"]).toContain(s.stage);
    expect(s.debateMovement).not.toBeNull();
  });

  it("advances to improved_in_drill on strong attempt score alone", () => {
    const points = [
      pt(0, { impactHandling: 0.3 }),
      pt(1, { impactHandling: 0.35 }),
    ];
    const assignments = [{
      ...assignment(),
      createdAt: "2026-01-02T12:00:00Z",
      status: "attempted" as const,
      beforeScore: 30,
      attemptScore: 60,
    }];
    const statuses = computeLoopStatuses(points, assignments);
    // Attempt score 60 > before 30, so improved_in_drill — no future debates needed yet
    expect(statuses[0].stage).toBe("improved_in_drill");
  });

  it("stays at detected for open assignments without attempts", () => {
    const points = [pt(0, { impactHandling: 0.3 })];
    const assignments = [{ ...assignment(), status: "open" as const, attemptText: null, attemptScore: null }];
    const statuses = computeLoopStatuses(points, assignments);
    for (const s of statuses) expect(s.stage).toBe("detected");
  });

  it("handles empty assignments gracefully", () => {
    const statuses = computeLoopStatuses([], []);
    expect(statuses).toHaveLength(0);
  });
});

describe("formatCoachPrompt", () => {
  it("prompts to start drill when one is open", () => {
    const p = formatCoachPrompt(
      { regressions: ["impact"], trajectories: { impact: { last: 0.4, improved: false } }, minimumForClaims: 10, debates: 5 },
      assignment({ status: "open" })
    );
    expect(p.show).toBe(true);
    expect(p.ctaLabel).toContain("drill");
  });

  it("shows completion message after attempting", () => {
    const p = formatCoachPrompt(
      { regressions: [], trajectories: {}, minimumForClaims: 10, debates: 5 },
      assignment({ status: "attempted" })
    );
    expect(p.show).toBe(true);
    expect(p.detail).toContain("next debate");
  });

  it("hides prompt with insufficient data", () => {
    const p = formatCoachPrompt({ regressions: [], trajectories: {}, minimumForClaims: 10, debates: 1 });
    expect(p.show).toBe(false);
  });
});
