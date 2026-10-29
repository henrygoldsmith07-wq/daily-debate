// Weakness library (M10): groups the repair->retest chain by skill so History
// can show every evidenced weakness per skill. Pure and observational: no
// causal claim, no rates (counts only), recurrence stays insufficient_evidence.
import type { ChainEntry, ChainKind, ChainStage } from "./loopChain";

export interface WeaknessGroup {
  kind: ChainKind;
  total: number;
  byStage: Record<ChainStage, number>;
  latest: ChainEntry;
  /** Newest first. */
  entries: ChainEntry[];
  /** A re-drill is offered only for skills whose latest retest did not show the skill or is not landed. */
  redrillSuggested: boolean;
}

const STAGES: ChainStage[] = ["repair_not_landed", "retest_pending", "retest_not_observable", "retest_demonstrated", "retest_not_demonstrated"];

export function buildWeaknessLibrary(chain: ChainEntry[]): WeaknessGroup[] {
  const groups = new Map<ChainKind, ChainEntry[]>();
  for (const e of chain) groups.set(e.targetKind, [...(groups.get(e.targetKind) ?? []), e]);
  const out: WeaknessGroup[] = [];
  for (const [kind, list] of groups) {
    const entries = [...list].sort((a, b) => Date.parse(b.repairedAt) - Date.parse(a.repairedAt));
    const byStage = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<ChainStage, number>;
    for (const e of entries) byStage[e.stage] += 1;
    const latest = entries[0];
    out.push({
      kind,
      total: entries.length,
      byStage,
      latest,
      entries,
      redrillSuggested: latest.stage === "retest_not_demonstrated" || latest.stage === "repair_not_landed",
    });
  }
  return out.sort((a, b) => Date.parse(b.latest.repairedAt) - Date.parse(a.latest.repairedAt));
}
