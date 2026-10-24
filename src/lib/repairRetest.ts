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

import { isRepairKind, type RepairKind } from "./argumentRepair";
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
  /** Stable identity of the successful repair_results row. */
  repairResultId: string;
  debateId: string;
  targetKind: RepairKind;
  attemptedAt: string;
  /** Topic of the repaired debate; transfer must occur on a different topic. */
  topicId: string | null;
}

export interface PendingRepairRetest extends RepairRetestAnchor {
  dimension: CoachDimension;
}

export interface AssignedRepairRetest {
  repairResultId?: string | null;
  repairDebateId: string;
  targetKind: RepairKind;
  attemptedAt: string;
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

export function repairKindToDimension(kind: unknown): CoachDimension | null {
  return isRepairKind(kind) ? REPAIR_KIND_TO_DIMENSION[kind] : null;
}

/** Transfer requires a different debate context, not a replay of the repaired topic. */
export function isDifferentRetestContext(
  repairTopicId: string | null | undefined,
  currentTopicId: string | null | undefined,
): boolean {
  return (
    typeof repairTopicId === "string" &&
    repairTopicId.length > 0 &&
    typeof currentTopicId === "string" &&
    currentTopicId.length > 0 &&
    repairTopicId !== currentTopicId
  );
}

/**
 * How today's practice motion treats a due retest. Product decision (Henry,
 * 24 Oct 2026; docs/roadmap.md — day-1 retargeting is the lever):
 *
 * - "serve-shared": today's shared motion is a DIFFERENT topic from the
 *   repaired debate, so it carries the retest — INCLUDING on the day of the
 *   repair. Transfer is a different context, not a later calendar day.
 * - "swap-motion": the shared motion IS the repaired topic and the repair was
 *   made on an earlier day — serve a different motion so the retest can run.
 * - "keep-queued": the shared motion is the repaired topic and the repair was
 *   made today (a same-day replay of the repaired motion is practice, not
 *   transfer, and the motion is not swapped away on the repair day), or the
 *   repaired topic is unknown. The retest stays pending.
 *
 * Days are YYYY-MM-DD keys supplied by the caller.
 */
export type RetestMotionPlan = "serve-shared" | "swap-motion" | "keep-queued";

export function planRetestMotion(input: {
  repairTopicId: string | null | undefined;
  repairedOn: string;
  sharedTopicId: string;
  today: string;
}): RetestMotionPlan {
  const { repairTopicId, repairedOn, sharedTopicId, today } = input;
  if (isDifferentRetestContext(repairTopicId, sharedTopicId)) return "serve-shared";
  if (repairTopicId && repairTopicId === sharedTopicId && repairedOn !== today) return "swap-motion";
  return "keep-queued";
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

export const REPAIR_RETEST_EXPIRY_DAYS = 14;

/**
 * Return the repaired dimension while it still needs a real debate retest.
 * The repaired debate itself never satisfies the retest even if timestamps are
 * malformed; only a distinct later debate with an observable target metric can.
 */
export function pendingRepairRetest(
  points: SkillMetricPoint[],
  anchor: RepairRetestAnchor | null | undefined,
  nowMs: number = Date.now(),
): PendingRepairRetest | null {
  if (!anchor) return null;
  const dimension = repairKindToDimension(anchor.targetKind);
  if (!dimension) return null;

  const anchorMs = Date.parse(anchor.attemptedAt);
  if (!Number.isFinite(anchorMs)) return null;

  if (observedRepairRetestPoint(points, anchor)) return null;
  // Honest release: a retest with no observable opportunity for two weeks is
  // closed as "insufficient opportunity" (not failure, not success), so the
  // skill is coached again instead of being excluded forever.
  if (nowMs - anchorMs > REPAIR_RETEST_EXPIRY_DAYS * 86_400_000) return null;

  return { ...anchor, dimension };
}

/** How long after expiry the "closed untested" notice stays on Today. */
export const LAPSED_NOTICE_DAYS = 14;

/**
 * Repairs whose retest was closed as "insufficient opportunity": never
 * observed, and past the expiry window, but recent enough (another
 * LAPSED_NOTICE_DAYS) that the learner should hear about it once instead of
 * the loop silently vanishing. Not a pass, not a failure, never scored.
 * Newest first.
 */
export function lapsedRepairRetests(
  points: SkillMetricPoint[],
  anchors: RepairRetestAnchor[],
  nowMs: number = Date.now(),
): PendingRepairRetest[] {
  const out: PendingRepairRetest[] = [];
  for (const anchor of anchors) {
    const dimension = repairKindToDimension(anchor.targetKind);
    const anchorMs = Date.parse(anchor.attemptedAt);
    if (!dimension || !Number.isFinite(anchorMs)) continue;
    if (observedRepairRetestPoint(points, anchor)) continue;
    const age = nowMs - anchorMs;
    if (age <= REPAIR_RETEST_EXPIRY_DAYS * 86_400_000) continue;
    if (age > (REPAIR_RETEST_EXPIRY_DAYS + LAPSED_NOTICE_DAYS) * 86_400_000) continue;
    out.push({ ...anchor, dimension });
  }
  return out.sort((a, b) => Date.parse(b.attemptedAt) - Date.parse(a.attemptedAt));
}

/**
 * Find the explicit assigned debate that genuinely observed this repaired
 * dimension. This is also used once to reconcile pre-025 assignments into the
 * durable repair_retests table.
 */
export function observedRepairRetestPoint(
  points: SkillMetricPoint[],
  anchor: RepairRetestAnchor,
): SkillMetricPoint | null {
  const dimension = repairKindToDimension(anchor.targetKind);
  if (!dimension) return null;
  const anchorMs = Date.parse(anchor.attemptedAt);
  if (!Number.isFinite(anchorMs)) return null;

  return points.find((point) => {
    if (point.debateId === anchor.debateId) return false;
    if (!repairRetestMatchesAnchor(point.repairRetest, anchor)) return false;
    const completedMs = Date.parse(point.completedAt);
    return (
      Number.isFinite(completedMs) &&
      completedMs > anchorMs &&
      isDifferentRetestContext(anchor.topicId, point.topicId) &&
      pointMeasuresDimension(point, dimension)
    );
  }) ?? null;
}

export function repairRetestMatchesAnchor(
  assigned: AssignedRepairRetest | null | undefined,
  anchor: RepairRetestAnchor,
): boolean {
  if (!assigned) return false;
  if (assigned.repairResultId && anchor.repairResultId) {
    return assigned.repairResultId === anchor.repairResultId;
  }
  return (
    assigned.repairDebateId === anchor.debateId &&
    assigned.targetKind === anchor.targetKind &&
    assigned.attemptedAt === anchor.attemptedAt
  );
}

/**
 * Return every successful repair that still needs a genuine later transfer
 * test, oldest first. The UI can still surface one focus at a time while the
 * unresolved queue remains intact instead of being replaced by the newest
 * repair.
 */
export function pendingRepairRetests(
  points: SkillMetricPoint[],
  anchors: RepairRetestAnchor[],
  nowMs: number = Date.now(),
): PendingRepairRetest[] {
  return anchors
    .map((anchor) => pendingRepairRetest(points, anchor, nowMs))
    .filter((value): value is PendingRepairRetest => value !== null)
    .sort((a, b) => Date.parse(a.attemptedAt) - Date.parse(b.attemptedAt));
}

export function selectEligiblePendingRetest(
  points: SkillMetricPoint[],
  anchors: RepairRetestAnchor[],
  currentTopicId: string | null | undefined,
  nowMs: number = Date.now(),
): PendingRepairRetest | null {
  return (
    pendingRepairRetests(points, anchors, nowMs).find((anchor) =>
      isDifferentRetestContext(anchor.topicId, currentTopicId),
    ) ?? null
  );
}

export interface CompletedRetestVerdict {
  targetKind: RepairKind;
  completedAt: string;
  observable: boolean | null;
  demonstrated: boolean | null;
}

/**
 * Skills whose most recent observable retest verdict is "did not demonstrate".
 * A later demonstrated verdict on the same skill clears it; verdicts without a
 * definite true/false (no valid opportunity, unscored) never count either way.
 * One failed retest is a single unvalidated reading, so this only STEERS
 * coaching toward a re-repair; it is never shown as a score.
 */
export function failedRetestDimensions(verdicts: CompletedRetestVerdict[]): CoachDimension[] {
  const latest = new Map<CoachDimension, { at: number; demonstrated: boolean }>();
  for (const v of verdicts) {
    if (v.observable !== true || v.demonstrated === null) continue;
    const dimension = repairKindToDimension(v.targetKind);
    const at = Date.parse(v.completedAt);
    if (!dimension || Number.isNaN(at)) continue;
    const current = latest.get(dimension);
    if (!current || at > current.at) latest.set(dimension, { at, demonstrated: v.demonstrated });
  }
  return [...latest.entries()].filter(([, v]) => !v.demonstrated).map(([d]) => d);
}
