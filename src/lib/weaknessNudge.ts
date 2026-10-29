// M13: Today's weakness-aware nudge. Picks the skill with the most unresolved
// evidence (repairs that did not land, retests that did not show the skill).
// Counts only; one observation is labelled insufficient_evidence, never a rate.
import type { ChainEntry, ChainKind } from "./loopChain";
import { buildWeaknessLibrary } from "./weaknessLibrary";

export const NUDGE_MIN_OBSERVATIONS = 2;

export interface WeaknessNudge {
  kind: ChainKind;
  unresolved: number;
  /** "insufficient_evidence" below NUDGE_MIN_OBSERVATIONS unresolved observations. */
  evidence: "repeated" | "insufficient_evidence";
}

const UNRESOLVED = new Set(["repair_not_landed", "retest_not_demonstrated"]);

export function pickWeaknessNudge(chain: ChainEntry[]): WeaknessNudge | null {
  const best = buildWeaknessLibrary(chain)
    // A skill whose latest decided outcome is a pass is no longer the open weakness.
    .filter((g) => g.redrillSuggested)
    .map((g) => ({ kind: g.kind, unresolved: g.entries.filter((e) => UNRESOLVED.has(e.stage)).length, at: Date.parse(g.latest.repairedAt) }))
    .sort((a, b) => b.unresolved - a.unresolved || b.at - a.at)[0];
  if (!best) return null;
  return {
    kind: best.kind,
    unresolved: best.unresolved,
    evidence: best.unresolved >= NUDGE_MIN_OBSERVATIONS ? "repeated" : "insufficient_evidence",
  };
}

export function nudgeCopy(n: WeaknessNudge): { title: string; detail: string } {
  return n.evidence === "repeated"
    ? {
        title: `Your open weakness: ${n.kind}`,
        detail: `${n.unresolved} of your repairs or retests on ${n.kind} have not yet shown the skill. A short drill is the quickest next step (unvalidated label).`,
      }
    : {
        title: `Worth another look: ${n.kind}`,
        detail: `One observation on ${n.kind} so far, which is insufficient evidence to call it a pattern. A short drill will tell us more.`,
      };
}
