// Evidence verification: live URL fetch, claim→citation mapping, distortion
// / cherry-pick / outdated / strength signals. Offline-friendly (graceful
// fallbacks when network is unavailable) and pure-testable.

import type { ArgGraph, ArgNode } from "./argGraph";
import {
  citationIdentityCheck,
  graphSourceQuality,
  verifyGraphCitations,
  KNOWN_SOURCES,
} from "./citationVerifier";
import { verifyEvidenceQuotes, claimSourceMatch } from "./quoteVerification";
import { retrieveSource, type RetrievedSource } from "./sourceRetrieval";

// ---------------------------------------------------------------------------
// Fetch & freshness (live, best-effort)
// ---------------------------------------------------------------------------

export interface FetchedSource {
  url: string;
  ok: boolean;
  status?: number;
  finalUrl?: string;
  title?: string;
  snippet?: string; // first ~500 chars of text content
  fetchedAt: string;
  error?: string;
  isOutdated?: boolean; // heuristic: content contains an old date far from today
}

const FETCH_TIMEOUT_MS = 8_000;

export function fetchedSourceFromRetrieved(source: RetrievedSource): FetchedSource {
  const snippet = source.snippet?.slice(0, 500);
  const dateText = `${source.publicationDate ?? ""} ${snippet ?? ""}`.trim();
  const isOutdated = dateText ? detectOutdatedFromText(dateText) : null;
  const ok = source.sourceStatus === "retrieved";
  const error = ok
    ? undefined
    : [source.failureStatus, source.failureDetails].filter(Boolean).join(": ") || source.sourceStatus;
  return {
    url: source.url,
    ok,
    status: source.httpStatus,
    finalUrl: source.finalUrl,
    title: source.title,
    snippet,
    fetchedAt: source.retrievalDate,
    error,
    isOutdated: isOutdated ?? undefined,
  };
}

export async function fetchSource(url: string): Promise<FetchedSource> {
  // One authoritative live-fetch boundary. DNS resolution, every redirect
  // hop, private/link-local targets, content type, timeout and body size are
  // all handled by sourceRetrieval.ts before verification sees the result.
  return fetchedSourceFromRetrieved(await retrieveSource(url, { timeoutMs: FETCH_TIMEOUT_MS }));
}

function detectOutdatedFromText(text: string): boolean | null {
  // Look for 4-digit years; if the most recent year is >3 years old, flag outdated
  const years = [...text.matchAll(/\b(20\d{2})\b/g)].map((m) => parseInt(m[1], 10));
  if (!years.length) return null;
  const maxY = Math.max(...years);
  const nowY = new Date().getFullYear();
  return nowY - maxY > 3;
}

export async function fetchGraphSources(graph: ArgGraph): Promise<Map<string, FetchedSource>> {
  const urls = new Set<string>();
  for (const n of graph.nodes) for (const c of n.citations ?? []) if (c.homepage) urls.add(c.homepage);
  const entries = await Promise.all([...urls].map(async (u) => [u, await fetchSource(u)] as const));
  return new Map(entries);
}

// ---------------------------------------------------------------------------
// Claim → citation mapping (explicit evidence strength)
// ---------------------------------------------------------------------------

export type CitationSupport = "supports" | "tangential" | "unsupported" | "unverified" | "contradicted";
export interface ClaimCitationLink {
  claimId: string;
  claimText: string;
  evidenceId: string | null;
  strength: ArgNode["evidenceStrength"] | null;
  citations: ArgNode["citations"];
  support: CitationSupport;
  sourceQuality: number; // 0..1
  fetched?: FetchedSource;
  flags: string[]; // e.g. hallucination, outdated, distortion
}

export function claimCitationMap(graph: ArgGraph, fetchedByUrl?: Map<string, FetchedSource>): ClaimCitationLink[] {
  const evidenceById = new Map(graph.nodes.filter((n) => n.kind === "evidence").map((n) => [n.id, n]));
  const links: ClaimCitationLink[] = [];
  const claims = graph.nodes.filter((n) => n.kind === "claim");
  for (const claim of claims) {
    // Evidence that supports this claim (via edges)
    const supporting = graph.edges
      .filter((e) => e.relation === "supports" && (e.from === claim.id || e.to === claim.id))
      .map((e) => (e.from === claim.id ? e.to : e.from))
      .map((id) => evidenceById.get(id))
      .filter(Boolean) as ArgNode[];
    if (!supporting.length) {
      links.push({ claimId: claim.id, claimText: claim.text, evidenceId: null, strength: null, citations: undefined, support: "unsupported", sourceQuality: 0, flags: ["no evidence"] });
      continue;
    }
    for (const ev of supporting) {
      const cites = ev.citations ?? [];
      const quality = cites.length ? Math.max(...cites.map((c) => qualityFor(c.sourceName))) : 0.3;
      const flags: string[] = [];
      if ((ev.evidenceStrength === "cited" || ev.evidenceStrength === "strong") && !cites.length) flags.push("hallucination: cited without source");
      for (const c of cites) {
        const f = fetchedByUrl?.get(c.homepage ?? "");
        if (f && !f.ok) flags.push(`fetch failed: ${c.sourceName} (${f.error})`);
        if (f?.isOutdated) flags.push(`outdated: ${c.sourceName} page appears stale`);
      }
      // Distortion heuristic: claim text makes a stronger assertion than evidence text
      const distortion = distortionScore(claim.text, ev.text);
      if (distortion > 0.6) flags.push(`possible distortion: claim stronger than evidence (score ${distortion.toFixed(2)})`);
      // Quote verification: quoted spans in the evidence must appear in a cited excerpt
      const quoteReport = verifyEvidenceQuotes(ev.text ?? "", cites);
      for (const q of quoteReport.fabricated) flags.push(`fabricated quote: "${q.quote}"`);
      for (const q of quoteReport.issues) if (q.status === "misquoted") flags.push(`misquoted: "${q.quote}"`);
      // Claim-to-source matching: the claim's content must appear in a cited excerpt
      const claimSource = claimSourceMatch(claim.text, cites);
      if (claimSource.status === "mismatched") flags.push(`claim not supported by source: ${claimSource.bestSource} (overlap ${claimSource.score.toFixed(2)})`);
      else if (claimSource.status === "weak") flags.push(`weak claim-source overlap: ${claimSource.bestSource} (overlap ${claimSource.score.toFixed(2)})`);
      else if (claimSource.status === "unverifiable") flags.push("claim-source support unverified — no source excerpt attached");

      // claimSource.bestSource is copied directly from the citation whose
      // excerpt matched best. Bind that source name to its registered domain
      // before allowing the text match to count as positive support.
      const bestCitation = claimSource.bestSource
        ? cites.find((citation) => citation.sourceName === claimSource.bestSource)
        : undefined;
      const identity = bestCitation ? citationIdentityCheck(bestCitation) : null;
      const identityVerified = identity?.verified === true;
      if (claimSource.status !== "unverifiable" && !identityVerified) {
        flags.push(`source identity unverified: ${identity?.reason ?? "best matching citation could not be identified"}`);
      }

      // Positive support is deliberately narrow: the source text must match
      // AND the source identity must match its registered root domain.
      const support: CitationSupport =
        flags.some((f) => f.includes("hallucination") || f.includes("no evidence"))
          ? "unsupported"
          : claimSource.status === "unverifiable" || !identityVerified
            ? "unverified"
            : distortion > 0.6 || claimSource.status === "mismatched" || claimSource.status === "weak"
              ? "tangential"
              : "supports";
      links.push({
        claimId: claim.id,
        claimText: claim.text,
        evidenceId: ev.id,
        strength: ev.evidenceStrength ?? null,
        citations: cites,
        support,
        sourceQuality: quality,
        fetched: cites[0]?.homepage ? fetchedByUrl?.get(cites[0].homepage) : undefined,
        flags,
      });
    }
  }
  return links;
}

function qualityFor(name: string): number {
  const tier = (KNOWN_SOURCES[name.toLowerCase().trim()]?.tier ?? 3) as 1 | 2 | 3;
  return tier === 1 ? 0.95 : tier === 2 ? 0.75 : 0.35;
}

// ---------------------------------------------------------------------------
// Distortion / cherry-pick / outdated heuristics (pure, testable)
// ---------------------------------------------------------------------------

const INTENSIFIERS = /\b(always|never|all|every|proves|undeniably|certainly|definitively|100%|everyone)\b/gi;
const HEDGES = /\b(may|might|could|suggests|indicates|some|many|preliminary|limited)\b/gi;

/** 0..1: how much stronger the claim wording is vs the evidence wording. */
export function distortionScore(claimText: string, evidenceText: string): number {
  const ci = (claimText.match(INTENSIFIERS) ?? []).length;
  const ch = (claimText.match(HEDGES) ?? []).length;
  const ei = (evidenceText.match(INTENSIFIERS) ?? []).length;
  const eh = (evidenceText.match(HEDGES) ?? []).length;
  // Claim with intensifiers + evidence with hedges => distortion
  const claimStrength = Math.max(0, ci - ch * 0.5);
  const evStrength = Math.max(0, ei - eh * 0.5);
  if (claimStrength === 0) return 0;
  // If evidence is hedged and claim is intensified, high distortion
  if (evStrength === 0 && claimStrength > 0 && eh > 0) return 0.8;
  return Math.max(0, Math.min(1, (claimStrength - evStrength) / Math.max(1, claimStrength)));
}

export interface CherryPickSignal {
  atRisk: boolean;
  reason: string;
  singleSource: boolean;
  narrowWindow?: boolean;
}

/** Flag evidence that relies on a single source or single-year window when the claim is broad. */
export function cherryPickSignal(claimText: string, evidenceNodes: ArgNode[]): CherryPickSignal {
  const broad = /\b(always|all|every|global|worldwide|decade|century)\b/i.test(claimText);
  const sources = new Set(evidenceNodes.flatMap((n) => (n.citations ?? []).map((c) => c.sourceName.toLowerCase())));
  const singleSource = sources.size <= 1 && evidenceNodes.length > 0;
  const atRisk = broad && singleSource;
  return {
    atRisk,
    singleSource,
    reason: atRisk ? `Broad claim ("${claimText.slice(0, 60)}") backed by single source — cherry-pick risk` : singleSource ? "Single source only" : "Multiple sources",
  };
}

export interface GraphEvidenceReport {
  score: number; // 0..1 overall evidence strength (quality × coverage × freshness)
  coverage: number; // 0..1 claims with grounded evidence
  avgQuality: number; // 0..1
  outdatedCount: number;
  distortionCount: number;
  hallucinationCount: number;
  quoteIssueCount: number; // misquoted + fabricated quoted spans
  fabricatedQuoteCount: number;
  claimMismatchCount: number; // claims whose content doesn't appear in any cited excerpt
  weakClaimSourceCount: number; // claims with only partial overlap against cited excerpts
  links: ClaimCitationLink[];
  graphIssues: ReturnType<typeof verifyGraphCitations>;
}

export function graphEvidenceReport(graph: ArgGraph, fetchedByUrl?: Map<string, FetchedSource>): GraphEvidenceReport {
  const links = claimCitationMap(graph, fetchedByUrl);
  const claims = graph.nodes.filter((n) => n.kind === "claim").length || 1;
  const grounded = links.filter((l) => l.support === "supports").length;
  const coverage = grounded / claims;
  const avgQuality = graphSourceQuality(graph);
  const outdatedCount = links.filter((l) => l.flags.some((f) => f.includes("outdated"))).length;
  const distortionCount = links.filter((l) => l.flags.some((f) => f.includes("distortion"))).length;
  const hallucinationCount = verifyGraphCitations(graph).length;
  const fabricatedQuoteCount = links.filter((l) => l.flags.some((f) => f.includes("fabricated quote"))).length;
  const quoteIssueCount = links.filter((l) => l.flags.some((f) => f.includes("fabricated quote") || f.includes("misquoted:"))).length;
  const claimMismatchCount = links.filter((l) => l.flags.some((f) => f.includes("claim not supported by source"))).length;
  const weakClaimSourceCount = links.filter((l) => l.flags.some((f) => f.includes("weak claim-source overlap"))).length;
  // Freshness penalty: each outdated link docks 0.1
  const freshness = Math.max(0, 1 - outdatedCount * 0.15);
  // Fabricated quotes dock the score — a quote that isn't in the source is worse than no citation
  const quoteIntegrity = Math.max(0.5, 1 - fabricatedQuoteCount * 0.2);
  // A claim whose content is absent from its cited source is a decorative citation — dock it too
  const claimIntegrity = Math.max(0.5, 1 - claimMismatchCount * 0.2);
  const score = Math.max(0, Math.min(1, avgQuality * (0.5 + 0.5 * coverage) * freshness * (hallucinationCount ? 0.6 : 1) * quoteIntegrity * claimIntegrity));
  return { score, coverage, avgQuality, outdatedCount, distortionCount, hallucinationCount, quoteIssueCount, fabricatedQuoteCount, claimMismatchCount, weakClaimSourceCount, links, graphIssues: verifyGraphCitations(graph) };
}
