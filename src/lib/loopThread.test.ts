import { describe, expect, it } from "vitest";

import type { MetricKey, SkillMetricPoint } from "./skillLedger";
import type { LearnerModelInput } from "./learnerModel";
import { buildLearnerModel } from "./learnerModel";
import { buildLoopThread } from "./loopThread";

function point(
  id: string,
  at: string,
  metrics: Partial<Record<MetricKey, number | null>>,
): SkillMetricPoint {
  return {
    debateId: id,
    completedAt: at,
    metrics: {
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
    },
  };
}

// Three debates where Evidence was the clear weakness — same fixture shape as
// learnerModel.test.ts, so the thread is tested against the real model.
const weakEvidencePoints = [
  point("d1", "2026-01-01T00:00:00Z", {
    unsupportedClaimRate: 1,
    evidenceGrounding: 0,
    uncitedEvidenceRate: 1,
  }),
  point("d2", "2026-01-02T00:00:00Z", {
    unsupportedClaimRate: 1,
    evidenceGrounding: 0,
    uncitedEvidenceRate: 1,
  }),
  point("d3", "2026-01-03T00:00:00Z", {
    unsupportedClaimRate: 1,
    evidenceGrounding: 0,
    uncitedEvidenceRate: 1,
  }),
];

function threadFor(input: LearnerModelInput) {
  return buildLoopThread(buildLearnerModel(input));
}

function activeStage(thread: ReturnType<typeof threadFor>): string | undefined {
  return thread.stages.find((s) => s.status === "active")?.id;
}

describe("loopThread — the thread follows the open episode", () => {
  it("starts at practice before any debate exists", () => {
    const thread = threadFor({ points: [], repairs: [], retests: [] });
    expect(activeStage(thread)).toBe("practice");
    expect(thread.headline).toMatch(/first loop starts/i);
    // Nothing is invented: no open or demonstrated loops before any evidence.
    expect(thread.loopsOpen).toBe(0);
    expect(thread.loopsDemonstrated).toBe(0);
  });

  it("marks repair as active while the rewrite hasn't crossed the line", () => {
    const thread = threadFor({
      points: weakEvidencePoints,
      repairs: [
        { targetKind: "evidence", debateId: "d3", createdAt: "2026-01-03T10:00:00Z", succeeded: false },
      ],
      retests: [],
    });
    expect(activeStage(thread)).toBe("repair");
    expect(thread.headline).toMatch(/inside the evidence repair/i);
    expect(thread.loopsOpen).toBe(1);
  });

  it("moves to retest once the repair succeeds — the open promise", () => {
    const thread = threadFor({
      points: weakEvidencePoints,
      repairs: [
        { targetKind: "evidence", debateId: "d3", createdAt: "2026-01-03T10:00:00Z", succeeded: true },
      ],
      retests: [],
    });
    expect(activeStage(thread)).toBe("retest");
    expect(thread.headline).toMatch(/waiting to be tested/i);
    // A repair is practice, not proof — the thread must say so.
    expect(thread.detail).toMatch(/practice, not proof/i);
    expect(thread.loopsOpen).toBe(1);
    expect(thread.loopsDemonstrated).toBe(0);
  });

  it("stays on retest when the later debate gave no real opportunity", () => {
    const thread = threadFor({
      points: weakEvidencePoints,
      repairs: [
        { targetKind: "evidence", debateId: "d3", createdAt: "2026-01-03T10:00:00Z", succeeded: true },
      ],
      retests: [
        {
          targetKind: "evidence",
          repairDebateId: "d3",
          assignedDebateId: "d4",
          completedAt: "2026-01-05T00:00:00Z",
          observable: false,
          demonstrated: null,
        },
      ],
    });
    // No opportunity ≠ demonstration; the loop is still open.
    expect(activeStage(thread)).toBe("retest");
    expect(thread.loopsOpen).toBe(1);
    expect(thread.loopsDemonstrated).toBe(0);
  });

  it("sits on demonstrate when the chance came but the behaviour didn't", () => {
    const thread = threadFor({
      points: weakEvidencePoints,
      repairs: [
        { targetKind: "evidence", debateId: "d3", createdAt: "2026-01-03T10:00:00Z", succeeded: true },
      ],
      retests: [
        {
          targetKind: "evidence",
          repairDebateId: "d3",
          assignedDebateId: "d4",
          completedAt: "2026-01-05T00:00:00Z",
          observable: true,
          demonstrated: false,
        },
      ],
    });
    expect(activeStage(thread)).toBe("demonstrate");
    expect(thread.headline).toMatch(/didn't show the behaviour yet/i);
    expect(thread.loopsOpen).toBe(1);
    expect(thread.loopsDemonstrated).toBe(0);
  });

  it("closes every stage only on a later unprompted demonstration", () => {
    const thread = threadFor({
      points: weakEvidencePoints,
      repairs: [
        { targetKind: "evidence", debateId: "d3", createdAt: "2026-01-03T10:00:00Z", succeeded: true },
      ],
      retests: [
        {
          targetKind: "evidence",
          repairDebateId: "d3",
          assignedDebateId: "d4",
          completedAt: "2026-01-05T00:00:00Z",
          observable: true,
          demonstrated: true,
        },
      ],
    });
    expect(activeStage(thread)).toBeUndefined();
    expect(thread.stages.every((s) => s.status === "done")).toBe(true);
    expect(thread.headline).toMatch(/one loop closed/i);
    expect(thread.loopsOpen).toBe(0);
    expect(thread.loopsDemonstrated).toBe(1);
  });

  it("prefers an open episode over a closed one when both exist", () => {
    const thread = threadFor({
      points: weakEvidencePoints,
      repairs: [
        // Evidence: repaired and demonstrated — a closed loop.
        { targetKind: "evidence", debateId: "d1", createdAt: "2026-01-01T10:00:00Z", succeeded: true },
        // Rebuttal: repaired, still waiting for its test — an open loop.
        { targetKind: "rebuttal", debateId: "d3", createdAt: "2026-01-03T10:00:00Z", succeeded: true },
      ],
      retests: [
        {
          targetKind: "evidence",
          repairDebateId: "d1",
          assignedDebateId: "d2",
          completedAt: "2026-01-02T00:00:00Z",
          observable: true,
          demonstrated: true,
        },
      ],
    });
    // The thread must tell the open story, not celebrate the closed one.
    expect(thread.skillLabel).toBe("Rebuttal");
    expect(activeStage(thread)).toBe("retest");
    expect(thread.loopsOpen).toBe(1);
    expect(thread.loopsDemonstrated).toBe(1);
  });

  it("never inflates loops from collapsed retry attempts", () => {
    const thread = threadFor({
      points: weakEvidencePoints,
      repairs: [
        { targetKind: "evidence", debateId: "d3", createdAt: "2026-01-03T09:00:00Z", succeeded: false },
        { targetKind: "evidence", debateId: "d3", createdAt: "2026-01-03T10:00:00Z", succeeded: false },
        { targetKind: "evidence", debateId: "d3", createdAt: "2026-01-03T11:00:00Z", succeeded: true },
      ],
      retests: [],
    });
    // Three raw rewrites, one episode, one open loop.
    expect(thread.loopsOpen).toBe(1);
    expect(activeStage(thread)).toBe("retest");
  });
});
