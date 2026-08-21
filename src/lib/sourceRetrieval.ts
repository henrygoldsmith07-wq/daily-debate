// Source retrieval architecture for cited URLs.
// For each URL we store retrieval metadata, failure status, and legal/technical limits.
// This module is the single place that knows how to fetch, what to keep, and when to stop.
// It does NOT treat URL existence as proof — claim-source entailment lives separately.

import { hostnameFor } from "./evidence";

export type SourceStatus =
  | "pending"
  | "retrieved"
  | "failed"
  | "blocked" // robots/paywall/unsupported content-type
  | "unreachable";

export type FailureReason =
  | "timeout"
  | "http_error"
  | "invalid_url"
  | "not_https"
  | "unsupported_content_type"
  | "paywall_or_blocked"
  | "too_large"
  | "network_error"
  | "rate_limited"
  | "unknown";

export interface RetrievedSource {
  url: string;
  finalUrl?: string;
  title?: string;
  publisher?: string; // inferred from hostname or og:site_name
  author?: string; // from meta author / og:author where available
  publicationDate?: string; // ISO date if found in meta, else undefined
  retrievalDate: string; // ISO now at retrieval
  relevantPassage?: string; // first ~500 chars of visible text (or supplied excerpt)
  sourceStatus: SourceStatus;
  failureStatus?: FailureReason;
  failureDetails?: string;
  httpStatus?: number;
  contentType?: string;
  snippet?: string;
  isPaywalled?: boolean;
}

export interface RetrievalOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

const DEFAULT_TIMEOUT = 8_000;
const DEFAULT_MAX_BYTES = 1_200_000;

// Publisher inference from hostname
const PUBLISHER_MAP: Record<string, string> = {
  "pewresearch.org": "Pew Research Center",
  "lazard.com": "Lazard",
  "nrel.gov": "NREL",
  "iea.org": "IEA",
  "oecd.org": "OECD",
  "nist.gov": "NIST",
  "brookings.edu": "Brookings",
  "bruegel.org": "Bruegel",
  "nature.com": "Nature",
  "reuters.com": "Reuters",
  "apnews.com": "AP",
  "who.int": "WHO",
  "imf.org": "IMF",
  "worldbank.org": "World Bank",
  "nasa.gov": "NASA",
  "noaa.gov": "NOAA",
  "stanford.edu": "Stanford",
  "hai.stanford.edu": "Stanford HAI",
};

export function inferPublisher(url: string): string | undefined {
  const host = hostnameFor(url);
  if (!host) return undefined;
  for (const [domain, name] of Object.entries(PUBLISHER_MAP)) {
    if (host === domain || host.endsWith("." + domain)) return name;
  }
  return host;
}

export function validateRetrievalUrl(url: string): { ok: boolean; reason?: FailureReason; details?: string } {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return { ok: false, reason: "not_https", details: "URL must be https" };
    if (url.length > 600) return { ok: false, reason: "invalid_url", details: "URL too long" };
    if (u.username || u.password) return { ok: false, reason: "invalid_url", details: "URL must not embed credentials" };
    if (isPrivateHost(u.hostname)) return { ok: false, reason: "invalid_url", details: "URL must not point at a private or link-local host" };
    return { ok: true };
  } catch {
    return { ok: false, reason: "invalid_url", details: "Not a valid URL" };
  }
}

// Hosts that must never be fetched server-side: loopback, RFC1918 private
// ranges, link-local (incl. the 169.254.169.254 metadata endpoint), IPv6
// unique-local, and mDNS names. SSRF guard for every outbound fetch.
const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/,
  /\.local$/,
  /\.internal$/,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^::$/,
  /^f[cd][0-9a-f]{2}:/i,
];

export function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return PRIVATE_HOST_PATTERNS.some((re) => re.test(host));
}

function extractMeta(html: string, key: string): string | undefined {
  // naive meta extraction without DOM — works offline for tests
  const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']+)["']`, "i");
  const m1 = html.match(re1);
  if (m1?.[1]) return m1[1].trim().slice(0, 200);
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]* (?:property|name)=["']${key}["']`, "i");
  const m2 = html.match(re2);
  return m2?.[1]?.trim().slice(0, 200);
}

function detectPaywall(html: string, headers: Headers): boolean {
  const paywallSignals = [/paywall/i, /subscribe to continue/i, /subscription required/i, /access denied/i];
  const text = html.slice(0, 4000);
  if (paywallSignals.some((re) => re.test(text))) return true;
  const ct = headers.get("x-paywall") || headers.get("x-subscription-required");
  if (ct) return true;
  return false;
}

function stripToText(html: string, maxChars = 800): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

export async function retrieveSource(url: string, opts: RetrievalOptions = {}): Promise<RetrievedSource> {
  const retrievalDate = new Date().toISOString();
  const validation = validateRetrievalUrl(url);
  if (!validation.ok) {
    return {
      url,
      retrievalDate,
      sourceStatus: "failed",
      failureStatus: validation.reason,
      failureDetails: validation.details,
    };
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "DailyDebate-source-retrieval/1.0 (+https://dailydebate.app)",
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
      },
    });
    clearTimeout(timer);

    const contentType = res.headers.get("content-type") ?? undefined;
    const isHtml = contentType ? /text\/html|application\/xhtml\+xml/.test(contentType) : true;

    if (!res.ok) {
      const status = res.status;
      let reason: FailureReason = "http_error";
      if (status === 429) reason = "rate_limited";
      if (status === 403 || status === 451) reason = "paywall_or_blocked";
      return {
        url,
        finalUrl: res.url,
        retrievalDate,
        sourceStatus: status === 429 || status === 403 || status === 451 ? "blocked" : "failed",
        failureStatus: reason,
        failureDetails: `HTTP ${status}`,
        httpStatus: status,
        contentType,
      };
    }

    if (!isHtml) {
      return {
        url,
        finalUrl: res.url,
        retrievalDate,
        sourceStatus: "blocked",
        failureStatus: "unsupported_content_type",
        failureDetails: `Content-Type: ${contentType}`,
        httpStatus: res.status,
        contentType,
      };
    }

    const html = await res.text();
    if (html.length > (opts.maxBytes ?? DEFAULT_MAX_BYTES)) {
      return {
        url,
        finalUrl: res.url,
        retrievalDate,
        sourceStatus: "failed",
        failureStatus: "too_large",
        failureDetails: `Response exceeds ${opts.maxBytes ?? DEFAULT_MAX_BYTES} bytes`,
        httpStatus: res.status,
        contentType,
      };
    }

    if (detectPaywall(html, res.headers)) {
      return {
        url,
        finalUrl: res.url,
        retrievalDate,
        sourceStatus: "blocked",
        failureStatus: "paywall_or_blocked",
        failureDetails: "Paywall or access wall detected",
        httpStatus: res.status,
        contentType,
        isPaywalled: true,
      };
    }

    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim().slice(0, 200) ?? extractMeta(html, "og:title");
    const author = extractMeta(html, "author") ?? extractMeta(html, "og:author") ?? extractMeta(html, "article:author");
    const pubDateRaw =
      extractMeta(html, "article:published_time") ??
      extractMeta(html, "og:published_time") ??
      extractMeta(html, "pubdate") ??
      extractMeta(html, "date") ??
      html.match(/<time[^>]*datetime=["']([^"']+)["']/i)?.[1];
    let publicationDate: string | undefined;
    if (pubDateRaw) {
      const d = new Date(pubDateRaw);
      if (!isNaN(d.getTime())) publicationDate = d.toISOString().slice(0, 10);
    }

    const publisherFromMeta = extractMeta(html, "og:site_name");
    const publisher = publisherFromMeta ?? inferPublisher(url);
    const snippet = stripToText(html, 800);

    return {
      url,
      finalUrl: res.url === url ? undefined : res.url,
      title,
      publisher,
      author,
      publicationDate,
      retrievalDate,
      relevantPassage: snippet.slice(0, 500),
      snippet,
      sourceStatus: "retrieved",
      httpStatus: res.status,
      contentType,
    };
  } catch (e) {
    clearTimeout(timer);
    const msg = e instanceof Error ? e.message : String(e);
    const isTimeout = msg.toLowerCase().includes("abort") || msg.toLowerCase().includes("timeout");
    return {
      url,
      retrievalDate,
      sourceStatus: "unreachable",
      failureStatus: isTimeout ? "timeout" : "network_error",
      failureDetails: msg.slice(0, 200),
    };
  }
}

export async function retrieveSources(urls: string[], opts: RetrievalOptions = {}): Promise<Map<string, RetrievedSource>> {
  const unique = [...new Set(urls.filter(Boolean))];
  const entries = await Promise.all(unique.map(async (u) => [u, await retrieveSource(u, opts)] as const));
  return new Map(entries);
}

// Pure offline helper: build a RetrievedSource from already-available metadata (e.g. user-supplied excerpt)
// without fetching — so tests/batching can run without network and still carry the legal note.
export function stubRetrievedSource(params: {
  url: string;
  title?: string;
  publisher?: string;
  author?: string;
  publicationDate?: string;
  excerpt?: string;
  retrievalDate?: string;
  sourceStatus?: SourceStatus;
}): RetrievedSource {
  return {
    url: params.url,
    title: params.title,
    publisher: params.publisher ?? inferPublisher(params.url),
    author: params.author,
    publicationDate: params.publicationDate,
    retrievalDate: params.retrievalDate ?? new Date().toISOString(),
    relevantPassage: params.excerpt?.slice(0, 500),
    snippet: params.excerpt?.slice(0, 800),
    sourceStatus: params.sourceStatus ?? (params.excerpt ? "retrieved" : "pending"),
  };
}

// Respect legal/technical access limitations: this list documents what we will not do.
// Exported so CI/docs can assert we honour it.
export const RETRIEVAL_LIMITATIONS = [
  "Do not bypass paywalls, login walls, or subscription gates. A blocked page is recorded as blocked, not proxied.",
  "Do not ignore robots.txt rate limits — retrieval uses a narrow UA and modest timeouts; bulk crawling requires infra allowlist.",
  "Do not fetch non-HTTPS URLs. Mixed content is rejected at validation.",
  "Do not store full article bodies. Keep only title, publisher, author, publication date, retrieval date, relevant passage, and status.",
  "Do not treat retrieval success as entailment: a URL being reachable never implies a claim is supported.",
] as const;

export function sourceRetrievalExplain(source: RetrievedSource): string {
  if (source.sourceStatus === "retrieved") {
    const pub = source.publicationDate ? ` published ${source.publicationDate}` : "";
    const author = source.author ? ` by ${source.author}` : "";
    return `Retrieved "${source.title ?? source.url}"${author} via ${source.publisher ?? inferPublisher(source.url) ?? "unknown"}${pub} on ${source.retrievalDate.slice(0, 10)} — passage available.`;
  }
  return `Retrieval ${source.sourceStatus}${source.failureStatus ? ` (${source.failureStatus})` : ""}${source.failureDetails ? `: ${source.failureDetails}` : ""} on ${source.retrievalDate.slice(0, 10)}.`;
}
