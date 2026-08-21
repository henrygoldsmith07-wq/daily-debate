// Citation verification & source-quality scoring.
// No network by default — checks against a curated allowlist of real
// institutions/outlets. Live fetch (homepage reachability / article existence)
// is an optional async harness that requires a network key; fixtures stay green offline.

export interface VerifyIssue { nodeId?: string; message: string; kind: "hallucination" | "missing_homepage" | "unknown_source" | "bad_url"; }

export const KNOWN_SOURCES: Record<string, { homepage: string; tier: 1 | 2 | 3; note: string }> = {
  "pew research center": { homepage: "https://www.pewresearch.org", tier: 1, note: "Nonpartisan polling" },
  "pew": { homepage: "https://www.pewresearch.org", tier: 1, note: "Alias for Pew Research Center" },
  "lazard": { homepage: "https://www.lazard.com", tier: 1, note: "LCOE reports" },
  "nrel": { homepage: "https://www.nrel.gov", tier: 1, note: "US National Renewable Energy Lab" },
  "iea": { homepage: "https://www.iea.org", tier: 1, note: "International Energy Agency" },
  "oecd": { homepage: "https://www.oecd.org", tier: 1, note: "OECD" },
  "nist": { homepage: "https://www.nist.gov", tier: 1, note: "NIST AI RMF" },
  "stanford hai": { homepage: "https://hai.stanford.edu", tier: 1, note: "Stanford HAI" },
  "brookings": { homepage: "https://www.brookings.edu", tier: 1, note: "Brookings Institution" },
  "bruegel": { homepage: "https://www.bruegel.org", tier: 2, note: "Bruegel" },
  "brattle group": { homepage: "https://www.brattle.com", tier: 2, note: "Brattle Group" },
  "brattle": { homepage: "https://www.brattle.com", tier: 2, note: "Alias for Brattle Group" },
  "anthropic": { homepage: "https://www.anthropic.com", tier: 2, note: "Anthropic RSP" },
  "nasa": { homepage: "https://www.nasa.gov", tier: 1, note: "NASA" },
  "noaa": { homepage: "https://www.noaa.gov", tier: 1, note: "NOAA" },
  "world bank": { homepage: "https://www.worldbank.org", tier: 1, note: "World Bank" },
  "imf": { homepage: "https://www.imf.org", tier: 1, note: "IMF" },
  "who": { homepage: "https://www.who.int", tier: 1, note: "WHO" },
  "un": { homepage: "https://www.un.org", tier: 1, note: "UN" },
  "reuters": { homepage: "https://www.reuters.com", tier: 1, note: "Reuters" },
  "ap": { homepage: "https://apnews.com", tier: 1, note: "AP" },
  "nature": { homepage: "https://www.nature.com", tier: 1, note: "Nature" },
  "science": { homepage: "https://www.science.org", tier: 1, note: "Science" },
  "lancet": { homepage: "https://www.thelancet.com", tier: 1, note: "Lancet" },
  "economist": { homepage: "https://www.economist.com", tier: 2, note: "The Economist" },
  "financial times": { homepage: "https://www.ft.com", tier: 2, note: "FT" },
};

function norm(s: string) { return s.trim().toLowerCase().replace(/\s+/g, " "); }

export function isKnownSource(name: string): boolean {
  return norm(name) in KNOWN_SOURCES;
}

export function homepageFor(name: string): string | null {
  return KNOWN_SOURCES[norm(name)]?.homepage ?? null;
}

export function sourceTier(name: string): 1 | 2 | 3 {
  return KNOWN_SOURCES[norm(name)]?.tier ?? 3;
}

// 1 = strongest (peer-reviewed / primary data), 3 = weakest (unknown / anecdotal)
export function sourceQualityScore(name: string): number {
  const t = sourceTier(name);
  return t === 1 ? 0.95 : t === 2 ? 0.75 : 0.35;
}

export function isRootHomepage(url?: string): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    // Root only: pathname must be / or empty, no deep article path, no query-based article id
    const path = u.pathname.replace(/\/+$/, "") || "/";
    if (path !== "/" && path.split("/").filter(Boolean).length > 1) return false;
    return true;
  } catch { return false; }
}

export function verifyCitation(c: { sourceName: string; homepage?: string }): VerifyIssue[] {
  const issues: VerifyIssue[] = [];
  if (!c.sourceName?.trim()) issues.push({ message: "Empty sourceName", kind: "hallucination" });
  else if (!isKnownSource(c.sourceName)) issues.push({ message: `Unknown source: ${c.sourceName}`, kind: "unknown_source" });
  if (c.homepage && !isRootHomepage(c.homepage)) issues.push({ message: `Homepage must be root only (no article URL): ${c.homepage}`, kind: "bad_url" });
  if (!c.homepage) issues.push({ message: `Missing homepage for ${c.sourceName} — add root URL`, kind: "missing_homepage" });
  return issues;
}

// Graph-level check: cited/strong evidence must not hallucinate sources
import type { ArgGraph } from "./argGraph";
export function verifyGraphCitations(graph: ArgGraph): VerifyIssue[] {
  const out: VerifyIssue[] = [];
  for (const n of graph.nodes) {
    if (n.kind !== "evidence") continue;
    if (n.evidenceStrength !== "cited" && n.evidenceStrength !== "strong") continue;
    if (!n.citations?.length) { out.push({ nodeId: n.id, message: `Evidence ${n.id} is ${n.evidenceStrength} but has no citations`, kind: "hallucination" }); continue; }
    for (const c of n.citations) for (const iss of verifyCitation(c)) out.push({ nodeId: n.id, ...iss });
  }
  return out;
}

// Aggregate quality: weighted mean of source tiers across grounded evidence
export function graphSourceQuality(graph: ArgGraph): number {
  const cited = graph.nodes.filter((n) => n.kind === "evidence" && n.citations?.length);
  if (cited.length === 0) return 0;
  let sum = 0;
  for (const n of cited) {
    const best = Math.max(...n.citations!.map((c) => sourceQualityScore(c.sourceName)));
    sum += best;
  }
  return sum / cited.length;
}

// ---------------------------------------------------------------------------
// Source-date checking & original-source detection
// ---------------------------------------------------------------------------

// Primary = institutions that produce the data themselves (journals, gov labs,
// official statistics). Secondary = outlets that report on primary work.
const PRIMARY_SOURCES = new Set([
  "nature", "science", "lancet", "nist", "nrel", "iea", "oecd", "who",
  "world bank", "imf", "un", "nasa", "noaa", "stanford hai",
]);

export function isPrimarySource(name: string): boolean {
  return PRIMARY_SOURCES.has(norm(name));
}

export function isSecondarySource(name: string): boolean {
  return isKnownSource(name) && !isPrimarySource(name);
}

export interface OriginalSourceGap {
  primaryCount: number;
  secondaryCount: number;
  hasPrimary: boolean;
  onlySecondary: boolean;
  note: string;
}

/** Prefer the original data producer over a news outlet that summarises it. */
export function originalSourceGap(citations: Array<{ sourceName: string }>): OriginalSourceGap {
  let primaryCount = 0;
  let secondaryCount = 0;
  for (const c of citations) {
    if (isPrimarySource(c.sourceName)) primaryCount++;
    else if (isSecondarySource(c.sourceName)) secondaryCount++;
  }
  const hasPrimary = primaryCount > 0;
  const onlySecondary = citations.length > 0 && secondaryCount > 0 && !hasPrimary;
  return {
    primaryCount,
    secondaryCount,
    hasPrimary,
    onlySecondary,
    note: onlySecondary
      ? "Only secondary (reporting) sources cited — prefer the original study/data producer."
      : hasPrimary
        ? "Original source present."
        : "No recognised sources.",
  };
}

export interface SourceDateCheck {
  hasYear: boolean;
  newestYear: number | null;
  isOutdated: boolean;
  note: string;
}

/** Check recency of a source from the years mentioned in its excerpt/snippet. */
export function sourceDateCheck(
  excerpt: string,
  opts?: { nowYear?: number; maxAgeYears?: number },
): SourceDateCheck {
  const nowYear = opts?.nowYear ?? new Date().getFullYear();
  const maxAge = opts?.maxAgeYears ?? 5;
  const years = [...excerpt.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => parseInt(m[0], 10));
  if (!years.length) {
    return { hasYear: false, newestYear: null, isOutdated: false, note: "No year found — recency unverifiable." };
  }
  const newestYear = Math.max(...years);
  const isOutdated = nowYear - newestYear > maxAge;
  return {
    hasYear: true,
    newestYear,
    isOutdated,
    note: isOutdated
      ? `Newest year ${newestYear} is >${maxAge} years old — flag as outdated.`
      : `Recent (${newestYear}).`,
  };
}
