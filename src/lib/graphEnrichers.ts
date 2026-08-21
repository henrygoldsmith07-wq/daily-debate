// Graph enrichers: evaluated fallacy classifier + structural detectors for
// dropped arguments, concessions, contradictions, burden shifts, and argument
// evolution across rounds. All pure, testable offline.

import type { ArgGraph, ArgNode, Fallacy, DroppedArgument, Concession, Contradiction } from "./argGraph";

// ---------------------------------------------------------------------------
// Fallacy classifier (lexicon → scored classifier, auditable)
// We keep a transparent rule-based classifier that is cheap, debuggable, and
// evaluated against a labeled mini-corpus in fallacyBenchmark.ts (precision/
// recall/F1, surfaced on the benchmark page). A future model-backed classifier
// can sit behind the same interface.
// ---------------------------------------------------------------------------

type FallacyLabel = Exclude<Fallacy, "none">;

interface FallacyRule {
  label: FallacyLabel;
  patterns: RegExp[];
  negations?: RegExp[]; // if any matches, suppress this rule (reduce FP)
}

const RULES: FallacyRule[] = [
  { label: "ad_hominem", patterns: [/\b(you are|you'?re) (a )?(liar|fraud|idiot|shill|biased|corrupt)\b/i, /\bpeople like you\b/i, /\battack (him|her|them|the person) instead of\b/i] },
  { label: "strawman", patterns: [/\bso you('re)? saying\b/i, /\byou claim .* but .* actually\b/i], negations: [/\bI said\b/i] },
  { label: "false_dilemma", patterns: [/\b(either .* or .*|only two options|no alternative|must choose between)\b/i] },
  { label: "slippery_slope", patterns: [/\b(slippery slope|inevitably leads to|domino|thin end of the wedge)\b/i] },
  { label: "appeal_to_emotion", patterns: [/\b(think of the children|disgusting|outrage|horrifying|terrifying|heartbreaking)\b/i] },
  { label: "hasty_generalization", patterns: [/\b(all .* are|every .* is|always|never) (?:they|people|studies)\b/i] },
  { label: "appeal_to_authority", patterns: [/\b(as .* said|according to .* expert|famous .* said)\b/i], negations: [/\bLazard|NREL|Pew|Nature|Reuters|NIST|Stanford HAI\b/i] },
  { label: "whataboutism", patterns: [/\b(what about|but what about|whatabout)\b/i] },
  { label: "begging_the_question", patterns: [/\b(because .* therefore .* same|assumes what it (needs to )?prove)\b/i] },
  { label: "equivocation", patterns: [/\b(by .* I mean .* and also .*)\b/i] },
];

export interface FallacyHit {
  fallacy: FallacyLabel;
  score: number; // 0..1
  matched: string;
}

export function classifyFallacies(text: string): FallacyHit[] {
  const hits: FallacyHit[] = [];
  for (const rule of RULES) {
    let best: string | null = null;
    for (const re of rule.patterns) {
      const m = text.match(re);
      if (m?.[0]) { best = m[0]; break; }
    }
    if (!best) continue;
    if (rule.negations?.some((re) => re.test(text))) continue;
    // Score by pattern specificity (shorter = less specific)
    const score = Math.min(1, 0.55 + best.length / 80);
    hits.push({ fallacy: rule.label, score, matched: best });
  }
  // Deduplicate by label (keep highest score)
  const byLabel = new Map<FallacyLabel, FallacyHit>();
  for (const h of hits) {
    const prev = byLabel.get(h.fallacy);
    if (!prev || h.score > prev.score) byLabel.set(h.fallacy, h);
  }
  return [...byLabel.values()].sort((a, b) => b.score - a.score);
}

export function topFallacy(text: string, threshold = 0.6): Fallacy {
  const hits = classifyFallacies(text);
  const best = hits[0];
  if (!best || best.score < threshold) return "none";
  return best.fallacy;
}

// ---------------------------------------------------------------------------
// Dropped / concession / contradiction / burden detectors
// ---------------------------------------------------------------------------

export function detectDropped(graph: ArgGraph): DroppedArgument[] {
  // A node is "dropped" if it was introduced by one side and never rebutted/countered
  // by the opponent in a later round. We infer from edges: any claim/counterclaim/evidence
  // whose id is never a target of a `rebuts`/`counters` edge from the other side and is
  // not the most recent round.
  const maxRound = Math.max(0, ...graph.nodes.map((n) => n.round));
  const rebuttedIds = new Set(graph.edges.filter((e) => e.relation === "rebuts" || e.relation === "counters").map((e) => e.to));
  // Also, rebuttal.targets counts as rebutted
  for (const n of graph.nodes) if (n.kind === "rebuttal") for (const t of n.targets ?? []) rebuttedIds.add(t);
  const out: DroppedArgument[] = [];
  for (const n of graph.nodes) {
    if (!["claim", "evidence", "counterclaim", "impact"].includes(n.kind)) continue;
    if (n.round >= maxRound) continue; // last round can't be dropped yet
    if (rebuttedIds.has(n.id)) continue;
    // Only flag if opponent had at least one later turn and didn't engage
    const hadLaterOpponentTurn = graph.nodes.some((m) => m.owner !== n.owner && m.round > n.round);
    if (!hadLaterOpponentTurn) continue;
    out.push({ nodeId: n.id, text: n.text, owner: n.owner, round: n.round });
  }
  return out;
}

const CONCESSION_RE = /\b(I concede|you'?re right (that|about)|fair point|I agree that|granted,)\b/i;
export function detectConcessions(nodes: ArgNode[]): Concession[] {
  const out: Concession[] = [];
  for (const n of nodes) {
    if (CONCESSION_RE.test(n.text)) out.push({ nodeId: n.id, by: n.owner, note: `Concession language: "${n.text.match(CONCESSION_RE)?.[0]}"` });
  }
  return out;
}

function contradicts(a: string, b: string): boolean {
  // Heuristic: same owner, one affirms and one denies the same predicate.
  // We look for direct negation pairs rather than semantic NLI (future: model).
  const neg = (s: string) => s.toLowerCase().includes(" not ") || s.toLowerCase().startsWith("not ") || /\b(no|never|isn't|aren't|is not|are not)\b/i.test(s);
  const aNeg = neg(a), bNeg = neg(b);
  if (aNeg === bNeg) return false;
  // Also require lexical overlap > 0.4 to avoid flagging unrelated negations
  const wa = new Set(a.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3));
  const wb = new Set(b.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3));
  if (!wa.size || !wb.size) return false;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  const j = inter / (wa.size + wb.size - inter);
  return j > 0.35;
}

export function detectContradictions(nodes: ArgNode[]): Contradiction[] {
  const out: Contradiction[] = [];
  const byOwner = new Map<string, ArgNode[]>();
  for (const n of nodes) {
    const arr = byOwner.get(n.owner) ?? [];
    arr.push(n);
    byOwner.set(n.owner, arr);
  }
  for (const [owner, arr] of byOwner) {
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      if (contradicts(arr[i].text, arr[j].text)) {
        out.push({ a: arr[i].id, b: arr[j].id, explanation: `Self-contradiction: "${arr[i].text.slice(0, 50)}" vs "${arr[j].text.slice(0, 50)}"`, owner: owner as ArgNode["owner"] });
      }
    }
  }
  return out;
}

export type BurdenShift = { round: number; by: ArgNode["owner"]; note: string };
const BURDEN_RE = /\b(prove that|burden (is|lies) on you|you (must|need to) prove|onus is on)\b/i;
export function detectBurdenShifts(nodes: ArgNode[]): BurdenShift[] {
  return nodes.filter((n) => BURDEN_RE.test(n.text)).map((n) => ({ round: n.round, by: n.owner, note: `Burden shift: "${n.text.match(BURDEN_RE)?.[0]}"` }));
}

// Rhetorical role of a rebuttal: does it rebut, counter-argue, or introduce a new argument?
export type RebuttalRole = "rebuttal" | "counterargument" | "new_argument";
export function classifyRebuttalRole(node: ArgNode, graph: ArgGraph): RebuttalRole {
  if (node.kind !== "rebuttal") return "new_argument";
  if ((node.targets?.length ?? 0) > 0) {
    // Has explicit targets -> true rebuttal
    const allTargetsExist = (node.targets ?? []).every((t) => graph.nodes.some((n) => n.id === t));
    if (allTargetsExist) return "rebuttal";
    return "counterargument";
  }
  return "new_argument";
}

// Argument evolution: for nodes sharing a claim lineage (same topic phrase), track how the claim was refined
export interface EvolutionStep { round: number; nodeId: string; text: string; owner: ArgNode["owner"]; kind: ArgNode["kind"]; }
export function argumentEvolution(graph: ArgGraph, claimId: string): EvolutionStep[] {
  // Follow supports/rebuts/counters edges from the claim
  const visited = new Set<string>([claimId]);
  const queue = [claimId];
  const steps: EvolutionStep[] = [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const start = byId.get(claimId);
  if (start) steps.push({ round: start.round, nodeId: start.id, text: start.text, owner: start.owner, kind: start.kind });
  while (queue.length) {
    const cur = queue.shift()!;
    for (const e of graph.edges) {
      const next = e.from === cur ? e.to : e.to === cur ? e.from : null;
      if (!next || visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
      const n = byId.get(next);
      if (n) steps.push({ round: n.round, nodeId: n.id, text: n.text, owner: n.owner, kind: n.kind });
    }
  }
  return steps.sort((a, b) => a.round - b.round);
}

// ---------------------------------------------------------------------------
// Auditable + editable graph helpers
// ---------------------------------------------------------------------------

export type GraphEdit =
  | { op: "addNode"; node: ArgNode }
  | { op: "removeNode"; nodeId: string }
  | { op: "patchNode"; nodeId: string; patch: Partial<ArgNode> }
  | { op: "addEdge"; edge: import("./argGraph").ArgEdge }
  | { op: "removeEdge"; from: string; to: string };

export function applyGraphEdits(graph: ArgGraph, edits: GraphEdit[]): { graph: ArgGraph; audit: string[] } {
  let g: ArgGraph = {
    ...graph,
    nodes: [...graph.nodes],
    edges: [...graph.edges],
    dropped: [...graph.dropped],
    contradictions: [...graph.contradictions],
    concessions: [...graph.concessions],
    fallacies: [...graph.fallacies],
    evidenceStats: { ...graph.evidenceStats, byOwner: { ...graph.evidenceStats.byOwner }, byStrength: { ...graph.evidenceStats.byStrength }, unsupportedClaimIds: [...graph.evidenceStats.unsupportedClaimIds] },
    impactComparison: graph.impactComparison ? { ...graph.impactComparison } : null,
  };
  const audit: string[] = [];
  for (const e of edits) {
    if (e.op === "addNode") {
      g.nodes.push(e.node);
      audit.push(`add ${e.node.id} (${e.node.kind})`);
    } else if (e.op === "removeNode") {
      g.nodes = g.nodes.filter((n) => n.id !== e.nodeId);
      g.edges = g.edges.filter((ed) => ed.from !== e.nodeId && ed.to !== e.nodeId);
      audit.push(`remove ${e.nodeId}`);
    } else if (e.op === "patchNode") {
      g.nodes = g.nodes.map((n) => (n.id === e.nodeId ? { ...n, ...e.patch } : n));
      audit.push(`patch ${e.nodeId}: ${Object.keys(e.patch).join(",")}`);
    } else if (e.op === "addEdge") {
      g.edges.push(e.edge);
      audit.push(`edge ${e.edge.from} —${e.edge.relation}→ ${e.edge.to}`);
    } else if (e.op === "removeEdge") {
      g.edges = g.edges.filter((ed) => !(ed.from === e.from && ed.to === e.to));
      audit.push(`remove edge ${e.from}→${e.to}`);
    }
  }
  return { graph: g, audit };
}
