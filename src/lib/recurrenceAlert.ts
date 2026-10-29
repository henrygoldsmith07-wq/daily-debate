// M15 slice 1: did a weakness the learner repaired come back in a later debate?
// Observational only (unvalidated): one reappearance is labelled
// insufficient_evidence, never a rate or a claim that the repair failed.
import type { ChainEntry, ChainKind } from "./loopChain";

export interface RecurrenceAlert {
  kind: ChainKind;
  repairedAt: string;
  evidence: "came_back" | "insufficient_evidence";
}

/**
 * `newWeaknessKind` is the weakness found in the debate just finished. Returns
 * an alert when the learner previously repaired that kind (repair succeeded)
 * before this debate. Needs 2 prior repairs of the kind to say "came_back".
 */
export function detectRecurrence(chain: ChainEntry[], newWeaknessKind: ChainKind | null, debateAt: string): RecurrenceAlert | null {
  if (!newWeaknessKind) return null;
  const at = Date.parse(debateAt);
  if (!Number.isFinite(at)) return null;
  const prior = chain
    .filter((e) => e.targetKind === newWeaknessKind && e.stage !== "repair_not_landed" && Date.parse(e.repairedAt) < at)
    .sort((a, b) => Date.parse(b.repairedAt) - Date.parse(a.repairedAt));
  if (prior.length === 0) return null;
  return { kind: newWeaknessKind, repairedAt: prior[0].repairedAt, evidence: prior.length >= 2 ? "came_back" : "insufficient_evidence" };
}
