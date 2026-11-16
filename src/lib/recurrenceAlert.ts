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

/** Learner-facing wording. Observational and unvalidated: never claims the repair failed. */
export function recurrenceAlertNote(alert: RecurrenceAlert): string {
  if (alert.evidence === "came_back") {
    return `You repaired ${alert.kind} before and it showed up again here. Observed across repeated repairs, not a validated measure.`;
  }
  return `You repaired ${alert.kind} before. It appears again here, but one repeat is not enough evidence to say the repair did not hold.`;
}

export const RECURRENCE_MIN_REPAIRS = 10;
export interface KindRecurrence { kind: ChainKind; repairs: number; repeated: number; share: number | null }

/**
 * Per skill: of landed repairs, how many were followed by another repair of the
 * same skill (a proxy for "came back"). The share shows only at
 * RECURRENCE_MIN_REPAIRS landed repairs; otherwise null (insufficient_evidence).
 */
export function summarizeRecurrenceByKind(chain: ChainEntry[]): KindRecurrence[] {
  const kinds = new Map<ChainKind, number[]>();
  for (const e of chain) {
    if (e.stage === "repair_not_landed") continue;
    const t = Date.parse(e.repairedAt);
    if (!Number.isFinite(t)) continue;
    kinds.set(e.targetKind, [...(kinds.get(e.targetKind) ?? []), t]);
  }
  return [...kinds.entries()].map(([kind, times]) => {
    const sorted = [...times].sort((a, b) => a - b);
    const repeated = Math.max(0, sorted.length - 1);
    return { kind, repairs: sorted.length, repeated, share: sorted.length >= RECURRENCE_MIN_REPAIRS ? repeated / sorted.length : null };
  });
}

/** Skills whose repair has recurred enough (3+ landed repairs) to steer the next focus back to them. */
export const RECURRENCE_STEER_MIN_REPAIRS = 3;
export function recurringKinds(chain: ChainEntry[]): ChainKind[] {
  return summarizeRecurrenceByKind(chain).filter((k) => k.repairs >= RECURRENCE_STEER_MIN_REPAIRS).map((k) => k.kind);
}
