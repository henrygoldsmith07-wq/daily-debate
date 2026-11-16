import "server-only";

import { buildLedgerForUser, type LedgerWithSeries } from "./skillLedgerServer";
import {
  completeRepairRetestAssignment,
  unresolvedRepairRetestAnchors,
} from "./repairRetestServer";
import {
  observedRepairRetestPoint,
  pendingRepairRetests,
  lapsedRepairRetests,
  selectEligiblePendingRetest,
  type PendingRepairRetest,
  type RepairRetestAnchor,
} from "./repairRetest";
import { failedRetestVerdictsForUser } from "./repairRetestServer";
import { failedRetestDimensions, repairedRetestDimensions } from "./repairRetest";
import { latestDrillOutcomes } from "./adaptiveCoachServer";
import { loadLoopChain } from "./loopChainServer";
import { recurringKinds } from "./recurrenceAlert";
import type { CoachDimension } from "./adaptiveCoach";
import type { CoachingContextDegradationReason } from "./types";

export type CoachingContextStatus = "ok" | "partial" | "unavailable";

export interface CoachingContext {
  status: CoachingContextStatus;
  degradationReasons: CoachingContextDegradationReason[];
  ledger: LedgerWithSeries | null;
  repairAnchors: RepairRetestAnchor[];
  pendingRetests: PendingRepairRetest[];
  /** Retests closed untested (expired, no opportunity); shown once as a notice. */
  lapsedRetests: PendingRepairRetest[];
  selectedRetest: PendingRepairRetest | null;
  drillOutcomes: Partial<Record<CoachDimension, number>>;
  /** Skills whose latest observable retest did not demonstrate the repair. */
  reRepairDimensions: CoachDimension[];
  /** Skills whose latest observable retest showed the repair (unvalidated, single retest). */
  repairedDimensions: CoachDimension[];
}

/**
 * Canonical best-effort loader for coaching surfaces. Ledger failure makes the
 * coaching context unavailable; repair/drill failures make it partial. The
 * caller decides whether to degrade the UI or reject the request.
 */
export async function loadCoachingContext(
  userId: string,
  opts: { currentTopicId?: string | null; reconcileLegacyRetests?: boolean } = {},
): Promise<CoachingContext> {
  const degradationReasons: CoachingContextDegradationReason[] = [];
  const [ledgerResult, repairResult] = await Promise.allSettled([
    buildLedgerForUser(userId),
    unresolvedRepairRetestAnchors(userId),
  ]);

  if (ledgerResult.status === "rejected") {
    degradationReasons.push("skill-ledger-unavailable");
    if (repairResult.status === "rejected") degradationReasons.push("repair-retest-unavailable");
    return {
      status: "unavailable",
      degradationReasons,
      ledger: null,
      repairAnchors: repairResult.status === "fulfilled" ? repairResult.value : [],
      pendingRetests: [],
      lapsedRetests: [],
      selectedRetest: null,
      drillOutcomes: {},
      reRepairDimensions: [],
      repairedDimensions: [],
    };
  }

  const ledger = ledgerResult.value;
  const repairAnchors = repairResult.status === "fulfilled" ? repairResult.value : [];
  if (repairResult.status === "rejected") degradationReasons.push("repair-retest-unavailable");

  let drillOutcomes: Partial<Record<CoachDimension, number>> = {};
  try {
    drillOutcomes = await latestDrillOutcomes(userId, ledger.points);
  } catch {
    degradationReasons.push("drill-outcomes-unavailable");
  }

  let reRepairDimensions: CoachDimension[] = [];
  let repairedDimensions: CoachDimension[] = [];
  try {
    const verdicts = await failedRetestVerdictsForUser(userId);
    reRepairDimensions = failedRetestDimensions(verdicts, { repairAnchors });
    repairedDimensions = repairedRetestDimensions(verdicts);
  } catch {
    // Steering is advisory; ledger ordering still works without it.
  }

  // M15: a skill repaired 3+ times keeps coming back; steer focus to it (unvalidated).
  try {
    const recurring = recurringKinds(await loadLoopChain(userId)) as CoachDimension[];
    reRepairDimensions = [...new Set([...reRepairDimensions, ...recurring])];
  } catch {
    // advisory only
  }

  const pendingRetests = repairResult.status === "fulfilled"
    ? pendingRepairRetests(ledger.points, repairAnchors)
    : [];

  // Migration 025 backfills historical assignments from debate coaching. Some
  // older completed retests may lack a durable observable value. Reads remain
  // side-effect free: only an explicit mutating caller (currently solo Start)
  // opts into one-time reconciliation while the old debate is still in the
  // bounded ledger window.
  if (repairResult.status === "fulfilled" && opts.reconcileLegacyRetests === true) {
    const reconciliationWrites = [];
    for (const anchor of repairAnchors) {
      const observed = observedRepairRetestPoint(ledger.points, anchor);
      if (!observed) continue;
      reconciliationWrites.push(
        completeRepairRetestAssignment({
          userId,
          repairResultId: anchor.repairResultId,
          assignedDebateId: observed.debateId,
          completedAt: observed.completedAt,
          observable: true,
          demonstrated: null,
        }),
      );
    }
    const reconciliationResults = await Promise.all(reconciliationWrites);
    if (
      reconciliationResults.some((result) => !result.ok) &&
      !degradationReasons.includes("repair-retest-unavailable")
    ) {
      degradationReasons.push("repair-retest-unavailable");
    }
  }
  const selectedRetest =
    opts.currentTopicId === undefined
      ? pendingRetests[0] ?? null
      : selectEligiblePendingRetest(ledger.points, repairAnchors, opts.currentTopicId);

  return {
    status: degradationReasons.length ? "partial" : "ok",
    degradationReasons,
    ledger,
    repairAnchors,
    pendingRetests,
    lapsedRetests: repairResult.status === "fulfilled" ? lapsedRepairRetests(ledger.points, repairAnchors) : [],
    selectedRetest,
    drillOutcomes,
    reRepairDimensions,
    repairedDimensions,
  };
}
