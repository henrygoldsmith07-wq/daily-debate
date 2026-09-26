import "server-only";

import { buildLedgerForUser, type LedgerWithSeries } from "./skillLedgerServer";
import { successfulRepairRetestAnchors } from "./repairRetestServer";
import {
  pendingRepairRetests,
  selectEligiblePendingRetest,
  type PendingRepairRetest,
  type RepairRetestAnchor,
} from "./repairRetest";
import { latestDrillOutcomes } from "./adaptiveCoachServer";
import type { CoachDimension } from "./adaptiveCoach";
import type { CoachingContextDegradationReason } from "./types";

export type CoachingContextStatus = "ok" | "partial" | "unavailable";

export interface CoachingContext {
  status: CoachingContextStatus;
  degradationReasons: CoachingContextDegradationReason[];
  ledger: LedgerWithSeries | null;
  repairAnchors: RepairRetestAnchor[];
  pendingRetests: PendingRepairRetest[];
  selectedRetest: PendingRepairRetest | null;
  drillOutcomes: Partial<Record<CoachDimension, number>>;
}

/**
 * Canonical best-effort loader for coaching surfaces. Ledger failure makes the
 * coaching context unavailable; repair/drill failures make it partial. The
 * caller decides whether to degrade the UI or reject the request.
 */
export async function loadCoachingContext(
  userId: string,
  opts: { currentTopicId?: string | null } = {},
): Promise<CoachingContext> {
  const degradationReasons: CoachingContextDegradationReason[] = [];
  const [ledgerResult, repairResult] = await Promise.allSettled([
    buildLedgerForUser(userId),
    successfulRepairRetestAnchors(userId),
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
      selectedRetest: null,
      drillOutcomes: {},
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

  const pendingRetests = repairResult.status === "fulfilled"
    ? pendingRepairRetests(ledger.points, repairAnchors)
    : [];
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
    selectedRetest,
    drillOutcomes,
  };
}
