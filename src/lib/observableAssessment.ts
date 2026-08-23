// Observable debate assessment.
//
// This module is deliberately independent of the model clients. A model may
// extract an ArgGraph, but it does not get to choose the score. The scorer
// recomputes graph statistics, attaches evidence references to every scored
// component, and returns "insufficient_evidence" when the graph cannot support
// a meaningful comparison.

import {
  emptyGraph,
  type ArgEdge,
  type ArgGraph,
  type ArgNode,
  type ArgNodeKind,
  type EvidenceStrength,
  type Owner,
} from "./argGraph";
import { validateGraph } from "./argGraph";
import { engineReport, type EngineReport } from "./argumentEvaluation";
import {
  classifyFallacies,
  detectConcessions,
  detectContradictions,
  detectDropped,
} from "./graphEnrichers";
import {
  isKnownSource,
  isRootHomepage,
  sourceQualityScore,
} from "./citationVerifier";
import type { TurnScores } from "./types";

export const OBSERVABLE_ASSESSMENT_VERSION = 1;
export const WINNER_TIE_THRESHOLD = 5;
export const CONFIDENT_FALLACY_THRESHOLD = 0.72;

/** The only weights used by the core 0–100 score. They sum to 100. */
export const SCORE_WEIGHTS = Object.freeze({
  supportedClaimRate: 20,
  evidenceQuality: 25,
  rebuttalCoverage: 20,
  argumentResponseRate: 10,
  impactHandling: 10,
  groundedDroppedArguments: 5,
  concessionHandling: 3,
  fallacyDiscipline: 4,
  contradictionDiscipline: 3,
});

export type AssessmentStatus = "scored" | "insufficient_evidence";
export type FeatureStatus = "observed" | "uncertain" | "insufficient_evidence";
export type ExtractionSource = "deterministic" | "llm" | "human";

export interface EvidenceRef {
  id: string;
  kind: "node" | "edge" | "derived";
  excerpt: string;
  round?: number;
  note?: string;
}

export interface ObservableFeature<T> {
  value: T;
  status: FeatureStatus;
  /** Confidence in the observation, not confidence that the side is good. */
  confidence: number;
  evidence: EvidenceRef[];
}

export interface ArgumentResponseValue {
  responded: number;
  opportunities: number;
  rate: number;
}

export interface ImpactComparisonValue {
  a: number;
  b: number;
  lead: "a" | "b" | "tie";
}

export interface SideObservableFeatures {
  owner: Owner;
  claimsMade: ObservableFeature<number>;
  claimsDirectlySupported: ObservableFeature<number>;
  evidenceActuallyCited: ObservableFeature<number>;
  evidenceRelevance: ObservableFeature<number>;
  directRebuttals: ObservableFeature<number>;
  rebuttalCoverage: ObservableFeature<number>;
  droppedArguments: ObservableFeature<number>;
  contradictions: ObservableFeature<number>;
  unsupportedAssertions: ObservableFeature<number>;
  concededPoints: ObservableFeature<number>;
  concessionHandling: ObservableFeature<number>;
  argumentResponses: ObservableFeature<ArgumentResponseValue>;
  impactHandling: ObservableFeature<number>;
  confidentlyDetectableFallacies: ObservableFeature<number>;
}

export interface ScoreComponent {
  id: keyof typeof SCORE_WEIGHTS;
  weight: number;
  rawValue: number;
  contribution: number;
  evidence: EvidenceRef[];
  rationale: string;
}

export interface ObservableSideScore {
  score: number | null;
  status: AssessmentStatus;
  confidence: number;
  components: ScoreComponent[];
  supportingEvidence: EvidenceRef[];
}

export interface ExtractionInfo {
  source: ExtractionSource;
  confidence: number;
  validationIssues: string[];
  uncertainty: string[];
}

export interface ObservableAssessment {
  version: 1;
  status: AssessmentStatus;
  winner: "a" | "b" | "tie";
  scoreGap: number | null;
  scores: { a: number | null; b: number | null };
  features: { a: SideObservableFeatures; b: SideObservableFeatures };
  sideScores: { a: ObservableSideScore; b: ObservableSideScore };
  impactComparison: ObservableFeature<ImpactComparisonValue>;
  scoreComposition: {
    formula: string;
    weights: typeof SCORE_WEIGHTS;
    tieThreshold: number;
  };
  extraction: ExtractionInfo;
  uncertainty: string[];
  decidingFactor: string;
  rationale: string;
  /** The graph shown to users is the graph after deterministic enrichment. */
  graph: ArgGraph;
  /** Engine findings (causal overclaim, fake precision, rebuttal/steelman quality) — additive, may be absent on older records. */
  engine?: EngineReport;
}

export interface AssessmentOptions {
  /** Graph owner used for labelled side A. Defaults to PvP's `a`. */
  sideA?: Owner;
  /** Graph owner used for labelled side B. Defaults to PvP's `b`. */
  sideB?: Owner;
  extractionSource?: ExtractionSource;
  extractionConfidence?: number;
  labelA?: string;
  labelB?: string;
}

export interface ObservableBreakdown {
  claims: number;
  evidence: number;
  rebuttals: number;
  impacts: number;
  fallacies: number;
  droppedSuffered: number;
}

const CLAIM_KINDS = new Set<ArgNodeKind>(["claim", "counterclaim"]);
const SUBSTANTIVE_KINDS = new Set<ArgNodeKind>(["claim", "counterclaim", "impact"]);
const STRENGTH_WEIGHT: Record<EvidenceStrength, number> = {
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

function clamp(value: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, value));
}

function round(value: number, decimals = 2): number {
  const p = 10 ** decimals;
  return Math.round(value * p) / p;
}

function nodeRef(node: ArgNode, note?: string): EvidenceRef {
  return { id: node.id, kind: "node", excerpt: node.text.slice(0, 240), round: node.round, note };
}

function edgeRef(edge: ArgEdge, nodes: Map<string, ArgNode>, note?: string): EvidenceRef {
  const from = nodes.get(edge.from)?.text ?? edge.from;
  const to = nodes.get(edge.to)?.text ?? edge.to;
  return {
    id: `${edge.from}->${edge.to}:${edge.relation}`,
    kind: "edge",
    excerpt: `${from.slice(0, 100)} —${edge.relation}→ ${to.slice(0, 100)}`,
    note,
  };
}

function derivedRef(id: string, excerpt: string, note?: string): EvidenceRef {
  return { id, kind: "derived", excerpt: excerpt.slice(0, 240), note };
}

function uniqueRefs(refs: EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    if (seen.has(ref.id)) return false;
    seen.add(ref.id);
    return true;
  });
}

function feature<T>(
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

function tokens(text: string): Set<string> {
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
function lexicalRelevance(claim: ArgNode, evidence: ArgNode): number {
  const claimTokens = tokens(claim.text);
  const evidenceTokens = tokens(evidence.text);
  if (!claimTokens.size || !evidenceTokens.size) return 0.2;
  let overlap = 0;
  for (const token of claimTokens) if (evidenceTokens.has(token)) overlap++;
  const claimCoverage = overlap / claimTokens.size;
  const numericOverlap = [...claimTokens].some((token) => /\d|%|\$/.test(token) && evidenceTokens.has(token)) ? 0.15 : 0;
  return clamp(0.25 + claimCoverage * 0.7 + numericOverlap);
}

function sameOwner(node: ArgNode | undefined, owner: Owner): boolean {
  return !!node && node.owner === owner;
}

function isClaimLike(node: ArgNode): boolean {
  return CLAIM_KINDS.has(node.kind);
}

function isSubstantive(node: ArgNode): boolean {
  return SUBSTANTIVE_KINDS.has(node.kind);
}

function cloneGraph(graph: ArgGraph): ArgGraph {
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

function recomputeEvidenceStats(graph: ArgGraph): ArgGraph["evidenceStats"] {
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

function mergeUniqueBy<T>(items: T[], key: (item: T) => string): T[] {
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
    return hit ? [{ nodeId: node.id, fallacy: hit.fallacy, note: `Deterministic high-confidence match: “${hit.matched}”` }] : [];
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

function validationIssues(graph: ArgGraph): string[] {
  const issues = validateGraph(graph);
  const seen = new Set<string>();
  for (const node of graph.nodes) {
    if (seen.has(node.id)) issues.push(`Duplicate node id ${node.id}`);
    seen.add(node.id);
  }
  return [...new Set(issues)];
}

function citationGrounding(name: string, homepage?: string): number {
  const base = sourceQualityScore(name);
  if (!isKnownSource(name)) return base * (homepage && isRootHomepage(homepage) ? 1 : 0.7);
  if (!homepage) return base * 0.8;
  return base * (isRootHomepage(homepage) ? 1 : 0.5);
}

function bestCitationGrounding(node: ArgNode): number {
  return Math.max(0, ...(node.citations ?? []).map((citation) => citationGrounding(citation.sourceName, citation.homepage)));
}

function citationRefs(node: ArgNode): EvidenceRef[] {
  return (node.citations ?? []).map((citation, index) =>
    derivedRef(`${node.id}:citation:${index}`, `${citation.sourceName}${citation.excerpt ? ` — ${citation.excerpt}` : ""}`, "Citation supplied on evidence node"),
  );
}

interface SupportLink {
  claim: ArgNode;
  evidence: ArgNode;
  edge?: ArgEdge;
  relevance: number;
  quality: number;
}

function supportLinks(graph: ArgGraph): SupportLink[] {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const links: SupportLink[] = [];
  for (const edge of graph.edges) {
    if (edge.relation !== "supports") continue;
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    const evidence = from?.kind === "evidence" ? from : to?.kind === "evidence" ? to : undefined;
    const claim = from && isClaimLike(from) ? from : to && isClaimLike(to) ? to : undefined;
    if (!evidence || !claim) continue;
    const relevance = lexicalRelevance(claim, evidence);
    const strength = evidence.evidenceStrength ? STRENGTH_WEIGHT[evidence.evidenceStrength] : 0.25;
    const citation = bestCitationGrounding(evidence);
    // A cited/strong tag without a real citation is not usable evidence.
    const citationFactor = evidence.evidenceStrength === "cited" || evidence.evidenceStrength === "strong"
      ? citation
      : evidence.citations?.length
        ? Math.max(0.25, citation)
        : strength;
    const quality = evidence.evidenceStrength && (evidence.evidenceStrength === "cited" || evidence.evidenceStrength === "strong") && !evidence.citations?.length
      ? 0
      : clamp(strength * citationFactor * relevance);
    links.push({ claim, evidence, edge, relevance, quality });
  }
  return links;
}

function addressedTargetIds(graph: ArgGraph, owner: Owner, opponent: Owner, nodes: Map<string, ArgNode>): Set<string> {
  const ids = new Set<string>();
  for (const edge of graph.edges) {
    if ((edge.relation !== "rebuts" && edge.relation !== "counters") || !sameOwner(nodes.get(edge.from), owner) || !sameOwner(nodes.get(edge.to), opponent)) continue;
    ids.add(edge.to);
  }
  for (const node of graph.nodes) {
    if (node.kind !== "rebuttal" || node.owner !== owner) continue;
    for (const target of node.targets ?? []) if (sameOwner(nodes.get(target), opponent)) ids.add(target);
  }
  return ids;
}

function opportunitiesFor(graph: ArgGraph, responder: Owner, opponent: Owner): ArgNode[] {
  const opponentNodes = graph.nodes.filter((node) => node.owner === opponent && isSubstantive(node));
  return opponentNodes.filter((node) => graph.nodes.some((candidate) => candidate.owner === responder && candidate.round > node.round));
}

function opponentTurnOpportunities(graph: ArgGraph, responder: Owner, opponent: Owner): number[] {
  return [...new Set(opportunitiesFor(graph, responder, opponent).map((node) => node.round))].sort((a, b) => a - b);
}

function directRebuttalRefs(graph: ArgGraph, owner: Owner, opponent: Owner, nodes: Map<string, ArgNode>): EvidenceRef[] {
  const refs: EvidenceRef[] = [];
  for (const node of graph.nodes) {
    if (node.owner !== owner || node.kind !== "rebuttal") continue;
    const targets = (node.targets ?? []).filter((target) => sameOwner(nodes.get(target), opponent));
    if (targets.length) refs.push(nodeRef(node, `Directly targets ${targets.join(", ")}`));
  }
  for (const edge of graph.edges) {
    if ((edge.relation === "rebuts" || edge.relation === "counters") && sameOwner(nodes.get(edge.from), owner) && sameOwner(nodes.get(edge.to), opponent)) {
      refs.push(edgeRef(edge, nodes, "Direct response edge"));
    }
  }
  return uniqueRefs(refs);
}

function impactHandling(graph: ArgGraph, owner: Owner, links: SupportLink[]): { value: number; evidence: EvidenceRef[] } {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const impacts = graph.nodes.filter((node) => node.owner === owner && node.kind === "impact");
  if (!impacts.length) return { value: 0, evidence: [] };
  const linkedIds = new Set<string>();
  const groundedIds = new Set<string>();
  const evidence: EvidenceRef[] = [];
  for (const edge of graph.edges) {
    if (edge.relation !== "impacts") continue;
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    const impact = from?.kind === "impact" ? from : to?.kind === "impact" ? to : undefined;
    const other = impact?.id === from?.id ? to : from;
    if (!impact || impact.owner !== owner) continue;
    linkedIds.add(impact.id);
    evidence.push(edgeRef(edge, nodes, "Impact is linked to an argument"));
    if (other && links.some((link) => link.claim.id === other.id && link.quality > 0.2)) groundedIds.add(impact.id);
  }
  const comparisonLanguage = impacts.filter((node) => /\b(because|therefore|cost|benefit|risk|harm|trade[- ]?off|outweigh|more important|less important|impact|matters|leads to)\b/i.test(node.text));
  const linkedRate = linkedIds.size / impacts.length;
  const groundedRate = groundedIds.size / impacts.length;
  const comparisonRate = comparisonLanguage.length / impacts.length;
  evidence.push(...comparisonLanguage.map((node) => nodeRef(node, "Explicit impact/comparison language")));
  return { value: clamp(0.5 * linkedRate + 0.3 * groundedRate + 0.2 * comparisonRate), evidence: uniqueRefs(evidence.length ? evidence : impacts.map((node) => nodeRef(node))) };
}

function buildSideFeatures(graph: ArgGraph, owner: Owner, opponent: Owner, extractionConfidence: number): SideObservableFeatures {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const ownClaims = graph.nodes.filter((node) => node.owner === owner && isClaimLike(node));
  const ownEvidence = graph.nodes.filter((node) => node.owner === owner && node.kind === "evidence");
  const ownSubstantive = graph.nodes.filter((node) => node.owner === owner && isSubstantive(node));
  const links = supportLinks(graph).filter((link) => link.claim.owner === owner || link.evidence.owner === owner);
  const ownLinks = links.filter((link) => link.claim.owner === owner && link.evidence.owner === owner);
  const byClaim = new Map<string, SupportLink[]>();
  for (const link of ownLinks) byClaim.set(link.claim.id, [...(byClaim.get(link.claim.id) ?? []), link]);
  const explicitUnsupported = new Set(graph.evidenceStats.unsupportedClaimIds);
  const directlySupportedClaims = ownClaims.filter((claim) => byClaim.has(claim.id) && !explicitUnsupported.has(claim.id));
  const citedEvidence = ownEvidence.filter((node) => (node.citations ?? []).some((citation) => !!citation.sourceName?.trim()));

  const relevanceRefs = ownLinks.flatMap((link) => [nodeRef(link.claim, `Evidence relevance ${round(link.relevance)}`), nodeRef(link.evidence, `Evidence relevance ${round(link.relevance)}`)]);
  const evidenceRelevance = ownLinks.length
    ? ownLinks.reduce((sum, link) => sum + link.relevance, 0) / ownLinks.length
    : 0;
  const rebuttalRefs = directRebuttalRefs(graph, owner, opponent, nodes);
  const responseTargets = addressedTargetIds(graph, owner, opponent, nodes);
  const rebuttalOpportunities = opportunitiesFor(graph, owner, opponent);
  const addressedOpportunities = rebuttalOpportunities.filter((node) => responseTargets.has(node.id));
  const rebuttalCoverage = rebuttalOpportunities.length ? addressedOpportunities.length / rebuttalOpportunities.length : 0;
  const responseRounds = opponentTurnOpportunities(graph, owner, opponent);
  const respondedRounds = responseRounds.filter((roundNumber) => rebuttalOpportunities.some((node) => node.round === roundNumber && responseTargets.has(node.id)));
  const argumentResponseRate = responseRounds.length ? respondedRounds.length / responseRounds.length : 0;
  const responseRefs = [
    ...rebuttalOpportunities.map((node) => nodeRef(node, responseTargets.has(node.id) ? "Answered" : "No direct response recorded")),
    ...rebuttalRefs,
  ];

  const opponentTargets = addressedTargetIds(graph, opponent, owner, nodes);
  const ownDropped = ownSubstantive.filter((node) => {
    const hadLaterOpponentTurn = graph.nodes.some((candidate) => candidate.owner === opponent && candidate.round > node.round);
    return hadLaterOpponentTurn && !opponentTargets.has(node.id);
  });
  const unsupportedAssertions = ownClaims.filter((claim) => !byClaim.has(claim.id) || explicitUnsupported.has(claim.id));
  const contradictions = graph.contradictions.filter((item) => item.owner === owner && nodes.has(item.a) && nodes.has(item.b));
  const deterministicContradictions = detectContradictions(graph.nodes).filter((item) => item.owner === owner && nodes.has(item.a) && nodes.has(item.b));
  const contradictionKeys = new Set(contradictions.map((item) => `${item.a}:${item.b}`));
  const allContradictions = [...contradictions, ...deterministicContradictions.filter((item) => !contradictionKeys.has(`${item.a}:${item.b}`))];

  const ownConcessions = graph.concessions.filter((item) => item.by === owner && nodes.has(item.nodeId));
  const deterministicConcessions = detectConcessions(graph.nodes).filter((item) => item.by === owner);
  const concessions = mergeUniqueBy([...ownConcessions, ...deterministicConcessions], (item) => item.nodeId);
  const handledConcessions = concessions.filter((concession) => {
    const later = graph.nodes.filter((node) => node.owner === owner && node.round > (nodes.get(concession.nodeId)?.round ?? 0));
    return later.some((node) => node.kind === "impact" || graph.edges.some((edge) => edge.from === node.id && edge.to === concession.nodeId));
  });

  const confidentFallacies = graph.nodes.flatMap((node) => {
    if (node.owner !== owner) return [];
    const hits = classifyFallacies(node.text).filter((hit) => hit.score >= CONFIDENT_FALLACY_THRESHOLD);
    return hits.map((hit) => ({ node, hit }));
  });
  const fallacyRefs = confidentFallacies.map(({ node, hit }) => nodeRef(node, `High-confidence ${hit.fallacy} match: ${hit.matched}`));
  const impact = impactHandling(graph, owner, links);

  const claimEvidence = ownClaims.map((claim) => nodeRef(claim));
  const directSupportEvidence = directlySupportedClaims.flatMap((claim) => [nodeRef(claim, "Direct support edge"), ...(byClaim.get(claim.id) ?? []).flatMap((link) => link.edge ? [edgeRef(link.edge, nodes)] : [])]);
  const citedEvidenceRefs = citedEvidence.flatMap((node) => [nodeRef(node, "Citation supplied"), ...citationRefs(node)]);
  const droppedRefs = ownDropped.map((node) => nodeRef(node, "Opponent had a later turn but no target response"));
  const contradictionRefs = allContradictions.flatMap((item) => [nodeRef(nodes.get(item.a)!, item.explanation), nodeRef(nodes.get(item.b)!, item.explanation)]);
  const concessionRefs = concessions.map((item) => nodeRef(nodes.get(item.nodeId)!, item.note));

  const confidence = extractionConfidence;
  return {
    owner,
    claimsMade: feature(ownClaims.length, claimEvidence, confidence),
    claimsDirectlySupported: feature(directlySupportedClaims.length, directSupportEvidence.length ? directSupportEvidence : claimEvidence, confidence),
    evidenceActuallyCited: feature(citedEvidence.length, citedEvidenceRefs.length ? citedEvidenceRefs : ownEvidence.map((node) => nodeRef(node, "No usable citation supplied")), confidence),
    evidenceRelevance: feature(round(evidenceRelevance), relevanceRefs.length ? relevanceRefs : ownEvidence.map((node) => nodeRef(node, "No claim link to assess relevance")), confidence),
    directRebuttals: feature(rebuttalRefs.filter((ref) => ref.kind === "node").length, rebuttalRefs, confidence),
    rebuttalCoverage: feature(round(rebuttalCoverage), responseRefs.length ? responseRefs : rebuttalOpportunities.map((node) => nodeRef(node, "No direct response recorded")), confidence, rebuttalOpportunities.length ? undefined : "insufficient_evidence"),
    droppedArguments: feature(ownDropped.length, droppedRefs.length ? droppedRefs : ownSubstantive.map((node) => nodeRef(node, "No dropped argument observed")), confidence),
    contradictions: feature(allContradictions.length, contradictionRefs.length ? contradictionRefs : claimEvidence, confidence),
    unsupportedAssertions: feature(unsupportedAssertions.length, unsupportedAssertions.length ? unsupportedAssertions.map((node) => nodeRef(node, "No usable support edge")) : claimEvidence, confidence),
    concededPoints: feature(concessions.length, concessionRefs, confidence),
    concessionHandling: feature(
      concessions.length ? handledConcessions.length / concessions.length : 1,
      concessionRefs.length ? concessionRefs : claimEvidence,
      confidence,
    ),
    argumentResponses: feature(
      { responded: respondedRounds.length, opportunities: responseRounds.length, rate: round(argumentResponseRate) },
      responseRefs.length ? responseRefs : graph.nodes.filter((node) => node.owner === opponent).map((node) => nodeRef(node, "No later response opportunity")),
      confidence,
      responseRounds.length ? undefined : "insufficient_evidence",
    ),
    impactHandling: feature(round(impact.value), impact.evidence, confidence),
    confidentlyDetectableFallacies: feature(confidentFallacies.length, fallacyRefs.length ? fallacyRefs : claimEvidence, confidence),
  };
}

function component(
  id: keyof typeof SCORE_WEIGHTS,
  rawValue: number,
  evidence: EvidenceRef[],
  rationale: string,
): ScoreComponent {
  const raw = clamp(rawValue);
  return {
    id,
    weight: SCORE_WEIGHTS[id],
    rawValue: round(raw),
    contribution: round(raw * SCORE_WEIGHTS[id], 2),
    evidence: uniqueRefs(evidence),
    rationale,
  };
}

function scoreSide(features: SideObservableFeatures, graph: ArgGraph, globalStatus: AssessmentStatus, extractionConfidence: number): ObservableSideScore {
  if (globalStatus === "insufficient_evidence" || features.claimsMade.value === 0) {
    return { score: null, status: "insufficient_evidence", confidence: 0, components: [], supportingEvidence: [] };
  }
  const claims = Math.max(1, features.claimsMade.value);
  const claimRefs = features.claimsMade.evidence;
  const supportedRefs = features.claimsDirectlySupported.evidence;
  const evidenceRefs = uniqueRefs([...features.evidenceActuallyCited.evidence, ...features.evidenceRelevance.evidence]);
  const rebuttalRefs = uniqueRefs([...features.rebuttalCoverage.evidence, ...features.directRebuttals.evidence]);
  const responseRefs = features.argumentResponses.evidence;
  const impactRefs = features.impactHandling.evidence;
  const groundedDropped = graph.dropped.filter((item) => item.owner === features.owner && graph.nodes.some((node) => node.id === item.nodeId && isClaimLike(node))).filter((item) => {
    const claim = graph.nodes.find((node) => node.id === item.nodeId);
    return !!claim && supportLinks(graph).some((link) => link.claim.id === claim.id && link.quality > 0.2);
  });
  const droppedRefs = groundedDropped.length ? groundedDropped.map((item) => derivedRef(`dropped:${item.nodeId}`, item.text, "Supported argument left unanswered")) : features.droppedArguments.evidence;
  const components = [
    component("supportedClaimRate", features.claimsDirectlySupported.value / claims, supportedRefs.length ? supportedRefs : claimRefs, "Direct support edges divided by claims made; unsupported claims do not count."),
    component("evidenceQuality", features.claimsMade.value ? evidenceRefs.length ? averageClaimEvidenceQuality(graph, features.owner) : 0 : 0, evidenceRefs.length ? evidenceRefs : claimRefs, "Per-claim maximum of citation grounding × evidence strength × relevance; duplicate sources do not stack."),
    component("rebuttalCoverage", features.rebuttalCoverage.value, rebuttalRefs, "Opponent arguments with a direct target response divided by response opportunities."),
    component("argumentResponseRate", features.argumentResponses.value.rate, responseRefs, "Opponent turns answered by a target response divided by turns where a response was possible."),
    component("impactHandling", features.impactHandling.value, impactRefs, "Impact nodes linked to arguments, grounded where possible, and explicitly compared."),
    component("groundedDroppedArguments", groundedDropped.length / claims, droppedRefs, "Supported claims the opponent left unanswered; dropped unsupported assertions earn no credit."),
    component("concessionHandling", features.concessionHandling.value, features.concessionHandling.evidence.length ? features.concessionHandling.evidence : claimRefs, "Concessions are neutral unless the graph shows whether the side handled the pivot."),
    component("fallacyDiscipline", 1 - Math.min(1, features.confidentlyDetectableFallacies.value / claims), features.confidentlyDetectableFallacies.evidence, "Only deterministic fallacy matches above the confidence threshold are penalized."),
    component("contradictionDiscipline", 1 - Math.min(1, features.contradictions.value / claims), features.contradictions.evidence, "Self-contradictions are penalized relative to claims made."),
  ];
  const total = components.reduce((sum, item) => sum + item.contribution, 0);
  const supportingEvidence = uniqueRefs(components.flatMap((item) => item.evidence));
  const score = Math.round(clamp(total / 100, 0, 1) * 100);
  const confidence = round(clamp(extractionConfidence * (0.5 + 0.5 * Math.min(1, supportingEvidence.length / 8))));
  return { score, status: "scored", confidence, components, supportingEvidence };
}

export function breakdownFromAssessment(assessment: ObservableAssessment): { a: ObservableBreakdown; b: ObservableBreakdown } {
  const forSide = (label: "a" | "b"): ObservableBreakdown => {
    const side = assessment.features[label];
    const impacts = assessment.graph.nodes.filter((node) => node.owner === side.owner && node.kind === "impact").length;
    return {
      claims: side.claimsMade.value,
      evidence: side.evidenceActuallyCited.value,
      rebuttals: side.directRebuttals.value,
      impacts,
      fallacies: side.confidentlyDetectableFallacies.value,
      droppedSuffered: side.droppedArguments.value,
    };
  };
  return { a: forSide("a"), b: forSide("b") };
}

/** Convert an extracted graph into the fields persisted by the PvP route. */
export function finalizePvpAssessment(raw: { rationale?: string; argGraph?: ArgGraph }, options: AssessmentOptions = {}) {
  const assessment = assessArgumentGraph(raw.argGraph, { ...options, extractionSource: options.extractionSource ?? "llm" });
  return {
    winner: assessment.winner,
    playerAScore: assessment.scores.a ?? 0,
    playerBScore: assessment.scores.b ?? 0,
    scoreStatus: assessment.status,
    rationale: raw.rationale?.trim() || assessment.rationale,
    decidingFactor: assessment.decidingFactor,
    breakdown: breakdownFromAssessment(assessment),
    argGraph: assessment.graph,
    observableAssessment: assessment,
  };
}

function averageClaimEvidenceQuality(graph: ArgGraph, owner: Owner): number {
  const links = supportLinks(graph).filter((link) => link.claim.owner === owner && link.evidence.owner === owner);
  const claims = graph.nodes.filter((node) => node.owner === owner && isClaimLike(node));
  if (!claims.length) return 0;
  return claims.reduce((sum, claim) => {
    const best = links.filter((link) => link.claim.id === claim.id).reduce((value, link) => Math.max(value, link.quality), 0);
    return sum + best;
  }, 0) / claims.length;
}

function impactComparisonFeature(features: { a: SideObservableFeatures; b: SideObservableFeatures }, extractionConfidence: number): ObservableFeature<ImpactComparisonValue> {
  const a = features.a.impactHandling.value;
  const b = features.b.impactHandling.value;
  const lead = Math.abs(a - b) < 0.1 ? "tie" : a > b ? "a" : "b";
  const evidence = uniqueRefs([...features.a.impactHandling.evidence, ...features.b.impactHandling.evidence]);
  return feature({ a: round(a), b: round(b), lead }, evidence, extractionConfidence, evidence.length ? undefined : "insufficient_evidence");
}

function topComponentDifference(a: ObservableSideScore, b: ObservableSideScore): ScoreComponent | null {
  let best: ScoreComponent | null = null;
  let bestAbs = -1;
  for (const left of a.components) {
    const right = b.components.find((item) => item.id === left.id);
    const difference = Math.abs(left.contribution - (right?.contribution ?? 0));
    if (difference > bestAbs) {
      best = left;
      bestAbs = difference;
    }
  }
  return best;
}

function labelFor(owner: "a" | "b", options: AssessmentOptions): string {
  return owner === "a" ? options.labelA ?? "Player A" : options.labelB ?? "Player B";
}

/**
 * Score an extracted graph. The returned score is null when there is not
 * enough observable structure to compare the sides.
 */
export function assessArgumentGraph(input: ArgGraph | null | undefined, options: AssessmentOptions = {}): ObservableAssessment {
  const sideA = options.sideA ?? "a";
  const sideB = options.sideB ?? "b";
  const source = options.extractionSource ?? "llm";
  const extractionConfidence = clamp(options.extractionConfidence ?? (source === "llm" ? 0.65 : source === "human" ? 0.9 : 1));
  const baseGraph = input ?? emptyGraph();
  const graph = enrichObservableGraph(baseGraph);
  const issues = validationIssues(graph);
  const uncertainty: string[] = [];
  if (source === "llm") uncertainty.push("Argument graph was extracted by an LLM; graph facts were not independently verified.");
  if (issues.length) uncertainty.push(...issues.map((issue) => `Graph validation: ${issue}`));
  if (!input) uncertainty.push("No argument graph was returned by the extractor.");
  const adjustedExtractionConfidence = clamp(extractionConfidence - Math.min(0.35, issues.length * 0.04));
  const features = {
    a: buildSideFeatures(graph, sideA, sideB, adjustedExtractionConfidence),
    b: buildSideFeatures(graph, sideB, sideA, adjustedExtractionConfidence),
  };
  const claimCount = features.a.claimsMade.value + features.b.claimsMade.value;
  const evidenceCount = graph.nodes.filter((node) => node.kind === "evidence").length;
  const directClashCount = graph.edges.filter((edge) => edge.relation === "rebuts" || edge.relation === "counters").length + graph.nodes.filter((node) => node.kind === "rebuttal" && (node.targets?.length ?? 0) > 0).length;
  const impactCount = graph.nodes.filter((node) => node.kind === "impact").length;
  const enoughStructure = !!input && claimCount >= 2 && (evidenceCount > 0 || directClashCount > 0 || impactCount > 0);
  const globallyInsufficient = !enoughStructure || adjustedExtractionConfidence < 0.4;
  if (globallyInsufficient) {
    uncertainty.push(
      claimCount < 2
        ? "Fewer than two observable claims were extracted."
        : "The graph has no independently checkable evidence or argument clash to compare.",
    );
  }
  const status: AssessmentStatus = globallyInsufficient ? "insufficient_evidence" : "scored";
  const sideScores = {
    a: scoreSide(features.a, graph, status, adjustedExtractionConfidence),
    b: scoreSide(features.b, graph, status, adjustedExtractionConfidence),
  };
  const scoreA = sideScores.a.score;
  const scoreB = sideScores.b.score;
  const scoreGap = scoreA === null || scoreB === null ? null : Math.abs(scoreA - scoreB);
  const winner: ObservableAssessment["winner"] = status === "insufficient_evidence" || scoreGap === null || scoreGap < WINNER_TIE_THRESHOLD
    ? "tie"
    : scoreA !== null && scoreB !== null && scoreA > scoreB ? "a" : "b";
  const impactComparison = impactComparisonFeature(features, adjustedExtractionConfidence);
  const enrichedForDisplay = cloneGraph(graph);
  enrichedForDisplay.impactComparison = {
    a: Math.round(impactComparison.value.a * 100),
    b: Math.round(impactComparison.value.b * 100),
    rationale: impactComparison.evidence.length
      ? `Derived from linked impacts, grounded support, and explicit comparison language; no model-supplied 0–100 impact number is used.`
      : "Insufficient observable impact nodes to compare.",
  };
  const factor = !globallyInsufficient ? topComponentDifference(sideScores.a, sideScores.b) : null;
  const leadLabel = winner === "a" ? labelFor("a", options) : winner === "b" ? labelFor("b", options) : "Neither side";
  const decidingFactor = status === "insufficient_evidence"
    ? "Insufficient evidence: the extracted graph cannot support a defensible winner."
    : winner === "tie"
      ? `The observable score gap is ${scoreGap ?? 0}, below the ${WINNER_TIE_THRESHOLD}-point tie threshold.`
      : `${leadLabel} led on ${factor?.id ?? "the observable argument features"}; the component cites graph nodes and edges rather than prose style.`;
  const rationale = status === "insufficient_evidence"
    ? uncertainty.join(" ")
    : `${labelFor("a", options)} scored ${scoreA}/100 and ${labelFor("b", options)} scored ${scoreB}/100 from observable graph features. ${decidingFactor}`;
  return {
    version: OBSERVABLE_ASSESSMENT_VERSION,
    status,
    winner,
    scoreGap,
    scores: { a: scoreA, b: scoreB },
    features,
    sideScores,
    impactComparison,
    scoreComposition: {
      formula: "100 × weighted mean(supported claims, evidence quality, rebuttal coverage, responses, impact handling, grounded dropped arguments, concession handling, fallacy discipline, contradiction discipline); no text-length term",
      weights: SCORE_WEIGHTS,
      tieThreshold: WINNER_TIE_THRESHOLD,
    },
    extraction: {
      source,
      confidence: round(adjustedExtractionConfidence),
      validationIssues: issues,
      uncertainty: [...uncertainty],
    },
    uncertainty: [...uncertainty],
    decidingFactor,
    rationale,
    engine: engineReport(enrichedForDisplay, { a: sideA, b: sideB }),
    graph: enrichedForDisplay,
  };
}

/** Swap side ownership while preserving every argument, edge, citation, and text. */
export function swapGraphSides(input: ArgGraph): ArgGraph {
  const graph = cloneGraph(input);
  const swap = (owner: Owner): Owner => owner === "a" ? "b" : owner === "b" ? "a" : owner;
  graph.nodes = graph.nodes.map((node) => ({ ...node, owner: swap(node.owner) }));
  graph.dropped = graph.dropped.map((item) => ({ ...item, owner: swap(item.owner) }));
  graph.contradictions = graph.contradictions.map((item) => ({ ...item, owner: swap(item.owner) }));
  graph.concessions = graph.concessions.map((item) => ({ ...item, by: swap(item.by) }));
  return graph;
}

function citationFromText(text: string): Array<{ sourceName: string; homepage: string }> {
  const out: Array<{ sourceName: string; homepage: string }> = [];
  const seen = new Set<string>();
  const known: Array<[string, string]> = [
    ["Pew Research Center", "pew research center|pew"],
    ["Lazard", "lazard"],
    ["NREL", "nrel"],
    ["IEA", "iea"],
    ["OECD", "oecd"],
    ["NIST", "nist"],
    ["Stanford HAI", "stanford hai"],
    ["Brookings", "brookings"],
    ["Bruegel", "bruegel"],
    ["WHO", "who"],
    ["IMF", "imf"],
    ["Reuters", "reuters"],
    ["Nature", "nature"],
  ];
  const homepages: Record<string, string> = {
    "Pew Research Center": "https://www.pewresearch.org",
    Lazard: "https://www.lazard.com",
    NREL: "https://www.nrel.gov",
    IEA: "https://www.iea.org",
    OECD: "https://www.oecd.org",
    NIST: "https://www.nist.gov",
    "Stanford HAI": "https://hai.stanford.edu",
    Brookings: "https://www.brookings.edu",
    Bruegel: "https://www.bruegel.org",
    WHO: "https://www.who.int",
    IMF: "https://www.imf.org",
    Reuters: "https://www.reuters.com",
    Nature: "https://www.nature.com",
  };
  for (const [display, pattern] of known) {
    if (!new RegExp(`\\b(?:${pattern})\\b`, "i").test(text) || seen.has(display)) continue;
    seen.add(display);
    out.push({ sourceName: display, homepage: homepages[display] });
  }
  return out;
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map((part) => part.trim()).filter(Boolean);
}

/** Deterministic fallback/extractor for solo turn assessment. */
export function graphFromTurn(params: { userMessage: string; opponentMessage: string; round: number }): ArgGraph {
  const userMessage = params.userMessage.trim();
  const opponentMessage = params.opponentMessage.trim();
  const nodes: ArgNode[] = [];
  const edges: ArgEdge[] = [];
  const opponentId = opponentMessage ? `r${params.round}-opponent` : null;
  if (opponentId) nodes.push({ id: opponentId, kind: "counterclaim", owner: "ai", text: opponentMessage.slice(0, 240), round: Math.max(1, params.round - 1) });
  const claimId = `r${params.round}-claim`;
  nodes.push({ id: claimId, kind: "claim", owner: "a", text: userMessage.slice(0, 240), round: params.round });

  const sentences = splitSentences(userMessage);
  const evidenceSentences = sentences.filter((sentence) => /\b(according to|study|studies|data|report|survey|research|analysis|finds?|shows?|%|\$\d|\d{2,})\b/i.test(sentence) || citationFromText(sentence).length > 0);
  evidenceSentences.slice(0, 3).forEach((sentence, index) => {
    const citations = citationFromText(sentence);
    const evidenceId = `r${params.round}-evidence-${index + 1}`;
    nodes.push({ id: evidenceId, kind: "evidence", owner: "a", text: sentence.slice(0, 240), round: params.round, evidenceStrength: citations.length ? "cited" : "general", citations: citations.map((citation) => ({ sourceName: citation.sourceName, homepage: citation.homepage })) });
    edges.push({ from: evidenceId, to: claimId, relation: "supports" });
  });

  const responsePattern = /\b(but|however|although|while|even if|your point|you say|you argue|that ignores|in response|because|instead)\b/i;
  const shared = opponentMessage && [...tokens(opponentMessage)].filter((token) => tokens(userMessage).has(token)).length >= 2;
  if (opponentId && (responsePattern.test(userMessage) || shared)) {
    const rebuttalId = `r${params.round}-rebuttal`;
    nodes.push({ id: rebuttalId, kind: "rebuttal", owner: "a", text: userMessage.slice(0, 240), round: params.round, targets: [opponentId] });
    edges.push({ from: rebuttalId, to: opponentId, relation: "rebuts" });
  }
  if (/\b(therefore|so|means|impact|benefit|cost|risk|harm|helps|matters|leads to|results in)\b/i.test(userMessage)) {
    const impactId = `r${params.round}-impact`;
    nodes.push({ id: impactId, kind: "impact", owner: "a", text: userMessage.slice(0, 240), round: params.round });
    edges.push({ from: claimId, to: impactId, relation: "impacts" });
  }
  const fallacies = nodes.flatMap((node) => classifyFallacies(node.text).map((hit) => ({ nodeId: node.id, fallacy: hit.fallacy, note: `Extracted hint: ${hit.matched}` as string })));
  return {
    nodes,
    edges,
    dropped: [],
    contradictions: detectContradictions(nodes),
    concessions: detectConcessions(nodes),
    fallacies,
    evidenceStats: recomputeEvidenceStats({ ...emptyGraph(), nodes, edges } as ArgGraph),
    impactComparison: null,
  };
}

export interface TurnObservableAssessment {
  graph: ArgGraph;
  assessment: ObservableAssessment;
  scores: TurnScores;
  turnScore: number;
}

function toTen(value: number): number {
  return Math.max(0, Math.min(10, Math.round(clamp(value) * 10)));
}

/** Project observable features into the legacy UI's five display buckets. */
export function turnScoresFromAssessment(assessment: ObservableAssessment, owner: "a" | "b" = "a"): TurnScores {
  const side = assessment.features[owner];
  const supportedRate = side.claimsMade.value ? side.claimsDirectlySupported.value / side.claimsMade.value : 0;
  const contradictionDiscipline = 1 - Math.min(1, side.contradictions.value / Math.max(1, side.claimsMade.value));
  return {
    depth: toTen((supportedRate + side.impactHandling.value) / 2),
    evidence: toTen(assessment.sideScores[owner].components.find((item) => item.id === "evidenceQuality")?.rawValue ?? 0),
    logic: toTen((supportedRate + contradictionDiscipline) / 2),
    rebuttal: toTen(side.rebuttalCoverage.value),
    clarity: toTen(side.argumentResponses.value.rate),
  };
}

export function assessTurn(params: { userMessage: string; opponentMessage: string; round: number }): TurnObservableAssessment {
  const graph = graphFromTurn(params);
  const assessment = assessArgumentGraph(graph, { sideA: "a", sideB: "ai", extractionSource: "deterministic", labelA: "You", labelB: "AI opponent" });
  const scores = turnScoresFromAssessment(assessment, "a");
  const turnScore = assessment.sideScores.a.score === null ? 0 : Math.round(assessment.sideScores.a.score / 2);
  return { graph, assessment, scores, turnScore };
}

/** Merge turn-level graphs for the final solo-debate explanation. */
export function mergeAssessmentGraphs(graphs: ArgGraph[]): ArgGraph {
  if (!graphs.length) return emptyGraph();
  const out = emptyGraph();
  for (const graph of graphs) {
    out.nodes.push(...graph.nodes);
    out.edges.push(...graph.edges);
    out.dropped.push(...graph.dropped);
    out.contradictions.push(...graph.contradictions);
    out.concessions.push(...graph.concessions);
    out.fallacies.push(...graph.fallacies);
  }
  out.evidenceStats = recomputeEvidenceStats(out);
  return out;
}

