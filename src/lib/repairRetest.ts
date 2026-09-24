// Deliberate repair retest policy.
//
// A repair is practice. The next debate should deliberately exercise the same
// skill until there is an observable later reading for that dimension. This
// module is pure: persistence/query code supplies the latest repair attempt
// and the longitudinal skill points.
//
// Important: "observable" does NOT mean "successful". A later debate with a
// measurable bad reading still closes the pending retest because the transfer
// was genuinely tested. A debate with no opportunity for the target skill does
// not close it.

import type { RepairKind } from "./argumentRepair";
import type { CoachDimension } from "./adaptiveCoach";
import type { MetricKey, SkillMetricPoint } from "./skillLedger";

export const REPAIR_KIND_TO_DIMENSION: Record<RepairKind, CoachDimension> = {
  evidence: "evidence",
  rebuttal: "rebuttal",
  logic: "logic",
  impact: "impact",
  structure: "structure",
  clarity: "clarity",
};

export interface RepairRetestAnchor {
  debateId: string;
  targetKind: string;
  attemptedAt: string;
}

export interface PendingRepairRetest extends RepairRetestAnchor {
  dimension: CoachDimension;
}

// Metric choices are opportunity-aware where possible. Evidence deliberately
// uses unsupportedClaimRate rather than evidenceGrounding: a debate where the
// user makes claims but grounds none of them is still an observable FAILED
// evidence retest, not "no data".
const RETEST_METRICS: Record<CoachDimension, readonly MetricKey[]> = {
  evidence: ["unsupportedClaimRate"],
  rebuttal: ["rebuttalCoverage"],
  logic: ["fallacyRate"],
  clarity: ["clarity"],
  impact: ["impactHandling"],
  steelmanning: ["steelmanQuality"],
  structure: ["droppedArguments", "contradictions"],
};

export function repairKindToDimension(kind: string): CoachDimension | null {
  return Object.prototype.hasOwnProperty.call(REPAIR_KIND_TO_DIMENSION, kind)
    ? REPAIR_KIND_TO_DIMENSION[kind as RepairKind]
    : null;
}

export function pointMeasuresDimension(
  point: SkillMetricPoint,
  dimension: CoachDimension,
): boolean {
  const metricObserved = RETEST_METRICS[dimension].some(
    (metric) => point.metrics[metric] !== null,
  );
  if (!metricObserved) return false;

  const opportunities = point.opportunities;
  switch (dimension) {
    case "evidence":
    case "logic":
      // These repairs need the user to make at least one claim-like move.
      return opportunities ? opportunities.majorClaims > 0 : true;
    case "structure":
      // Structure is backed by dropped-argument and contradiction metrics.
      // A debate with one own claim and no opposing move offers neither:
      // dropped=0 and contradictions=0 are structural defaults, not proof.
      return opportunities
        ? opportunities.opponentMoves > 0 || opportunities.majorClaims >= 2
        : false;
    case "rebuttal":
      // rebuttalCoverage itself is null at zero canonical opportunities, but
      // keep the explicit gate so future metric changes cannot weaken this.
      return opportunities ? opportunities.opponentMoves > 0 : true;
    case "impact":
      // Mirror coachRewards.measureDimension: weighing is only testable when
      // there is something to weigh — an opposing move or at least two own
      // claims to compare. Legacy points without opportunity metadata stay
      // pending rather than being falsely cleared by a default zero.
      return opportunities
        ? opportunities.majorClaims > 0 &&
            (opportunities.opponentMoves > 0 || opportunities.majorClaims >= 2)
        : false;
    case "clarity":
      return point.metrics.clarity !== null;
    case "steelmanning":
      return opportunities ? opportunities.opponentMoves > 0 : metricObserved;
  }
}

/**
 * Return the repaired dimension while it still needs a real debate retest.
 * The repaired debate itself never satisfies the retest even if timestamps are
 * malformed; only a distinct later debate with an observable target metric can.
 */
export function pendingRepairRetest(
  points: SkillMetricPoint[],
  anchor: RepairRetestAnchor | null | undefined,
): PendingRepairRetest | null {
  if (!anchor) return null;
  const dimension = repairKindToDimension(anchor.targetKind);
  if (!dimension) return null;

  const anchorMs = Date.parse(anchor.attemptedAt);
  if (!Number.isFinite(anchorMs)) return null;

  const observedLater = points.some((point) => {
    if (point.debateId === anchor.debateId) return false;
    const completedMs = Date.parse(point.completedAt);
    return (
      Number.isFinite(completedMs) &&
      completedMs > anchorMs &&
      pointMeasuresDimension(point, dimension)
    );
  });

  return observedLater ? null : { ...anchor, dimension };
}
