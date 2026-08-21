// Quote verification: does the quoted text actually appear in the cited source?
// Pure + offline — we verify against the excerpt a player/judge attached to a
// citation (the allowlist floor in citationVerifier), and against a fetched
// snippet when one is available. No network here; live fetching lives in
// evidenceVerification.ts.
//
// A quote is:
//   verified     — appears verbatim (modulo case/punctuation) in the source text
//   paraphrase   — close but not verbatim; the player is quoting from memory
//   misquoted    — deviates substantially; the quote misrepresents the source
//   fabricated   — the source text does not contain it at all
//   unverifiable — no source text was attached, so we cannot check

import type { EvidenceCitation } from "./argGraph";
import { sourceQualityScore, sourceDateCheck } from "./citationVerifier";
import type { SourceDateCheck } from "./citationVerifier";

export type QuoteStatus = "verified" | "paraphrase" | "misquoted" | "fabricated" | "unverifiable";

export interface QuoteCheck {
  quote: string;
  status: QuoteStatus;
  score: number; // 0..1 fuzzy match against the source text
  reason: string;
  sourceTextPresent: boolean;
}

/** Lowercase, strip quote marks and punctuation, collapse whitespace. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/["“”«»'’]/g, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Double quotes and guillemets only — single quotes over-match apostrophes.
const QUOTE_RE = /["“«]([^"”»]{4,120})["”»]/g;

/** Pull quoted spans out of claim/evidence text. */
export function extractQuotes(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(QUOTE_RE)) {
    const q = m[1].trim();
    if (q.length >= 4) out.push(q);
  }
  return out;
}

function tokens(s: string): string[] {
  return normalizeText(s).split(/\s+/).filter(Boolean);
}

// Words that carry little semantic signal for quote-matching; counting them
// would let a fabricated "nuclear is the cheapest" look plausible next to any
// source that mentions "is the cheapest".
const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "of", "to", "in", "on",
  "and", "or", "for", "with", "at", "by", "from", "per", "as", "that", "this", "it",
  "its", "than", "more", "most", "not", "no", "but", "so", "if", "we", "you", "they",
]);

export function contentTokens(s: string): string[] {
  return tokens(s).filter((t) => !STOPWORDS.has(t));
}

/**
 * 0..1 — share of the quote's content (non-stopword) tokens found in the
 * source text, order-insensitive. A verbatim quote scores 1 because
 * containment is checked first; a fabricated one scores near 0.
 */
export function quoteMatchScore(quote: string, sourceText: string): number {
  const q = contentTokens(quote);
  if (!q.length) return 0;
  const present = new Set(contentTokens(sourceText));
  const hits = q.filter((t) => present.has(t)).length;
  return hits / q.length;
}

export function verifyQuote(quote: string, sourceText: string | null | undefined): QuoteCheck {
  const trimmed = quote.trim();
  if (!trimmed) {
    return { quote, status: "unverifiable", score: 0, reason: "Empty quote.", sourceTextPresent: !!sourceText?.trim() };
  }
  if (!sourceText?.trim()) {
    return { quote: trimmed, status: "unverifiable", score: 0, reason: "No source text attached — cannot verify the quote.", sourceTextPresent: false };
  }
  const nq = normalizeText(trimmed);
  const ns = normalizeText(sourceText);
  if (!ns) {
    return { quote: trimmed, status: "unverifiable", score: 0, reason: "Source text is empty.", sourceTextPresent: true };
  }
  if (ns.includes(nq)) {
    return { quote: trimmed, status: "verified", score: 1, reason: "Quote appears verbatim in the source (case/punctuation aside).", sourceTextPresent: true };
  }
  const score = quoteMatchScore(trimmed, sourceText);
  if (score >= 0.75) {
    return { quote: trimmed, status: "paraphrase", score, reason: "Close to the source but not verbatim — paraphrase, not a direct quote.", sourceTextPresent: true };
  }
  if (score >= 0.4) {
    return { quote: trimmed, status: "misquoted", score, reason: "Quote deviates substantially from the source text.", sourceTextPresent: true };
  }
  return { quote: trimmed, status: "fabricated", score, reason: "Quote does not appear in the source text — possible fabrication.", sourceTextPresent: true };
}

export interface EvidenceQuoteReport {
  quotes: QuoteCheck[];
  total: number;
  verifiedCount: number;
  issues: QuoteCheck[]; // misquoted + fabricated
  fabricated: QuoteCheck[];
  worstStatus: QuoteStatus; // the weakest status present ("verified" when no quotes)
  fidelity: number; // 0..1 quote dimension for evidence-quality scoring
}

const STATUS_RANK: Record<QuoteStatus, number> = {
  verified: 4,
  paraphrase: 3,
  unverifiable: 2,
  misquoted: 1,
  fabricated: 0,
};

const STATUS_FIDELITY: Record<QuoteStatus, number> = {
  verified: 1,
  paraphrase: 0.8,
  unverifiable: 0.6, // not a violation — we just can't tell
  misquoted: 0.4,
  fabricated: 0,
};

/**
 * Check every quoted span in an evidence node against its citations' excerpts.
 * A quote is verified if ANY cited source contains it (best source wins).
 */
export function verifyEvidenceQuotes(evidenceText: string, citations: EvidenceCitation[]): EvidenceQuoteReport {
  const raw = extractQuotes(evidenceText);
  if (!raw.length) {
    return { quotes: [], total: 0, verifiedCount: 0, issues: [], fabricated: [], worstStatus: "verified", fidelity: 1 };
  }
  const withSource = citations.filter((c) => c.excerpt?.trim());
  const quotes = raw.map((q) => {
    if (!withSource.length) return verifyQuote(q, null);
    const results = withSource.map((c) => verifyQuote(q, c.excerpt));
    return results.reduce((best, r) => (STATUS_RANK[r.status] > STATUS_RANK[best.status] ? r : best));
  });
  const issues = quotes.filter((c) => c.status === "misquoted" || c.status === "fabricated");
  const fabricated = quotes.filter((c) => c.status === "fabricated");
  const worstStatus = quotes.reduce<QuoteStatus>((w, c) => (STATUS_RANK[c.status] < STATUS_RANK[w] ? c.status : w), "verified");
  const fidelity = quotes.reduce((sum, c) => sum + STATUS_FIDELITY[c.status], 0) / quotes.length;
  return {
    quotes,
    total: quotes.length,
    verifiedCount: quotes.filter((c) => c.status === "verified").length,
    issues,
    fabricated,
    worstStatus,
    fidelity,
  };
}

export interface EvidenceQuality {
  score: number; // 0..1 — source tier (50%) × quote fidelity (35%) × date recency (15%)
  source: number; // 0..1 from source tier
  quote: number; // 0..1 quote dimension
  date: number; // 0..1 recency dimension
  flags: string[];
}

export interface EvidenceQualityInput {
  sourceName: string;
  excerpt?: string; // source text available for quote checks
  quotes?: string[]; // quoted spans from the evidence (optional — auto-extracted otherwise)
  evidenceText?: string; // auto-extract quotes from here when provided
  dateCheck?: SourceDateCheck;
}

/**
 * Evidence-quality scoring with quote + date dimensions (roadmap §4):
 * - source tier (existing `sourceQualityScore`)
 * - quote fidelity — verified quotes raise, fabricated quotes crater
 * - date recency — stale sources are docked
 */
export function evidenceQualityScore(input: EvidenceQualityInput): EvidenceQuality {
  const flags: string[] = [];
  const source = sourceQualityScore(input.sourceName);

  const quoteReport = verifyEvidenceQuotes(
    input.evidenceText ?? (input.quotes?.length ? input.quotes.map((q) => `"${q}"`).join(" ") : ""),
    input.excerpt ? [{ sourceName: input.sourceName, excerpt: input.excerpt } as EvidenceCitation] : [],
  );
  const quote = quoteReport.fidelity;
  for (const c of quoteReport.fabricated) flags.push(`fabricated quote: ${c.quote.slice(0, 60)}`);
  for (const c of quoteReport.issues) if (c.status === "misquoted") flags.push(`misquoted: ${c.quote.slice(0, 60)}`);
  if (quoteReport.quotes.length && !input.excerpt?.trim()) flags.push("quotes unverifiable — attach a source excerpt");

  const date = input.dateCheck
    ? input.dateCheck.isOutdated
      ? 0.3
      : input.dateCheck.hasYear
        ? 1
        : 0.7
    : 1;
  if (input.dateCheck?.isOutdated) flags.push("outdated source");

  const score = Math.max(0, Math.min(1, 0.5 * source + 0.35 * quote + 0.15 * date));
  return { score, source, quote, date, flags };
}

// ---------------------------------------------------------------------------
// Claim → source matching
// ---------------------------------------------------------------------------

export type ClaimSourceStatus = "supported" | "weak" | "mismatched" | "unverifiable";

export interface ClaimSourceMatch {
  claim: string;
  score: number; // 0..1 — content-token overlap between claim and best cited excerpt
  status: ClaimSourceStatus;
  bestSource: string | null;
  reason: string;
}

/**
 * 0..1 — share of the claim's content (non-stopword) tokens found in a source
 * excerpt, order-insensitive. Claims paraphrase rather than quote, so overlap
 * is measured instead of containment.
 */
export function claimMatchScore(claim: string, sourceText: string): number {
  const c = contentTokens(claim);
  if (!c.length) return 0;
  const present = new Set(contentTokens(sourceText));
  return c.filter((t) => present.has(t)).length / c.length;
}

/**
 * Does the claim's content actually appear in the cited source? The best
 * matching cited excerpt wins. "Supported" requires at least 2 content-token
 * hits — a claim that only repeats the source's name is not evidence of
 * agreement. No excerpts attached → unverifiable (no verdict, not a violation).
 */
export function claimSourceMatch(
  claim: string,
  sources: Array<{ sourceName: string; excerpt?: string; homepage?: string }>,
): ClaimSourceMatch {
  const withText = sources.filter((s) => s.excerpt?.trim());
  if (!withText.length) {
    return { claim, score: 0, status: "unverifiable", bestSource: null, reason: "No source excerpt attached — claim-to-source matching unavailable." };
  }
  let best: { score: number; sourceName: string; sourceText: string } | null = null;
  for (const s of withText) {
    const score = claimMatchScore(claim, s.excerpt!);
    if (!best || score > best.score) best = { score, sourceName: s.sourceName, sourceText: s.excerpt! };
  }
  const { score, sourceName, sourceText } = best!;
  const present = new Set(contentTokens(sourceText));
  const hits = contentTokens(claim).filter((t) => present.has(t)).length;
  let status: ClaimSourceStatus;
  let reason: string;
  if (score >= 0.5 && hits >= 2) {
    status = "supported";
    reason = `Claim content overlaps ${sourceName} excerpt (overlap ${score.toFixed(2)}).`;
  } else if (score >= 0.25) {
    status = "weak";
    reason = `Claim content only partially overlaps ${sourceName} excerpt (overlap ${score.toFixed(2)}).`;
  } else {
    status = "mismatched";
    reason = `Claim content does not appear in ${sourceName} excerpt (overlap ${score.toFixed(2)}) — the citation does not support the claim.`;
  }
  return { claim, score, status, bestSource: sourceName, reason };
}

// Re-exported for convenience so callers can compose with the recency helper.
export { sourceDateCheck };
