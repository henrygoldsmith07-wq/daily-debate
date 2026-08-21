// Post-debate targeted drills + repeated weakness profiles.
// Pure — driven by the last arg graph and recent history.

export type Drill = { id: string; title: string; prompt: string; focus: "evidence"|"rebuttal"|"logic"|"clarity"|"impact"; };

export function drillsFor(graph: { evidenceStats: { unsupportedClaimIds: string[] }; dropped: unknown[]; fallacies: unknown[]; impactComparison: unknown }): Drill[] {
  const out: Drill[] = [];
  if (graph.evidenceStats.unsupportedClaimIds.length) out.push({ id: "d-evidence", title: "Ground one claim", prompt: "Pick one unsupported claim from the debate and add a cited source for it.", focus: "evidence" });
  if ((graph.dropped as unknown[]).length) out.push({ id: "d-rebuttal", title: "Close a dropped thread", prompt: "An opponent argument went unanswered — write the rebuttal you would add.", focus: "rebuttal" });
  if ((graph.fallacies as unknown[]).length) out.push({ id: "d-logic", title: "Fix the fallacy", prompt: "Rewrite the flagged move without the fallacy.", focus: "logic" });
  if (!graph.impactComparison) out.push({ id: "d-impact", title: "Weigh the impacts", prompt: "Compare which outcome matters more and why — one sentence.", focus: "impact" });
  return out;
}

export interface WeaknessProfile { evidence: number; rebuttal: number; logic: number; clarity: number; }
// Aggregate across recent graphs: count weaknesses per focus
export function weaknessProfile(graphs: Array<{ evidenceStats: { unsupportedClaimIds: string[] }; dropped: unknown[]; fallacies: unknown[] }>): WeaknessProfile {
  const n = Math.max(1, graphs.length);
  let ev=0, rb=0, lg=0;
  for (const g of graphs) { ev += g.evidenceStats.unsupportedClaimIds.length>0 ? 1:0; rb += (g.dropped as unknown[]).length>0 ? 1:0; lg += (g.fallacies as unknown[]).length>0 ? 1:0; }
  return { evidence: ev/n, rebuttal: rb/n, logic: lg/n, clarity: 0 };
}

export function topWeakness(p: WeaknessProfile): Drill["focus"] | null {
  const entries = Object.entries(p) as Array<[Drill["focus"], number]>;
  entries.sort((a,b)=> b[1]-a[1]);
  return entries[0]?.[1] > 0.3 ? entries[0][0] : null;
}
