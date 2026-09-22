import { describe, expect, it } from "vitest";
import {
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
  return { debateId, completedAt, metrics };
}

const anchor: RepairRetestAnchor = {
  debateId: "repaired",
  targetKind: "evidence",
  attemptedAt: "2026-06-10T12:00:00Z",
};

describe("repair retest policy", () => {
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
      point("repaired", "2026-06-11T12:00:00Z", { unsupportedClaimRate: 0 }),
    ];
    expect(pendingRepairRetest(points, anchor)?.dimension).toBe("evidence");
  });

  it("uses either structural metric as an observable structure retest", () => {
    expect(
      pointMeasuresDimension(
        point("d", "2026-06-11T12:00:00Z", { droppedArguments: 0 }),
        "structure",
      ),
    ).toBe(true);
    expect(
      pointMeasuresDimension(
        point("d", "2026-06-11T12:00:00Z", { contradictions: 0 }),
        "structure",
      ),
    ).toBe(true);
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
