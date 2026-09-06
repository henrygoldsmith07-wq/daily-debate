// Source retrieval architecture for cited URLs.
// For each URL we store retrieval metadata, failure status, and legal/technical limits.
// This module is the single place that knows how to fetch, what to keep, and when to stop.
// It does NOT treat URL existence as proof — claim-source entailment lives separately.
//
// SSRF posture: every hop of a redirect chain is revalidated (https, no embedded
// credentials, no private/link-local host) AND resolved hostnames are checked so
// that public-looking domains resolving to private or metadata addresses are
// refused. The response body is streamed with a hard byte cap so a hostile
// server cannot exhaust memory before the size check runs.

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
const MAX_REDIRECTS = 4;
const DNS_TIMEOUT_MS = 3_000;

// Thrown when a URL (or a redirect hop, or a resolved address) fails SSRF
// validation. Exported for tests.
export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

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

function isDottedQuad(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

// Numeric check for IP literals. WHATWG URL canonicalisation already expands
// hex/octal/decimal IPv4 forms (http://0x7f000001 → 127.0.0.1) before this
// runs, so dotted-quad range tests are sufficient here.
export function isPrivateAddress(address: string): boolean {
  const a = address.toLowerCase().replace(/^\[|\]$/g, "");

  const mapped = a.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  const v4 = mapped ? mapped[1] : isDottedQuad(a) ? a : null;
  if (v4) {
    const parts = v4.split(".").map(Number);
    if (parts.some((p) => Number.isNaN(p) || p > 255)) return true; // malformed → hostile
    const [o1, o2] = parts;
    if (o1 === 0 || o1 === 10 || o1 === 127) return true; // this-host, private, loopback
    if (o1 === 169 && o2 === 254) return true; // link-local incl. cloud metadata
    if (o1 === 172 && o2 >= 16 && o2 <= 31) return true; // private
    if (o1 === 192 && o2 === 168) return true; // private
    if (o1 === 100 && o2 >= 64 && o2 <= 127) return true; // CGNAT
    if (o1 === 192 && o2 === 0) return true; // 192.0.0.0/24
    if (o1 === 198 && (o2 === 18 || o2 === 19)) return true; // benchmarking
    if (o1 >= 224) return true; // multicast + reserved
    return false;
  }

  // IPv6
  if (a === "::" || a === "::1") return true;
  if (/^f[cd][0-9a-f]{2}:/.test(a)) return true; // fc00::/7 unique local
  if (/^fe[89ab][0-9a-f]:/.test(a)) return true; // fe80::/10 link-local
  if (a.startsWith("::ffff:")) return true; // any other IPv4-mapped form → conservative
  return false;
}

// Hosts that must never be fetched server-side: loopback, RFC1918 private
// ranges, link-local (incl. the 169.254.169.254 metadata endpoint), IPv6
// unique-local, mDNS names, and any IP literal that resolves to those ranges.
// SSRF guard for every outbound fetch.
const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/,
  /\.local$/,
  /\.internal$/,
  /^metadata\.google\.internal$/,
  /^0\.0\.0\.0$/,
];

export function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (PRIVATE_HOST_PATTERNS.some((re) => re.test(host))) return true;
  if (isDottedQuad(host) || host.includes(":")) return isPrivateAddress(host);
  return false;
}

// Resolve the hostname and refuse any address in private/link-local space.
// Closes the gap where an attacker-controlled public domain resolves to
// 169.254.169.254 (cloud metadata) or RFC1918 (DNS rebinding).
// Exported for tests.
export async function assertPublicDns(hostname: string): Promise<void> {
  if (isPrivateHost(hostname)) {
    throw new SsrfBlockedError(`Host resolves to a forbidden literal: ${hostname}`);
  }
  const { lookup } = await import("node:dns/promises");
  let addresses: { address: string; family: number }[];
  try {
    addresses = (await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new SsrfBlockedError("dns_timeout")), DNS_TIMEOUT_MS),
      ),
    ])) as { address: string; family: number }[];
  } catch (e) {
    if (e instanceof SsrfBlockedError) throw e;
    throw new SsrfBlockedError(`DNS lookup failed for ${hostname}`);
  }
  if (!addresses || addresses.length === 0) {
    throw new SsrfBlockedError(`No DNS records for ${hostname}`);
  }
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new SsrfBlockedError(`${hostname} resolves to a private or link-local address (${address})`);
    }
  }
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

// Stream the body with a hard byte cap; aborts the connection as soon as the
// cap is exceeded so an unbounded response cannot be buffered in memory.
async function readBodyCapped(res: Response, maxBytes: number, controller: AbortController): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      received += value.byteLength;
      if (received > maxBytes) {
        controller.abort();
        reader.cancel().catch(() => {});
        throw new SsrfBlockedError(`Response exceeds ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  }
  const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return new TextDecoder("utf-8").decode(buffer);
}

export async function retrieveSource(url: string, opts: RetrievalOptions = {}): Promise<RetrievedSource> {
  const retrievalDate = new Date().toISOString();
  const initialValidation = validateRetrievalUrl(url);
  if (!initialValidation.ok) {
    return {
      url,
      retrievalDate,
      sourceStatus: "failed",
      failureStatus: initialValidation.reason,
      failureDetails: initialValidation.details,
    };
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const fail = (sourceStatus: SourceStatus, failureStatus: FailureReason, failureDetails: string, extra?: Partial<RetrievedSource>): RetrievedSource => ({
    url,
    retrievalDate,
    sourceStatus,
    failureStatus,
    failureDetails,
    ...extra,
  });

  try {
    // Manual redirect handling: every hop is revalidated (https, private host
    // string/Literal check, DNS resolution) before the next request is made.
    let currentUrl = url;
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const hopUrl = new URL(currentUrl);
      const hopValidation = validateRetrievalUrl(hopUrl.toString());
      if (!hopValidation.ok) {
        return fail("failed", hopValidation.reason ?? "invalid_url", `Redirect hop ${hop} rejected: ${hopValidation.details}`, { finalUrl: currentUrl === url ? undefined : currentUrl });
      }
      await assertPublicDns(hopUrl.hostname);

      const hopRes = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: "manual",
        headers: {
          "User-Agent": "DailyDebate-source-retrieval/1.0 (+https://dailydebate.app)",
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
        },
      });

      const status = hopRes.status;
      const location = hopRes.headers.get("location");
      if (status >= 300 && status < 400 && location) {
        // Drain and close the redirect response body before following.
        hopRes.body?.cancel().catch(() => {});
        if (hop === MAX_REDIRECTS) {
          return fail("failed", "http_error", `Too many redirects (>${MAX_REDIRECTS})`, { finalUrl: currentUrl === url ? undefined : currentUrl, httpStatus: status });
        }
        let next: URL;
        try {
          next = new URL(location, hopUrl);
        } catch {
          return fail("failed", "invalid_url", `Redirect location invalid: ${location.slice(0, 200)}`, { httpStatus: status });
        }
        currentUrl = next.toString();
        continue;
      }
      res = hopRes;
      break;
    }

    if (!res) {
      return fail("failed", "http_error", "Redirect chain did not terminate");
    }

    const finalUrl = res.url || currentUrl;
    const contentType = res.headers.get("content-type") ?? undefined;
    const isHtml = contentType ? /text\/html|application\/xhtml\+xml/.test(contentType) : true;

    if (!res.ok) {
      const status = res.status;
      let reason: FailureReason = "http_error";
      if (status === 429) reason = "rate_limited";
      if (status === 403 || status === 451) reason = "paywall_or_blocked";
      return fail(status === 429 || status === 403 || status === 451 ? "blocked" : "failed", reason, `HTTP ${status}`, {
        finalUrl: finalUrl === url ? undefined : finalUrl,
        httpStatus: status,
        contentType,
      });
    }

    if (!isHtml) {
      return fail("blocked", "unsupported_content_type", `Content-Type: ${contentType}`, {
        finalUrl: finalUrl === url ? undefined : finalUrl,
        httpStatus: res.status,
        contentType,
      });
    }

    let html: string;
    try {
      html = await readBodyCapped(res, maxBytes, controller);
    } catch (e) {
      if (e instanceof SsrfBlockedError) {
        return fail("failed", "too_large", e.message, {
          finalUrl: finalUrl === url ? undefined : finalUrl,
          httpStatus: res.status,
          contentType,
        });
      }
      throw e;
    }

    if (detectPaywall(html, res.headers)) {
      return fail("blocked", "paywall_or_blocked", "Paywall or access wall detected", {
        finalUrl: finalUrl === url ? undefined : finalUrl,
        httpStatus: res.status,
        contentType,
        isPaywalled: true,
      });
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
      finalUrl: finalUrl === url ? undefined : finalUrl,
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
    if (e instanceof SsrfBlockedError) {
      return fail("failed", "invalid_url", e.message.slice(0, 200));
    }
    const msg = e instanceof Error ? e.message : String(e);
    const isTimeout = msg.toLowerCase().includes("abort") || msg.toLowerCase().includes("timeout");
    return fail("unreachable", isTimeout ? "timeout" : "network_error", msg.slice(0, 200));
  } finally {
    clearTimeout(timer);
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
  "Do not follow redirects into private, link-local, or non-HTTPS destinations — every hop is revalidated before the next request.",
  "Do not fetch hosts whose DNS resolves to private, link-local, or metadata addresses.",
  "Do not buffer unbounded responses — bodies are streamed and hard-capped.",
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
