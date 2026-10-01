// Graph enrichment + evidence-reference primitives.
//
// Two responsibilities live here because both are pure functions over the
// stored argument graph that every downstream stage depends on:
//   1. small numeric/text helpers shared by feature extraction and scoring;
//   2. deterministic enrichment that annotates a raw extracted graph before
//      anything is scored from it.
//
// Enrichment never invents arguments: it recomputes counts from graph
// structure, so a model's numeric annotations are treated as hints rather than
// ground truth.

import { emptyGraph, validateGraph, type ArgEdge, type ArgGraph, type ArgNode, type ArgNodeKind, type EvidenceStrength, type Owner } from "../argGraph";
import { classifyFallacies, detectConcessions, detectContradictions, detectDropped } from "../graphEnrichers";
import { isKnownSource, isRootHomepage, sourceQualityScore } from "../citationVerifier";
import { CONFIDENT_FALLACY_THRESHOLD, type EvidenceRef, type FeatureStatus, type ObservableFeature } from "./types";

const CLAIM_KINDS = new Set<ArgNodeKind>(["claim", "counterclaim"]);

export const STRENGTH_WEIGHT: Record<EvidenceStrength, number> = {
  anecdotal: 0.15,
  general: 0.35,
  cited: 0.75,
  strong: 0.9,
};

const STOPWORDS = new Set(
  [
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have", "in", "is", "it", "of", "on", "or", "that", "the", "their", "this", "to", "with", "you", "your",
    // Common padding used by the verbosity probes. It is not argument evidence.
    "indeed", "unequivocally", "decisive", "beyond", "reasonable", "dispute", "absolutely", "certain", "certainty", "arguably",
  ],
);

export function clamp(value: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, value));
}

export function round(value: number, decimals = 2): number {
  const p = 10 ** decimals;
  return Math.round(value * p) / p;
}

export function nodeRef(node: ArgNode, note?: string): EvidenceRef {
  return { id: node.id, kind: "node", excerpt: node.text.slice(0, 240), round: node.round, note };
}

export function edgeRef(edge: ArgEdge, nodes: Map<string, ArgNode>, note?: string): EvidenceRef {
  const from = nodes.get(edge.from)?.text ?? edge.from;
  const to = nodes.get(edge.to)?.text ?? edge.to;
  return {
    id: `${edge.from}->${edge.to}:${edge.relation}`,
    kind: "edge",
    excerpt: `${from.slice(0, 100)} -${edge.relation}-> ${to.slice(0, 100)}`,
    note,
  };
}

export function derivedRef(id: string, excerpt: string, note?: string): EvidenceRef {
  return { id, kind: "derived", excerpt: excerpt.slice(0, 240), note };
}

export function uniqueRefs(refs: EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    if (seen.has(ref.id)) return false;
    seen.add(ref.id);
    return true;
  });
}

/**
 * Wrap a raw measurement with its evidence trail and honest status.
 *
 * A feature with no evidence can never present itself as observed: the status
 * falls back to "insufficient_evidence" unless a caller explicitly overrides
 * it, so an unbacked number cannot be read as a real observation.
 */
export function feature<T>(
  value: T,
  evidence: EvidenceRef[],
  confidence: number,
  status?: FeatureStatus,
): ObservableFeature<T> {
  const refs = uniqueRefs(evidence);
  return {
    value,
    confidence: round(clamp(confidence)),
    status: status ?? (refs.length ? "observed" : "insufficient_evidence"),
    evidence: refs,
  };
}

export function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9%$]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2 && !STOPWORDS.has(token)),
  );
}

/**
 * A length-insensitive relevance signal. It asks whether the evidence covers
 * the claim's content, rather than rewarding a longer evidence paragraph.
 */
export function lexicalRelevance(claim: ArgNode, evidence: ArgNode): number {
  const claimTokens = tokens(claim.text);
  const evidenceTokens = tokens(evidence.text);
  if (!claimTokens.size || !evidenceTokens.size) return 0.2;
  let overlap = 0;
  for (const token of claimTokens) if (evidenceTokens.has(token)) overlap++;
  const claimCoverage = overlap / claimTokens.size;
  const numericOverlap = [...claimTokens].some((token) => /\d|%|\$/.test(token) && evidenceTokens.has(token)) ? 0.15 : 0;
  return clamp(0.25 + claimCoverage * 0.7 + numericOverlap);
}

export function isClaimLike(node: ArgNode): boolean {
  return CLAIM_KINDS.has(node.kind);
}

export function cloneGraph(graph: ArgGraph): ArgGraph {
  return {
    nodes: graph.nodes.map((node) => ({ ...node, citations: node.citations ? node.citations.map((c) => ({ ...c })) : undefined, targets: node.targets ? [...node.targets] : undefined })),
    edges: graph.edges.map((edge) => ({ ...edge })),
    dropped: graph.dropped.map((item) => ({ ...item })),
    contradictions: graph.contradictions.map((item) => ({ ...item })),
    concessions: graph.concessions.map((item) => ({ ...item })),
    fallacies: graph.fallacies.map((item) => ({ ...item })),
    evidenceStats: {
      ...graph.evidenceStats,
      byOwner: { ...graph.evidenceStats.byOwner },
      byStrength: { ...graph.evidenceStats.byStrength },
      unsupportedClaimIds: [...graph.evidenceStats.unsupportedClaimIds],
    },
    impactComparison: graph.impactComparison ? { ...graph.impactComparison } : null,
  };
}

/**
 * Recompute evidence statistics from graph STRUCTURE.
 *
 * A model's numeric `evidenceStats` is an annotation, not ground truth: every
 * count here is derived from the nodes and support edges that actually exist,
 * so an inflated model-supplied number can never enter scoring.
 */
export function recomputeEvidenceStats(graph: ArgGraph): ArgGraph["evidenceStats"] {
  const byOwner: Record<Owner, number> = { a: 0, b: 0, ai: 0 };
  const byStrength: Record<EvidenceStrength, number> = { anecdotal: 0, general: 0, cited: 0, strong: 0 };
  const evidence = graph.nodes.filter((node) => node.kind === "evidence");
  for (const node of evidence) {
    byOwner[node.owner]++;
    byStrength[node.evidenceStrength ?? "general"]++;
  }
  const evidenceIds = new Set(evidence.map((node) => node.id));
  const supported = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.relation !== "supports") continue;
    const from = graph.nodes.find((node) => node.id === edge.from);
    const to = graph.nodes.find((node) => node.id === edge.to);
    if (from && to && (evidenceIds.has(from.id) || evidenceIds.has(to.id))) {
      supported.add(evidenceIds.has(from.id) ? to.id : from.id);
    }
  }
  for (const node of graph.nodes) {
    if (isClaimLike(node) && !supported.has(node.id)) supported.add(`__not_supported__:${node.id}`);
  }
  return {
    total: evidence.length,
    byOwner,
    byStrength,
    unsupportedClaimIds: graph.nodes.filter((node) => isClaimLike(node) && !supported.has(node.id)).map((node) => node.id),
  };
}

export function mergeUniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const id = key(item);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }
  return out;
}

/** Add deterministic enrichments while retaining the original graph shape. */
export function enrichObservableGraph(input: ArgGraph): ArgGraph {
  const graph = cloneGraph(input);

  const detectedDropped = detectDropped(graph);
  graph.dropped = mergeUniqueBy([...graph.dropped, ...detectedDropped], (item) => item.nodeId);

  const detectedContradictions = detectContradictions(graph.nodes);
  graph.contradictions = mergeUniqueBy(
    [...graph.contradictions, ...detectedContradictions],
    (item) => `${item.a}:${item.b}:${item.owner}`,
  );

  const detectedConcessions = detectConcessions(graph.nodes);
  graph.concessions = mergeUniqueBy([...graph.concessions, ...detectedConcessions], (item) => `${item.nodeId}:${item.by}`);

  const detectedFallacies = graph.nodes.flatMap((node) => {
    const hit = classifyFallacies(node.text).find((candidate) => candidate.score >= CONFIDENT_FALLACY_THRESHOLD);
    return hit ? [{ nodeId: node.id, fallacy: hit.fallacy, note: `Deterministic high-confidence match: "${hit.matched}"` }] : [];
  });
  graph.fallacies = mergeUniqueBy(
    [...graph.fallacies, ...detectedFallacies],
    (item) => `${item.nodeId}:${item.fallacy}`,
  );

  // Treat the LLM's numeric evidenceStats/impactComparison as annotations, not
  // ground truth. Counts are recomputed from graph structure below.
  graph.evidenceStats = recomputeEvidenceStats(graph);
  // Keep unknown refs visible to validation; the scorer simply will not use
  // them as supporting evidence.
  return graph;
}

export function validationIssues(graph: ArgGraph): string[] {
  const issues = validateGraph(graph);
  const seen = new Set<string>();
  for (const node of graph.nodes) {
    if (seen.has(node.id)) issues.push(`Duplicate node id ${node.id}`);
    seen.add(node.id);
  }
  return [...new Set(issues)];
}

export function citationGrounding(name: string, homepage?: string): number {
  const base = sourceQualityScore(name);
  if (!isKnownSource(name)) return base * (homepage && isRootHomepage(homepage) ? 1 : 0.7);
  if (!homepage) return base * 0.8;
  return base * (isRootHomepage(homepage) ? 1 : 0.5);
}

export function bestCitationGrounding(node: ArgNode): number {
  return Math.max(0, ...(node.citations ?? []).map((citation) => citationGrounding(citation.sourceName, citation.homepage)));
}

export function citationRefs(node: ArgNode): EvidenceRef[] {
  return (node.citations ?? []).map((citation, index) =>
    derivedRef(`${node.id}:citation:${index}`, `${citation.sourceName}${citation.excerpt ? ` - ${citation.excerpt}` : ""}`, "Citation supplied on evidence node"),
  );
}

export { emptyGraph };
