import { describe, expect, it } from "vitest";
import {
  isDifferentRetestContext,
  pendingRepairRetest,
  pointMeasuresDimension,
  repairKindToDimension,
  type RepairRetestAnchor,
} from "./repairRetest";
import type { MetricKey, SkillMetricPoint } from "./skillLedger";

function point(
  debateId: string,
  completedAt: string,
  values: Partial<Record<MetricKey, number | null>> = {},
  opportunities?: { majorClaims: number; opponentMoves: number },
  topicId = "topic-b",
): SkillMetricPoint {
  const metrics = {
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
    ...values,
  } satisfies Record<MetricKey, number | null>;
  return { debateId, completedAt, topicId, metrics, opportunities };
}

const anchor: RepairRetestAnchor = {
  debateId: "repaired",
  targetKind: "evidence",
  attemptedAt: "2026-06-10T12:00:00Z",
  topicId: "topic-a",
};

describe("repair retest policy", () => {
  it("requires a different topic before calling a later debate a transfer retest", () => {
    expect(isDifferentRetestContext("topic-a", "topic-b")).toBe(true);
    expect(isDifferentRetestContext("topic-a", "topic-a")).toBe(false);
    expect(isDifferentRetestContext(null, "topic-b")).toBe(false);
  });

  it("maps every repair kind onto its coach dimension", () => {
    expect(repairKindToDimension("evidence")).toBe("evidence");
    expect(repairKindToDimension("rebuttal")).toBe("rebuttal");
    expect(repairKindToDimension("logic")).toBe("logic");
    expect(repairKindToDimension("impact")).toBe("impact");
    expect(repairKindToDimension("structure")).toBe("structure");
    expect(repairKindToDimension("clarity")).toBe("clarity");
    expect(repairKindToDimension("unknown")).toBeNull();
  });

  it("keeps a repair pending until a distinct later debate can measure it", () => {
    const points = [
      point("repaired", "2026-06-10T11:00:00Z", { unsupportedClaimRate: 1 }),
      point("quiet", "2026-06-11T12:00:00Z", { unsupportedClaimRate: null }),
    ];
    expect(pendingRepairRetest(points, anchor)?.dimension).toBe("evidence");
  });

  it("treats a failed but observable evidence retest as a real retest", () => {
    const points = [
      point("later", "2026-06-11T12:00:00Z", { unsupportedClaimRate: 1 }),
    ];
    // 100% unsupported is poor performance, but it is still measurable.
    expect(pointMeasuresDimension(points[0], "evidence")).toBe(true);
    expect(pendingRepairRetest(points, anchor)).toBeNull();
  });

  it("closes the retest when a later measurable reading exists", () => {
    const points = [
      point("later", "2026-06-11T12:00:00Z", { rebuttalCoverage: 0.25 }),
    ];
    expect(
      pendingRepairRetest(points, { ...anchor, targetKind: "rebuttal" }),
    ).toBeNull();
  });

  it("does not let the repaired debate satisfy its own retest", () => {
    const points = [
      point("repaired", "2026-06-11T12:00:00Z", { unsupportedClaimRate: 0 }, undefined, "topic-a"),
    ];
    expect(pendingRepairRetest(points, anchor)?.dimension).toBe("evidence");
  });

  it("does not let a same-topic replay clear transfer state", () => {
    const points = [
      point("same-topic-replay", "2026-06-11T12:00:00Z", { unsupportedClaimRate: 0 }, undefined, "topic-a"),
    ];
    expect(pendingRepairRetest(points, anchor)?.dimension).toBe("evidence");
  });

  it("clears transfer state only after an observable different-topic debate", () => {
    const points = [
      point("same-topic-replay", "2026-06-11T12:00:00Z", { unsupportedClaimRate: 0 }, undefined, "topic-a"),
      point("new-context", "2026-06-12T12:00:00Z", { unsupportedClaimRate: 0 }, undefined, "topic-c"),
    ];
    expect(pendingRepairRetest(points, anchor)).toBeNull();
  });

  it("uses either structural metric when its underlying opportunity exists", () => {
    expect(
      pointMeasuresDimension(
        point(
          "d",
          "2026-06-11T12:00:00Z",
          { droppedArguments: 0 },
          { majorClaims: 1, opponentMoves: 1 },
        ),
        "structure",
      ),
    ).toBe(true);
    expect(
      pointMeasuresDimension(
        point(
          "d",
          "2026-06-11T12:00:00Z",
          { contradictions: 0 },
          { majorClaims: 2, opponentMoves: 0 },
        ),
        "structure",
      ),
    ).toBe(true);
  });

  it("does not clear structure or impact when the debate had no genuine opportunity", () => {
    const structure = point(
      "s",
      "2026-06-11T12:00:00Z",
      { droppedArguments: 0, contradictions: 0 },
      { majorClaims: 0, opponentMoves: 0 },
    );
    expect(pointMeasuresDimension(structure, "structure")).toBe(false);

    const impact = point(
      "i",
      "2026-06-11T12:00:00Z",
      { impactHandling: 0 },
      { majorClaims: 1, opponentMoves: 0 },
    );
    expect(pointMeasuresDimension(impact, "impact")).toBe(false);
  });

  it("keeps structure pending with one own claim and no opposing move", () => {
    const pointWithDefaultZeroes = point(
      "s-one-claim",
      "2026-06-11T12:00:00Z",
      { droppedArguments: 0, contradictions: 0 },
      { majorClaims: 1, opponentMoves: 0 },
    );
    expect(
      pointMeasuresDimension(pointWithDefaultZeroes, "structure"),
    ).toBe(false);
  });

  it("clears impact only when there was something real to weigh", () => {
    const versusOpponent = point(
      "i1",
      "2026-06-11T12:00:00Z",
      { impactHandling: 0 },
      { majorClaims: 1, opponentMoves: 1 },
    );
    const twoOwnClaims = point(
      "i2",
      "2026-06-11T12:00:00Z",
      { impactHandling: 0 },
      { majorClaims: 2, opponentMoves: 0 },
    );
    expect(pointMeasuresDimension(versusOpponent, "impact")).toBe(true);
    expect(pointMeasuresDimension(twoOwnClaims, "impact")).toBe(true);
  });

  it("ignores invalid timestamps rather than manufacturing a retest", () => {
    expect(
      pendingRepairRetest(
        [point("later", "2026-06-11T12:00:00Z", { unsupportedClaimRate: 0 })],
        { ...anchor, attemptedAt: "not-a-date" },
      ),
    ).toBeNull();
  });
});
