// Heuristic argument-graph enrichers: repetition, rebuttal-address, fallacy hints.
// Pure functions so they are testable offline. Intended to complement (not replace) the judge.
import type { ArgGraph, ArgNode } from "./argGraph";

function norm(s: string) { return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g," ").trim(); }
function jaccard(a: string, b: string): number {
  const sa = new Set(norm(a).split(" ").filter(Boolean));
  const sb = new Set(norm(b).split(" ").filter(Boolean));
  if (!sa.size || !sb.size) return 0;
  let inter=0; for (const w of sa) if (sb.has(w)) inter++;
  return inter / (sa.size + sb.size - inter);
}

export function detectRepetition(nodes: ArgNode[], threshold=0.72): Array<{ a: string; b: string; score: number }> {
  const out: Array<{ a: string; b: string; score: number }> = [];
  const byOwner = new Map<string, ArgNode[]>();
  for (const n of nodes) {
    if (n.kind==="claim" || n.kind==="evidence") {
      const arr = byOwner.get(n.owner) ?? []; arr.push(n); byOwner.set(n.owner, arr);
    }
  }
  for (const arr of byOwner.values()) {
    for (let i=0;i<arr.length;i++) for (let j=i+1;j<arr.length;j++) {
      const s = jaccard(arr[i].text, arr[j].text);
      if (s>=threshold) out.push({ a: arr[i].id, b: arr[j].id, score: s });
    }
  }
  return out;
}

export function rebuttalAddressesTargets(graph: ArgGraph): Array<{ rebuttalId: string; covered: boolean }> {
  const targetSet = new Set(graph.nodes.filter((n)=> n.kind==="rebuttal").flatMap((n)=> n.targets ?? []));
  // For each rebuttal, check at least one of its targets exists as a node
  return graph.nodes.filter((n)=> n.kind==="rebuttal").map((n)=> ({
    rebuttalId: n.id, covered: (n.targets ?? []).some((t)=> targetSet.has(t) || graph.nodes.some((x)=> x.id===t))
  }));
}

export function rebuttalCoverage(graph: ArgGraph): number {
  const reb = graph.nodes.filter((n)=> n.kind==="rebuttal");
  if (!reb.length) return 1;
  const ok = rebuttalAddressesTargets(graph).filter((r)=> r.covered).length;
  return ok / reb.length;
}

// Quick fallacy lexicon hint — not a replacement for the model, just an auditable signal
const FALLACY_HINTS: Array<{ fallacy: ArgNode["fallacy"]; re: RegExp }> = [
  { fallacy: "ad_hominem", re: /\b(you are|you\'re|your kind|people like you)\b/i },
  { fallacy: "appeal_to_emotion", re: /\b(think of the children|disgusting|outrage|horrifying)\b/i },
  { fallacy: "false_dilemma", re: /\b(either|only two options|no alternative)\b/i },
  { fallacy: "slippery_slope", re: /\b(slip.*slope|inevitably leads to|domino)\b/i },
  { fallacy: "whataboutism", re: /\b(what about|but what)\b/i },
];
export function fallacyHints(text: string): Array<{ fallacy: string; match: string }> {
  const out: Array<{ fallacy: string; match: string }> = [];
  for (const { fallacy, re } of FALLACY_HINTS) { const m = text.match(re); if (m?.[0]) out.push({ fallacy: fallacy as string, match: m[0] as string }); }
  return out;
}
