// Repair -> retest chain per weakness for one learner. Pure. Observational:
// no causal claim. A retest that is still pending (or completed but not
// observable) never reveals an outcome, and recurrence is not measured here,
// so it is always labelled insufficient_evidence until a gate exists.

export type ChainKind = "evidence" | "rebuttal" | "logic" | "impact" | "structure" | "clarity";
export interface ChainRepair { id: string; targetKind: ChainKind; createdAt: string; succeeded: boolean }
export interface ChainRetest {
  repairResultId: string;
  assignedAt: string;
  completedAt: string | null;
  observable: boolean | null;
  demonstrated: boolean | null;
}
export type ChainStage =
  | "repair_not_landed"
  | "retest_pending"
  | "retest_not_observable"
  | "retest_demonstrated"
  | "retest_not_demonstrated";

export interface ChainEntry {
  repairId: string;
  targetKind: ChainKind;
  repairedAt: string;
  stage: ChainStage;
  /** Number of retest assignments (completed or not) for this repair. */
  retestAssignments: number;
  completedAt: string | null;
  recurrence: "insufficient_evidence";
}

export const STAGE_LABEL: Record<ChainStage, string> = {
  repair_not_landed: "Repair attempted, not landed",
  retest_pending: "Retest waiting",
  retest_not_observable: "Retest had no chance to show the skill",
  retest_demonstrated: "Skill showed up in the retest",
  retest_not_demonstrated: "Skill did not show up in the retest",
};

function ts(iso: string | null): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : NaN;
}

export function buildLoopChain(repairs: ChainRepair[], retests: ChainRetest[], limit = 20): ChainEntry[] {
  const byRepair = new Map<string, ChainRetest[]>();
  for (const r of retests) byRepair.set(r.repairResultId, [...(byRepair.get(r.repairResultId) ?? []), r]);
  const entries: ChainEntry[] = [];
  for (const rep of repairs) {
    if (!Number.isFinite(ts(rep.createdAt))) continue;
    const rts = byRepair.get(rep.id) ?? [];
    // The latest completed observable retest decides; otherwise the latest completion.
    const completed = rts
      .filter((r) => r.completedAt && Number.isFinite(ts(r.completedAt)))
      .sort((a, b) => ts(b.completedAt) - ts(a.completedAt));
    const decisive = completed.find((r) => r.observable === true) ?? completed[0] ?? null;
    let stage: ChainStage;
    if (!rep.succeeded) stage = "repair_not_landed";
    else if (decisive?.observable === true) stage = decisive.demonstrated === true ? "retest_demonstrated" : "retest_not_demonstrated";
    else if (decisive) stage = "retest_not_observable";
    else stage = "retest_pending";
    entries.push({
      repairId: rep.id,
      targetKind: rep.targetKind,
      repairedAt: rep.createdAt,
      stage,
      retestAssignments: rts.length,
      completedAt: decisive?.completedAt ?? null,
      recurrence: "insufficient_evidence",
    });
  }
  return entries.sort((a, b) => ts(b.repairedAt) - ts(a.repairedAt)).slice(0, limit);
}
