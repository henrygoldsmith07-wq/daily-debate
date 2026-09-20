// User-attached evidence: let debaters bring their own sources.
// Stored alongside turns (solo) or match turns (pvp) and surfaced to the judge.
// Offline-validated; live URL reachability is a future async check.

export interface UserEvidence {
  url: string; // must be https, root or article; we verify shape not reachability offline
  title?: string;
  excerpt?: string; // ≤300 chars
  sourceName?: string; // optional: institution inferred from hostname
}

export type EvidenceInspectionStatus = "verifiable" | "needs-source" | "invalid" | "not-evidence";

/**
 * Cheap evidence-path output for the structural router. This deliberately
 * checks source shape and attribution cues only; it does not decide whether a
 * cited source supports the speaker's political or controversial position.
 */
export interface SubmittedEvidenceInspection {
  status: EvidenceInspectionStatus;
  urls: string[];
  sources: UserEvidence[];
  errors: string[];
  hasEvidenceCue: boolean;
}

const URL_RE = /https:\/\/[^\s<>"')\]]+/gi;
const EVIDENCE_CUE_RE = /\b(?:according to|study|studies|data|report(?:ed)?|survey|research|analysis|estimate[ds]?|source[ds]?|\d{2,}(?:\.\d+)?%|\$\d[\d,.]*)\b/i;

/** Extract https URLs without fetching them or treating the URL as proof. */
export function extractEvidenceUrls(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.match(URL_RE) ?? []) {
    const url = raw.replace(/[.,;:!?]+$/g, "");
    if (url && !seen.has(url)) seen.add(url);
  }
  return [...seen];
}

/**
 * Inspect a submitted argument for the evidence-verification path. The
 * result is deterministic and safe to run before any model judge.
 */
export function inspectSubmittedEvidence(text: string): SubmittedEvidenceInspection {
  const clean = text.trim();
  const urls = extractEvidenceUrls(clean);
  const sources = urls.map((url) => ({
    url,
    sourceName: inferSourceFromUrl(url) ?? undefined,
  }));
  const errors = sources.flatMap(validateUserEvidence);
  const hasEvidenceCue = EVIDENCE_CUE_RE.test(clean);
  const status: EvidenceInspectionStatus = urls.length
    ? errors.length
      ? "invalid"
      : "verifiable"
    : hasEvidenceCue
      ? "needs-source"
      : "not-evidence";
  return { status, urls, sources, errors, hasEvidenceCue };
}

export function hostnameFor(url: string): string | null {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
}

export function inferSourceFromUrl(url: string): string | null {
  const h = hostnameFor(url);
  if (!h) return null;
  const map: Record<string, string> = {
    "pewresearch.org": "Pew Research Center",
    "lazard.com": "Lazard",
    "nrel.gov": "NREL",
    "iea.org": "IEA",
    "nist.gov": "NIST",
    "brookings.edu": "Brookings",
    "bruegel.org": "Bruegel",
    "nature.com": "Nature",
    "reuters.com": "Reuters",
    "apnews.com": "AP",
  };
  for (const [host, name] of Object.entries(map)) if (h === host || h.endsWith("."+host)) return name;
  return h;
}

/**
 * Whether a URL can be a legitimate PUBLIC evidence citation.
 *
 * This is the single definition of that rule. It exists because an adversarial
 * or merely confused classifier can label any sentence "evidence": without a
 * host check, text like `Cited: https://localhost/internal` was accepted as a
 * citation, letting a fake citation borrow the authority of a real source.
 * Loopback, private, link-local and dotless hosts can never be public
 * evidence, so they are refused regardless of who supplied them.
 */
export function isPublicEvidenceHost(url: string): boolean {
  const host = hostnameFor(url);
  if (!host) return false;
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return false;
  if (h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan") || h.endsWith(".home")) return false;
  if (h === "0.0.0.0") return false;
  // IPv6 literals arrive bracketed, e.g. [::1] or [fe80::1].
  if (h.startsWith("[")) {
    const inner = h.slice(1, -1);
    if (inner === "::1" || inner.startsWith("fe80:") || inner.startsWith("fc") || inner.startsWith("fd")) return false;
    return true;
  }
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 127 || a === 10 || a === 0) return false; // loopback, private, "this host"
    if (a === 192 && b === 168) return false; // private
    if (a === 172 && b >= 16 && b <= 31) return false; // private
    if (a === 169 && b === 254) return false; // link-local
    return true;
  }
  // A registrable public domain always has at least one dot.
  return h.includes(".");
}

export function validateUserEvidence(e: UserEvidence): string[] {
  const errs: string[] = [];
  if (!e.url?.trim()) errs.push("url is required");
  else {
    try {
      const u = new URL(e.url);
      if (u.protocol !== "https:") errs.push("url must be https");
      else if (!isPublicEvidenceHost(e.url)) errs.push("url must be a public host");
      if (e.url.length > 600) errs.push("url too long");
    } catch { errs.push("url is not a valid URL"); }
  }
  if (e.excerpt && e.excerpt.length > 300) errs.push("excerpt must be ≤300 chars");
  if (e.title && e.title.length > 140) errs.push("title must be ≤140 chars");
  return errs;
}
