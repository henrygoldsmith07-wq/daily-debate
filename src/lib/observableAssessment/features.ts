// Observable feature extraction.
//
// This is the ONLY place that decides what was actually observed about a side.
// Every feature carries an evidence trail and a status, and every count reads
// through the canonical opportunity semantics in opportunity.ts so the scorer,
// the ledger, rewards and repair measurement can never disagree.
//
// Extraction deliberately does NOT score: it reports what happened, and
// scoring.ts decides what that is worth.

import type { ArgGraph, ArgNode, Owner } from "../argGraph";
import { engineReport } from "../argumentEvaluation";
import { classifyFallacies, detectConcessions, detectContradictions } from "../graphEnrichers";
import {
  ENGAGEMENT_KINDS,
  eligibleOpponentMoves,
  isValidRebuttalTarget,
  rebuttalCoverageFor,
  unansweredOpportunitiesBy,
  userAnsweredIds,
} from "../opportunity";
import { CONFIDENT_FALLACY_THRESHOLD, type EvidenceRef, type SideObservableFeatures, type SupportLink } from "./types";
import {
  STRENGTH_WEIGHT,
  bestCitationGrounding,
  citationRefs,
  edgeRef,
  feature,
  isClaimLike,
  lexicalRelevance,
  mergeUniqueBy,
  nodeRef,
  round,
} from "./graphEnrichment";

/**
 * Every claim->evidence support link in the graph, with a quality score.
 *
 * Quality combines citation grounding x declared evidence strength x lexical
 * relevance. A "cited"/"strong" tag with no real citation scores zero: a label
 * without a checkable source is decoration, not evidence.
 */
export function supportLinks(graph: ArgGraph): SupportLink[] {
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
    const citationFactor =
      evidence.evidenceStrength === "cited" || evidence.evidenceStrength === "strong"
        ? citation
        : evidence.citations?.length
          ? Math.max(0.25, citation)
          : strength;
    const quality =
      evidence.evidenceStrength &&
      (evidence.evidenceStrength === "cited" || evidence.evidenceStrength === "strong") &&
      !evidence.citations?.length
        ? 0
        : Math.max(0, Math.min(1, strength * citationFactor * relevance));
    links.push({ claim, evidence, edge, relevance, quality });
  }
  return links;
}

/**
 * The canonical "answered" definition, re-exported here so feature extraction
 * reads exactly the same target-validity rule as rewards, the ledger, drop
 * detection and repair measurement.
 */
export function addressedTargetIds(graph: ArgGraph, owner: Owner): Set<string> {
  return userAnsweredIds(graph, owner);
}

/**
 * Argument ENGAGEMENT opportunities - deliberately broader than canonical
 * rebuttal coverage: any opponent argument move (claim/counterclaim/impact)
 * the side had a later turn to engage with. This feeds the per-round
 * "argumentResponses" feature (did the side engage every opponent turn?) and
 * is NEVER exposed under the "rebuttalCoverage" name.
 */
export function engagementOpportunitiesFor(graph: ArgGraph, responder: Owner): ArgNode[] {
  return graph.nodes.filter(
    (node) =>
      node.owner !== responder &&
      ENGAGEMENT_KINDS.has(node.kind) &&
      graph.nodes.some((candidate) => candidate.owner === responder && candidate.round > node.round),
  );
}

/** Evidence trail for the direct responses that genuinely targeted opponent moves. */
export function directRebuttalRefs(graph: ArgGraph, owner: Owner, nodes: Map<string, ArgNode>): EvidenceRef[] {
  // Only VALID direct responses appear: a rebuttal whose targets are all
  // invalid (self/future/dangling) is not a direct response.
  const refs: EvidenceRef[] = [];
  for (const node of graph.nodes) {
    if (node.owner !== owner || node.kind !== "rebuttal") continue;
    const targets = (node.targets ?? []).filter((target) => isValidRebuttalTarget(graph, target, owner, node.round));
    if (targets.length) refs.push(nodeRef(node, `Directly targets ${targets.join(", ")}`));
  }
  for (const edge of graph.edges) {
    if (edge.relation !== "rebuts" && edge.relation !== "counters") continue;
    const from = nodes.get(edge.from);
    if (!from || from.owner !== owner) continue;
    if (isValidRebuttalTarget(graph, edge.to, owner, from.round)) {
      refs.push(edgeRef(edge, nodes, "Direct response edge"));
    }
  }
  return refs;
}

/**
 * Impact handling: are the side's impact moves linked to arguments, grounded
 * where possible, and explicitly weighed?
 */
export function impactHandling(
  graph: ArgGraph,
  owner: Owner,
  links: SupportLink[],
): { value: number; evidence: EvidenceRef[] } {
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
  const comparisonLanguage = impacts.filter((node) =>
    /\b(because|therefore|cost|benefit|risk|harm|trade[- ]?off|outweigh|more important|less important|impact|matters|leads to)\b/i.test(node.text),
  );
  const linkedRate = linkedIds.size / impacts.length;
  const groundedRate = groundedIds.size / impacts.length;
  const comparisonRate = comparisonLanguage.length / impacts.length;
  evidence.push(...comparisonLanguage.map((node) => nodeRef(node, "Explicit impact/comparison language")));
  const value = Math.max(0, Math.min(1, 0.5 * linkedRate + 0.3 * groundedRate + 0.2 * comparisonRate));
  return { value, evidence: evidence.length ? evidence : impacts.map((node) => nodeRef(node)) };
}

export { engineReport };
/**
 * Build every observable feature for one side of a debate.
 *
 * `opponent` is whoever the other side is ("ai" in solo debates, "b" in PvP).
 * The same function serves both, so a solo debate and a PvP debate are
 * measured by exactly the same rules.
 */
export function buildSideFeatures(
  graph: ArgGraph,
  owner: Owner,
  opponent: Owner,
  extractionConfidence: number,
): SideObservableFeatures {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const ownClaims = graph.nodes.filter((node) => node.owner === owner && isClaimLike(node));
  const ownEvidence = graph.nodes.filter((node) => node.owner === owner && node.kind === "evidence");
  const links = supportLinks(graph).filter((link) => link.claim.owner === owner || link.evidence.owner === owner);
  const ownLinks = links.filter((link) => link.claim.owner === owner && link.evidence.owner === owner);
  const byClaim = new Map<string, SupportLink[]>();
  for (const link of ownLinks) byClaim.set(link.claim.id, [...(byClaim.get(link.claim.id) ?? []), link]);
  const explicitUnsupported = new Set(graph.evidenceStats.unsupportedClaimIds);
  const directlySupportedClaims = ownClaims.filter((claim) => byClaim.has(claim.id) && !explicitUnsupported.has(claim.id));
  const citedEvidence = ownEvidence.filter((node) => (node.citations ?? []).some((citation) => !!citation.sourceName?.trim()));

  const relevanceRefs = ownLinks.flatMap((link) => [
    nodeRef(link.claim, `Evidence relevance ${round(link.relevance)}`),
    nodeRef(link.evidence, `Evidence relevance ${round(link.relevance)}`),
  ]);
  const evidenceRelevance = ownLinks.length ? ownLinks.reduce((sum, link) => sum + link.relevance, 0) / ownLinks.length : 0;

  const rebuttalRefs = directRebuttalRefs(graph, owner, nodes);
  // CANONICAL rebuttal coverage (opportunity.ts): the exact same reading
  // rewards, the skill ledger, Progress and the result story compute. The score
  // path treats unmeasurable (null) as 0 with the feature status carrying
  // "insufficient_evidence" - the numeric value can never disagree across
  // systems because it comes from one implementation.
  const canonicalCoverage = rebuttalCoverageFor(graph, owner);
  const rebuttalCoverage = canonicalCoverage.value ?? 0;
  // Exact trails from the canonical reading: eligible opportunities, each
  // marked answered or unmatched, plus the valid direct responses. Nodes
  // excluded by the canonical scope (last-round moves, impacts, evidence)
  // never appear here.
  const responseRefs = [
    ...eligibleOpponentMoves(graph, owner).map((node) =>
      nodeRef(node, canonicalCoverage.answeredIds.includes(node.id) ? "Answered" : "No direct response recorded"),
    ),
    ...rebuttalRefs,
  ];

  // Argument ENGAGEMENT (broader than rebuttal coverage): per-round view of
  // whether the side engaged any opponent argument move (claim/counterclaim/
  // impact). A round counts as responded when any of its engagement
  // opportunities was validly answered.
  const engagementOpportunities = engagementOpportunitiesFor(graph, owner);
  const responseTargets = addressedTargetIds(graph, owner);
  const responseRounds = [...new Set(engagementOpportunities.map((node) => node.round))].sort((a, b) => a - b);
  const respondedRounds = responseRounds.filter((roundNumber) =>
    engagementOpportunities.some((node) => node.round === roundNumber && responseTargets.has(node.id)),
  );
  const argumentResponseRate = responseRounds.length ? respondedRounds.length / responseRounds.length : 0;

  // OWN arguments the opponent never validly answered - the canonical mirror
  // of detectDropped (opportunity.ts): the opponent's unanswered-opportunity
  // set restricted to this side's argument moves. Evidence and impact nodes
  // are not rebuttal opportunities and cannot appear here.
  const ownDropped = unansweredOpportunitiesBy(graph, opponent).filter((node) => node.owner === owner);
  const unsupportedAssertions = ownClaims.filter((claim) => !byClaim.has(claim.id) || explicitUnsupported.has(claim.id));

  const contradictions = graph.contradictions.filter((item) => item.owner === owner && nodes.has(item.a) && nodes.has(item.b));
  const deterministicContradictions = detectContradictions(graph.nodes).filter(
    (item) => item.owner === owner && nodes.has(item.a) && nodes.has(item.b),
  );
  const contradictionKeys = new Set(contradictions.map((item) => `${item.a}:${item.b}`));
  const allContradictions = [
    ...contradictions,
    ...deterministicContradictions.filter((item) => !contradictionKeys.has(`${item.a}:${item.b}`)),
  ];

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
  const directSupportEvidence = directlySupportedClaims.flatMap((claim) => [
    nodeRef(claim, "Direct support edge"),
    ...(byClaim.get(claim.id) ?? []).flatMap((link) => (link.edge ? [edgeRef(link.edge, nodes)] : [])),
  ]);
  const citedEvidenceRefs = citedEvidence.flatMap((node) => [nodeRef(node, "Citation supplied"), ...citationRefs(node)]);
  const droppedRefs = ownDropped.map((node) => nodeRef(node, "Opponent had a later turn but no target response"));
  const contradictionRefs = allContradictions.flatMap((item) => [
    nodeRef(nodes.get(item.a)!, item.explanation),
    nodeRef(nodes.get(item.b)!, item.explanation),
  ]);
  const concessionRefs = concessions.map((item) => nodeRef(nodes.get(item.nodeId)!, item.note));

  const confidence = extractionConfidence;
  return {
    owner,
    claimsMade: feature(ownClaims.length, claimEvidence, confidence),
    claimsDirectlySupported: feature(directlySupportedClaims.length, directSupportEvidence.length ? directSupportEvidence : claimEvidence, confidence),
    evidenceActuallyCited: feature(citedEvidence.length, citedEvidenceRefs.length ? citedEvidenceRefs : ownEvidence.map((node) => nodeRef(node, "No usable citation supplied")), confidence),
    evidenceRelevance: feature(round(evidenceRelevance), relevanceRefs.length ? relevanceRefs : ownEvidence.map((node) => nodeRef(node, "No claim link to assess relevance")), confidence),
    directRebuttals: feature(rebuttalRefs.filter((ref) => ref.kind === "node").length, rebuttalRefs, confidence),
    rebuttalCoverage: feature(
      round(rebuttalCoverage),
      responseRefs.length ? responseRefs : eligibleOpponentMoves(graph, owner).map((node) => nodeRef(node, "No direct response recorded")),
      confidence,
      canonicalCoverage.opportunities ? undefined : "insufficient_evidence",
    ),
    // SCOPING NOTE: droppedArguments counts this side's OWN arguments that the
    // opponent ignored - a scoring input (credit via groundedDroppedArguments),
    // NOT a weakness measure. A side's rebuttal failure is the opponent's
    // unanswered arguments (see repairEffectiveness.countWeaknessesForSide).
    droppedArguments: feature(ownDropped.length, droppedRefs.length ? droppedRefs : ownClaims.map((node) => nodeRef(node, "No dropped argument observed")), confidence),
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
