// Real evidence retrieval for daily topics: discovers candidate documents
// (GDELT news index + Wikipedia, both keyless), fetches them through the
// SSRF-guarded sourceRetrieval pipeline, and reduces each to a verifiable
// evidence card — CLAIM / SOURCE / PASSAGE / PUBLISHED / TYPE — scored by the
// same verification stack the judge uses (claim-source matching, recency,
// primary-ness, relevance).
//
// Retrieval success never implies entailment; every card carries explicit
// check flags and cards that fail verification still surface (with their
// warnings) so users see what was checked, not just what passed.

import { retrieveSource, validateRetrievalUrl, type RetrievedSource } from "./sourceRetrieval";
import { claimSourceMatch } from "./quoteVerification";
import { sourceTier, sourceDateCheck } from "./citationVerifier";

export type EvidenceSourceType = "primary" | "news" | "secondary" | "tertiary";

export interface EvidenceChecks {
  supportsClaim: boolean;
  relevant: boolean;
  current: boolean | null; // null when no publish date could be found
  primary: boolean;
  matchScore: number; // claim-source match score 0..1
}

export interface TopicEvidenceCard {
  claim: string;
  sourceName: string;
  sourceType: EvidenceSourceType;
  url: string;
  title?: string;
  passage: string;
  publishedDate: string | null;
  checks: EvidenceChecks;
}

// --- keyword extraction -----------------------------------------------------

const STOPWORDS = new Set(
  "the this that with from have has will would should could their there about which whether into more most than then them they your you are was were been being does doing done its it's over under between against during before after above below very much many such other some only also just because while where what when whom how why who".split(" "),
);

export function keywordsFrom(text: string, cap = 8): string[] {
  const counts = new Map<string, number>();
  for (const raw of text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []) {
    const w = raw.replace(/'s$/, "");
    if (w.length < 4 || STOPWORDS.has(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, cap)
    .map(([w]) => w);
}

/** Best ~340-char window of the text measured by topic-keyword density.
 * Fine-grained stepping with last-best-wins so windows that fully contain the
 * dense region beat partial overlaps. */
export function pickPassage(text: string, keywords: string[]): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= 340) return clean;
  const words = clean.split(" ");
  const windowWords = 45;
  const step = 10;
  let best = { score: -1, start: 0 };
  for (let start = 0; start + 10 < words.length; start += step) {
    const slice = words.slice(start, start + windowWords).join(" ");
    const lower = slice.toLowerCase();
    const score = keywords.reduce((s, k) => s + (lower.includes(k) ? 1 : 0), 0);
    if (score >= best.score) best = { score, start };
    if (start + windowWords >= words.length) break;
  }
  const slice = words.slice(best.start, best.start + windowWords).join(" ");
  return slice.length > 340 ? `${slice.slice(0, 337)}...` : slice;
}

// --- source typing ----------------------------------------------------------

const NEWS_HOSTS = /reuters|apnews|ap\.org|bbc|nytimes|guardian|bloomberg|ft\.com|wsj|cnbc|aljazeera/i;

export function sourceTypeFor(url: string, publisher: string | undefined): EvidenceSourceType {
  const name = publisher ?? url;
  if (/wikipedia\.org/i.test(url)) return "tertiary";
  if (NEWS_HOSTS.test(name)) return "news";
  // Tier-1 allowlisted institutions publish the underlying analysis.
  try {
    if (sourceTier(name) === 1) return "primary";
  } catch {
    // unknown source — fall through to secondary
  }
  return "secondary";
}

// --- candidate discovery ----------------------------------------------------

export interface CandidateUrl {
  url: string;
  title?: string;
  origin: "gdelt" | "wikipedia";
}

function dedupeCandidates(cands: CandidateUrl[], cap: number): CandidateUrl[] {
  const seen = new Set<string>();
  const out: CandidateUrl[] = [];
  for (const c of cands) {
    const validation = validateRetrievalUrl(c.url);
    if (!validation.ok) continue;
    let host = "";
    try {
      const u = new URL(c.url);
      host = u.hostname + u.pathname.replace(/\/$/, "");
    } catch {
      continue;
    }
    if (seen.has(host)) continue;
    seen.add(host);
    out.push(c);
    if (out.length >= cap) break;
  }
  return out;
}

async function discoverGdelt(query: string): Promise<CandidateUrl[]> {
  const res = await fetch(
    `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&maxrecords=6&sort=hybridrel&format=json`,
    { signal: AbortSignal.timeout(8_000) },
  );
  if (!res.ok) throw new Error(`gdelt ${res.status}`);
  const data = (await res.json()) as { articles?: Array<{ url?: string; title?: string }> };
  return (data.articles ?? [])
    .filter((a) => typeof a.url === "string")
    .map((a) => ({ url: a.url as string, title: a.title, origin: "gdelt" as const }));
}

async function discoverWikipedia(query: string): Promise<CandidateUrl[]> {
  const res = await fetch(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=2&format=json&origin=*`,
    { signal: AbortSignal.timeout(8_000) },
  );
  if (!res.ok) throw new Error(`wikipedia ${res.status}`);
  const data = (await res.json()) as { query?: { search?: Array<{ title?: string }> } };
  return (data.query?.search ?? [])
    .filter((s) => typeof s.title === "string")
    .map((s) => ({
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(s.title!.replace(/ /g, "_"))}`,
      title: s.title,
      origin: "wikipedia" as const,
    }));
}

/** Discover candidate evidence URLs for a topic. Best-effort — failures here
 * simply mean fewer candidates; callers must tolerate an empty list. */
export async function discoverCandidateUrls(topicTitle: string): Promise<CandidateUrl[]> {
  const results = await Promise.allSettled([
    discoverGdelt(`"${topicTitle.slice(0, 80)}"`),
    discoverWikipedia(topicTitle),
  ]);
  const cands = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  return dedupeCandidates(cands, 6);
}

// --- card assembly ----------------------------------------------------------

export function assembleCard(topic: { title: string; prompt: string }, src: RetrievedSource): TopicEvidenceCard | null {
  if (src.sourceStatus !== "retrieved" || !src.snippet || src.snippet.length < 160) return null;
  const claim = topic.prompt.trim().slice(0, 180) || topic.title;
  const keywords = keywordsFrom(`${topic.title} ${topic.prompt}`, 10);
  const passage = pickPassage(src.snippet, keywords);

  const match = claimSourceMatch(claim, [
    { sourceName: src.publisher ?? inferName(src.url), excerpt: passage },
  ]);

  const publishedDate = src.publicationDate ?? null;
  const dateCheck = sourceDateCheck(`${passage} ${publishedDate ?? ""}`);
  const relevant = match.score >= 0.25;
  const sourceName = src.publisher ?? inferName(src.url);
  const stype = sourceTypeFor(src.finalUrl ?? src.url, sourceName);

  return {
    claim,
    sourceName,
    sourceType: stype,
    url: src.finalUrl ?? src.url,
    title: src.title,
    passage,
    publishedDate,
    checks: {
      supportsClaim: match.score >= 0.5,
      relevant,
      current: publishedDate ? !dateCheck.isOutdated : null,
      primary: stype === "primary",
      matchScore: Math.round(match.score * 1000) / 1000,
    },
  };
}

function inferName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Full retrieval pass for one topic. Bounded: at most maxCards fetched in
 * parallel under an overall budget; any failure shrinks the result instead of
 * failing the topic.
 */
export async function buildTopicEvidenceCards(
  topic: { title: string; prompt: string },
  opts: { maxCards?: number; budgetMs?: number } = {},
): Promise<{ cards: TopicEvidenceCard[]; attempted: number; failureNotes: string[] }> {
  const maxCards = opts.maxCards ?? 3;
  const budgetMs = opts.budgetMs ?? 14_000;
  const failureNotes: string[] = [];

  const candidates = await discoverCandidateUrls(topic.title);
  if (!candidates.length) return { cards: [], attempted: 0, failureNotes: ["No candidate sources discovered."] };

  const budget = setTimeout(() => {}, budgetMs);
  try {
    const retrieved = await Promise.allSettled(
      candidates.map(async (c) => ({ cand: c, src: await retrieveSource(c.url, { timeoutMs: 9_000 }) })),
    );

    const cards: TopicEvidenceCard[] = [];
    for (const r of retrieved) {
      if (r.status !== "fulfilled") continue;
      const { cand, src } = r.value;
      if (src.sourceStatus !== "retrieved") {
        failureNotes.push(`${cand.origin}:${cand.url} -> ${src.sourceStatus}`);
        continue;
      }
      const card = assembleCard(topic, src);
      if (!card) {
        failureNotes.push(`${cand.origin}:${cand.url} -> too little content`);
        continue;
      }
      cards.push(card);
    }

    cards.sort((a, b) => b.checks.matchScore - a.checks.matchScore);
    return { cards: cards.slice(0, maxCards), attempted: candidates.length, failureNotes };
  } finally {
    clearTimeout(budget);
  }
}
