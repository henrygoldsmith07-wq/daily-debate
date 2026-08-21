// Personal weakness history + adaptive drills + outcome tracking.
// Extends drills.ts (per-graph) to a cross-graph profile that remembers
// recurring weaknesses and measures whether drills improve future debating.

import type { ArgGraph } from "./argGraph";

export type WeaknessKind = "evidence" | "rebuttal" | "logic" | "clarity" | "impact" | "dropped" | "concession" | "contradiction";

export interface WeaknessSnapshot {
  at: string; // ISO
  graphId?: string;
  counts: Record<WeaknessKind, number>;
}

export interface WeaknessHistory {
  snapshots: WeaknessSnapshot[];
}

export function snapshotFromGraph(graph: ArgGraph, opts?: { graphId?: string; at?: string }): WeaknessSnapshot {
  const counts: Record<WeaknessKind, number> = {
    evidence: graph.evidenceStats.unsupportedClaimIds.length,
    rebuttal: 0, // derived elsewhere via coverage; treat dropped as rebuttal weakness
    logic: graph.fallacies.length,
    clarity: 0,
    impact: graph.impactComparison ? 0 : 1,
    dropped: graph.dropped.length,
    concession: graph.concessions.length,
    contradiction: graph.contradictions.length,
  };
  // Rebuttal proxy: dropped arguments imply missed rebuttals
  counts.rebuttal = counts.dropped > 0 ? 1 : 0;
  return { at: opts?.at ?? new Date().toISOString(), graphId: opts?.graphId, counts };
}

export function appendSnapshot(history: WeaknessHistory, snap: WeaknessSnapshot, maxKeep = 50): WeaknessHistory {
  const next = [...history.snapshots, snap];
  if (next.length > maxKeep) next.splice(0, next.length - maxKeep);
  return { snapshots: next };
}

export type Aggregate = Record<WeaknessKind, { rate: number; streak: number }>;

export function aggregateWeaknesses(history: WeaknessHistory, window = 10): Aggregate {
  const recent = history.snapshots.slice(-window);
  const n = Math.max(1, recent.length);
  const kinds: WeaknessKind[] = ["evidence", "rebuttal", "logic", "clarity", "impact", "dropped", "concession", "contradiction"];
  const out = {} as Aggregate;
  for (const k of kinds) {
    const hits = recent.filter((s) => (s.counts[k] ?? 0) > 0).length;
    // Streak = consecutive recent snapshots with this weakness
    let streak = 0;
    for (let i = recent.length - 1; i >= 0; i--) {
      if ((recent[i].counts[k] ?? 0) > 0) streak++;
      else break;
    }
    out[k] = { rate: hits / n, streak };
  }
  return out;
}

export function topWeaknesses(agg: Aggregate, k = 3): WeaknessKind[] {
  const entries = Object.entries(agg) as Array<[WeaknessKind, { rate: number; streak: number }]>;
  // Prioritize by streak then rate
  entries.sort((a, b) => b[1].streak - a[1].streak || b[1].rate - a[1].rate);
  return entries.filter(([, v]) => v.rate > 0).slice(0, k).map(([kind]) => kind);
}

export interface DrillWithOutcome {
  id: string;
  focus: WeaknessKind;
  title: string;
  prompt: string;
  assignedAt: string;
  completedAt?: string;
  // Outcome: did the weakness rate drop in the next N graphs after assignment?
  outcome?: { windowBefore: number; windowAfter: number; delta: number; improved: boolean };
}

const DRILL_TEMPLATES: Record<WeaknessKind, { title: string; prompt: string }> = {
  evidence: { title: "Ground a claim", prompt: "Pick one unsupported claim from your last debate and add a cited source with a real institution homepage." },
  rebuttal: { title: "Close a dropped thread", prompt: "An opponent argument went unanswered — write the rebuttal you would have added, targeting the exact claim." },
  logic: { title: "Fix the fallacy", prompt: "Rewrite the flagged move without the fallacy, keeping the same conclusion." },
  clarity: { title: "Tighten your wording", prompt: "Rewrite your longest turn in half the words without losing the claim." },
  impact: { title: "Weigh the impacts", prompt: "Compare which outcome matters more and why — one sentence with a framed impact." },
  dropped: { title: "Recover a dropped argument", prompt: "Find a dropped argument and write a 2-sentence rebuttal that would have kept it alive." },
  concession: { title: "Handle a concession", prompt: "You conceded a point — write how you'd use that concession to strengthen your next move." },
  contradiction: { title: "Resolve a contradiction", prompt: "Two of your claims contradicted — rewrite one so both can be true together." },
};

export function drillsForWeaknesses(weaknesses: WeaknessKind[], nowIso = new Date().toISOString()): DrillWithOutcome[] {
  return weaknesses.map((w) => ({
    id: `drill-${w}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    focus: w,
    title: DRILL_TEMPLATES[w].title,
    prompt: DRILL_TEMPLATES[w].prompt,
    assignedAt: nowIso,
  }));
}

/** Measure whether drilling a weakness improved future graphs. Call with before/after snapshots. */
export function measureDrillOutcome(
  history: WeaknessHistory,
  drill: Pick<DrillWithOutcome, "focus" | "assignedAt">,
  windowSize = 5,
): { windowBefore: number; windowAfter: number; delta: number; improved: boolean } | undefined {
  const idx = history.snapshots.findIndex((s) => s.at >= drill.assignedAt);
  if (idx === -1) return undefined;
  const before = history.snapshots.slice(Math.max(0, idx - windowSize), idx);
  const after = history.snapshots.slice(idx + 1, idx + 1 + windowSize);
  if (!before.length || !after.length) return undefined;
  const rate = (arr: WeaknessSnapshot[], k: WeaknessKind) => arr.filter((s) => (s.counts[k] ?? 0) > 0).length / arr.length;
  const wb = rate(before, drill.focus);
  const wa = rate(after, drill.focus);
  const delta = wa - wb; // negative => improvement
  return { windowBefore: wb, windowAfter: wa, delta, improved: delta < 0 };
}
