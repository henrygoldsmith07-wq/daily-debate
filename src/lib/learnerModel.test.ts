import { describe, expect, it } from "vitest";

import type { MetricKey, SkillMetricPoint } from "./skillLedger";
import { buildLearnerModel, MIN_SKILL_SAMPLE } from "./learnerModel";

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

// Three debates where Evidence was the clear weakness: unsupported claims,
// no grounded citations, all cited evidence uncited. Goodness -> 0.0.
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

describe("learnerModel — adaptive practice selection", () => {
  it("prioritises a due retest of a successful repair above everything else", () => {
    const model = buildLearnerModel({
      points: weakEvidencePoints,
      repairs: [
        { targetKind: "evidence", debateId: "d3", createdAt: "2026-01-03T10:00:00Z", succeeded: true },
      ],
      retests: [],
    });
    expect(model.nextPractice?.priority).toBe("retest-due");
    expect(model.nextPractice?.skill).toBe("evidence");
    expect(model.nextPractice?.reason).toMatch(/repaired evidence/i);
    // A repair is practice, not proof — the caveat must say so.
    expect(model.nextPractice?.caveat).toMatch(/practice, not proof/i);
  });

  it("targets the persistent weakness when no retest is owed", () => {
    const model = buildLearnerModel({
      points: weakEvidencePoints,
      repairs: [],
      retests: [],
    });
    expect(model.nextPractice?.priority).toBe("persistent-weakness");
    expect(model.nextPractice?.skill).toBe("evidence");
    expect(model.nextPractice?.reason).toMatch(/room to grow/i);
  });

  it("asks for more evidence rather than scoring a skill it cannot judge", () => {
    const model = buildLearnerModel({
      points: [point("d1", "2026-01-01T00:00:00Z", { clarity: 0.5 })],
      repairs: [],
      retests: [],
    });
    expect(model.nextPractice?.priority).toBe("needs-evidence");
    expect(model.nextPractice?.caveat).toMatch(/not a low score/i);
    // Insufficient evidence is represented explicitly, never as a zero.
    const rebuttal = model.skills.find((s) => s.key === "rebuttal");
    expect(rebuttal?.level).toBeNull();
    expect(rebuttal?.note).toMatch(/open question/i);
  });

  it("never calls a thin sample a demonstrated weakness", () => {
    const model = buildLearnerModel({
      points: [point("d1", "2026-01-01T00:00:00Z", { clarity: 0.5 })],
      repairs: [],
      retests: [],
    });
    expect(model.weaknesses.length).toBe(0);
    const clarity = model.skills.find((s) => s.key === "clarity");
    expect(clarity?.claim).toBe("provisional");
    expect(clarity?.confidence).toBe("low");
    expect(clarity?.sampleSize).toBeLessThan(MIN_SKILL_SAMPLE);
  });
});

describe("learnerModel — repair is practice, demonstration is separate", () => {
  it("reports a later unprompted demonstration as demonstration", () => {
    const model = buildLearnerModel({
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
    const repair = model.repairs.find((r) => r.skill === "evidence");
    expect(repair?.status).toBe("repaired-demonstrated-later");
    expect(repair?.demonstratedLater).toBe(true);
    expect(model.questions.didIDemonstrateIt).toMatch(/^Yes/);
    // With the loop closed, selection falls to the weakness.
    expect(model.nextPractice?.priority).toBe("persistent-weakness");
  });

  it("keeps the retest pending when the later debate had no real opportunity", () => {
    const model = buildLearnerModel({
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
    // Insufficient opportunity cannot clear a pending retest or count as a demo.
    const repair = model.repairs.find((r) => r.skill === "evidence");
    expect(repair?.awaitingRetest).toBe(true);
    expect(repair?.demonstratedLater).toBe(false);
    expect(model.nextPractice?.priority).toBe("retest-due");
    expect(model.retests[0]?.status).toBe("no-opportunity");
  });

  it("treats a retested-but-not-demonstrated outcome as non-demonstration", () => {
    const model = buildLearnerModel({
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
    const repair = model.repairs.find((r) => r.skill === "evidence");
    expect(repair?.status).toBe("repaired-not-yet-demonstrated");
    expect(model.questions.didIDemonstrateIt).toMatch(/didn't appear/i);
    expect(model.retests[0]?.status).toBe("not-demonstrated");
  });

  it("collapses retry attempts so a repaired skill is not over-counted", () => {
    const model = buildLearnerModel({
      points: weakEvidencePoints,
      repairs: [
        { targetKind: "evidence", debateId: "d3", createdAt: "2026-01-03T09:00:00Z", succeeded: false },
        { targetKind: "evidence", debateId: "d3", createdAt: "2026-01-03T10:00:00Z", succeeded: true },
        { targetKind: "evidence", debateId: "d3", createdAt: "2026-01-03T11:00:00Z", succeeded: true },
      ],
      retests: [],
    });
    const repair = model.repairs.find((r) => r.skill === "evidence");
    // One episode (one debate/one skill), despite three raw rewrites.
    expect(repair?.successfulEpisodes).toBe(1);
    expect(repair?.totalAttempts).toBe(3);
  });
});
