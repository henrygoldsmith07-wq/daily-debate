// User-attached evidence: let debaters bring their own sources.
// Stored alongside turns (solo) or match turns (pvp) and surfaced to the judge.
// Offline-validated; live URL reachability is a future async check.

export interface UserEvidence {
  url: string; // must be https, root or article; we verify shape not reachability offline
  title?: string;
  excerpt?: string; // ≤300 chars
  sourceName?: string; // optional: institution inferred from hostname
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

export function validateUserEvidence(e: UserEvidence): string[] {
  const errs: string[] = [];
  if (!e.url?.trim()) errs.push("url is required");
  else {
    try {
      const u = new URL(e.url);
      if (u.protocol !== "https:") errs.push("url must be https");
      if (e.url.length > 600) errs.push("url too long");
    } catch { errs.push("url is not a valid URL"); }
  }
  if (e.excerpt && e.excerpt.length > 300) errs.push("excerpt must be ≤300 chars");
  if (e.title && e.title.length > 140) errs.push("title must be ≤140 chars");
  return errs;
}
