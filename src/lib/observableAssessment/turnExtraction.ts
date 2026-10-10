// Deterministic turn extraction.
//
// Turns that no model assessed (solo debates, fallback paths) still need a
// real argument graph so the SAME scorer can read them. This extractor builds
// that graph from the visible text alone - no API call, no model opinion -
// using explicit surface signals for support, engagement and impact.

import { emptyGraph, type ArgGraph, type ArgEdge, type ArgNode } from "../argGraph";
import { classifyFallacies, detectConcessions, detectContradictions } from "../graphEnrichers";
import { recomputeEvidenceStats, tokens } from "./graphEnrichment";

/**
 * Maximum characters of a turn stored on an ArgNode.
 *
 * Must be >= the largest input the API accepts (6000; see isSuspiciousLength
 * and aiSchema's isNonEmptyString(..., 16, 6000)) so that deterministic
 * enrichers (fallacy / contradiction / concession detection) see the full
 * turn. A smaller bound created a fidelity gap: signals after the cutoff were
 * silently never detected.
 *
 * Display excerpts are still truncated separately in `nodeRef` (240 chars), so
 * this only affects what the scorer can observe, not how it is shown.
 */
export const NODE_TEXT_CAP = 6000;

/**
 * Offline source-recognition table.
 *
 * A name only counts as a citation when it appears in the text AND maps to a
 * known institution; an unrecognised name is never promoted to a source.
 * Two names need disambiguation because they are common English words.
 */
const KNOWN_SOURCES: Array<[string, string, RegExp?]> = [
  ["Pew Research Center", "pew research center|pew"],
  ["Lazard", "lazard"],
  ["NREL", "nrel"],
  ["IEA", "iea"],
  ["OECD", "oecd"],
  ["NIST", "nist"],
  ["Stanford HAI", "stanford hai"],
  ["Brookings", "brookings"],
  ["Bruegel", "bruegel"],
  ["WHO", "who", /\bWHO\b|\bWorld Health Organization\b/],
  ["IMF", "imf"],
  ["Reuters", "reuters"],
  ["Nature", "nature", /\b(?:published in|journal|according to) Nature\b|\bNature (?:journal|reports?|study|article)\b/],
];

const SOURCE_HOMEPAGES: Record<string, string> = {
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

export function citationFromText(text: string): Array<{ sourceName: string; homepage: string }> {
  const out: Array<{ sourceName: string; homepage: string }> = [];
  const seen = new Set<string>();
  for (const [display, pattern, disambiguation] of KNOWN_SOURCES) {
    const regex = disambiguation ?? new RegExp(`\\b(?:${pattern})\\b`, "i");
    if (!regex.test(text) || seen.has(display)) continue;
    seen.add(display);
    out.push({ sourceName: display, homepage: SOURCE_HOMEPAGES[display] });
  }
  return out;
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

const EVIDENCE_SENTENCE =
  /\b(according to|study|studies|data|report|survey|research|analysis|finds?|shows?|%|\$\d|\d{2,})\b/i;
const RESPONSE_PATTERN =
  /\b(but|however|although|while|even if|your point|you say|you argue|that ignores|in response|because|instead)\b/i;
const IMPACT_PATTERN =
  /\b(therefore|so|means|impact|benefit|cost|risk|harm|helps|matters|leads to|results in)\b/i;

/** Deterministic fallback/extractor for solo turn assessment. */
export function graphFromTurn(params: {
  userMessage: string;
  opponentMessage: string;
  round: number;
}): ArgGraph {
  const userMessage = params.userMessage.trim();
  const opponentMessage = params.opponentMessage.trim();
  const nodes: ArgNode[] = [];
  const edges: ArgEdge[] = [];
  const opponentId = opponentMessage ? `r${params.round}-opponent` : null;
  // The opponent's opener PRECEDES this round's response (round - 1, floor 0):
  // canonical rebuttal chronology requires the response strictly after the
  // target, so round-1 answers must not share their target's round.
  if (opponentId) {
    nodes.push({
      id: opponentId,
      kind: "counterclaim",
      owner: "ai",
      text: opponentMessage.slice(0, NODE_TEXT_CAP),
      round: Math.max(0, params.round - 1),
    });
  }
  const claimId = `r${params.round}-claim`;
  nodes.push({ id: claimId, kind: "claim", owner: "a", text: userMessage.slice(0, NODE_TEXT_CAP), round: params.round });

  const sentences = splitSentences(userMessage);
  const evidenceSentences = sentences.filter(
    (sentence) => EVIDENCE_SENTENCE.test(sentence) || citationFromText(sentence).length > 0,
  );
  evidenceSentences.slice(0, 3).forEach((sentence, index) => {
    const citations = citationFromText(sentence);
    const evidenceId = `r${params.round}-evidence-${index + 1}`;
    nodes.push({
      id: evidenceId,
      kind: "evidence",
      owner: "a",
      text: sentence.slice(0, NODE_TEXT_CAP),
      round: params.round,
      evidenceStrength: citations.length ? "cited" : "general",
      citations: citations.map((citation) => ({ sourceName: citation.sourceName, homepage: citation.homepage })),
    });
    edges.push({ from: evidenceId, to: claimId, relation: "supports" });
  });

  const shared =
    opponentMessage &&
    [...tokens(opponentMessage)].filter((token) => tokens(userMessage).has(token)).length >= 2;
  if (opponentId && (RESPONSE_PATTERN.test(userMessage) || shared)) {
    const rebuttalId = `r${params.round}-rebuttal`;
    nodes.push({
      id: rebuttalId,
      kind: "rebuttal",
      owner: "a",
      text: userMessage.slice(0, NODE_TEXT_CAP),
      round: params.round,
      targets: [opponentId],
    });
    edges.push({ from: rebuttalId, to: opponentId, relation: "rebuts" });
  }
  if (IMPACT_PATTERN.test(userMessage)) {
    const impactId = `r${params.round}-impact`;
    nodes.push({ id: impactId, kind: "impact", owner: "a", text: userMessage.slice(0, NODE_TEXT_CAP), round: params.round });
    edges.push({ from: claimId, to: impactId, relation: "impacts" });
  }
  const fallacies = nodes.flatMap((node) =>
    classifyFallacies(node.text).map((hit) => ({
      nodeId: node.id,
      fallacy: hit.fallacy,
      note: `Extracted hint: ${hit.matched}` as string,
    })),
  );
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
