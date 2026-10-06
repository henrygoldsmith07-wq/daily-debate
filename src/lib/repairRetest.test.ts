import { describe, expect, it } from "vitest";
import {
  isDifferentRetestContext,
  pendingRepairRetest,
  pendingRepairRetests,
  pointMeasuresDimension,
  repairKindToDimension,
  selectEligiblePendingRetest,
  type RepairRetestAnchor,
} from "./repairRetest";
import type { MetricKey, SkillMetricPoint } from "./skillLedger";

function point(
  debateId: string,
  completedAt: string,
  values: Partial<Record<MetricKey, number | null>> = {},
  opportunities?: { majorClaims: number; opponentMoves: number },
  topicId = "topic-b",
  repairRetest: SkillMetricPoint["repairRetest"] = null,
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
  return { debateId, completedAt, topicId, metrics, opportunities, repairRetest };
}

const anchor: RepairRetestAnchor = {
  repairResultId: "repair-result-1",
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

  it("keeps multiple unresolved repairs and prioritises the oldest instead of the newest", () => {
    const older: RepairRetestAnchor = {
      repairResultId: "repair-result-older",
      debateId: "repair-older",
      targetKind: "evidence",
      attemptedAt: "2026-06-09T12:00:00Z",
      topicId: "topic-old",
    };
    const newer: RepairRetestAnchor = {
      repairResultId: "repair-result-newer",
      debateId: "repair-newer",
      targetKind: "rebuttal",
      attemptedAt: "2026-06-10T12:00:00Z",
      topicId: "topic-new",
    };
    const pending = pendingRepairRetests([], [newer, older]);
    expect(pending.map((item) => item.debateId)).toEqual(["repair-older", "repair-newer"]);
  });

  it("removes only the repair whose target was genuinely retested", () => {
    const anchors: RepairRetestAnchor[] = [
      {
        repairResultId: "repair-result-evidence",
        debateId: "repair-evidence",
        targetKind: "evidence",
        attemptedAt: "2026-06-09T12:00:00Z",
        topicId: "topic-a",
      },
      {
        repairResultId: "repair-result-rebuttal",
        debateId: "repair-rebuttal",
        targetKind: "rebuttal",
        attemptedAt: "2026-06-10T12:00:00Z",
        topicId: "topic-b",
      },
    ];
    const points = [
      point(
        "later-evidence",
        "2026-06-11T12:00:00Z",
        { unsupportedClaimRate: 0 },
        { majorClaims: 1, opponentMoves: 0 },
        "topic-c",
        {
          repairResultId: "repair-result-evidence",
          repairDebateId: "repair-evidence",
          targetKind: "evidence",
          attemptedAt: "2026-06-09T12:00:00Z",
        },
      ),
    ];
    const pending = pendingRepairRetests(points, anchors);
    expect(pending.map((item) => item.debateId)).toEqual(["repair-rebuttal"]);
  });

  it("treats a failed but observable evidence retest as a real retest", () => {
    const points = [
      point(
        "later",
        "2026-06-11T12:00:00Z",
        { unsupportedClaimRate: 1 },
        undefined,
        "topic-b",
        {
          repairResultId: anchor.repairResultId,
          repairDebateId: anchor.debateId,
          targetKind: anchor.targetKind,
          attemptedAt: anchor.attemptedAt,
        },
      ),
    ];
    // 100% unsupported is poor performance, but it is still measurable.
    expect(pointMeasuresDimension(points[0], "evidence")).toBe(true);
    expect(pendingRepairRetest(points, anchor)).toBeNull();
  });

  it("closes the retest when a later measurable reading exists", () => {
    const rebuttalAnchor = { ...anchor, repairResultId: "repair-result-rb", targetKind: "rebuttal" as const };
    const points = [
      point(
        "later",
        "2026-06-11T12:00:00Z",
        { rebuttalCoverage: 0.25 },
        undefined,
        "topic-b",
        {
          repairResultId: rebuttalAnchor.repairResultId,
          repairDebateId: rebuttalAnchor.debateId,
          targetKind: rebuttalAnchor.targetKind,
          attemptedAt: rebuttalAnchor.attemptedAt,
        },
      ),
    ];
    expect(
      pendingRepairRetest(points, rebuttalAnchor),
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
      point(
        "new-context",
        "2026-06-12T12:00:00Z",
        { unsupportedClaimRate: 0 },
        undefined,
        "topic-c",
        {
          repairResultId: anchor.repairResultId,
          repairDebateId: anchor.debateId,
          targetKind: anchor.targetKind,
          attemptedAt: anchor.attemptedAt,
        },
      ),
    ];
    expect(pendingRepairRetest(points, anchor)).toBeNull();
  });

  it("does not let an unassigned observable debate clear a repair", () => {
    const points = [
      point("incidental", "2026-06-11T12:00:00Z", { unsupportedClaimRate: 0 }),
    ];
    expect(pendingRepairRetest(points, anchor)?.repairResultId).toBe(anchor.repairResultId);
  });

  it("keeps pre-upgrade assigned debates valid through composite provenance matching", () => {
    const points = [
      point(
        "legacy-assigned",
        "2026-06-11T12:00:00Z",
        { unsupportedClaimRate: 0 },
        { majorClaims: 1, opponentMoves: 0 },
        "topic-b",
        {
          repairResultId: null,
          repairDebateId: anchor.debateId,
          targetKind: anchor.targetKind,
          attemptedAt: anchor.attemptedAt,
        },
      ),
    ];
    expect(pendingRepairRetest(points, anchor)).toBeNull();
  });

  it("skips an oldest same-topic repair and selects the next eligible pending repair", () => {
    const sameTopic: RepairRetestAnchor = {
      repairResultId: "same-topic",
      debateId: "repair-same",
      targetKind: "evidence",
      attemptedAt: "2026-06-09T12:00:00Z",
      topicId: "topic-today",
    };
    const eligible: RepairRetestAnchor = {
      repairResultId: "eligible",
      debateId: "repair-eligible",
      targetKind: "rebuttal",
      attemptedAt: "2026-06-10T12:00:00Z",
      topicId: "topic-old",
    };
    expect(selectEligiblePendingRetest([], [eligible, sameTopic], "topic-today")?.repairResultId).toBe("eligible");
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
