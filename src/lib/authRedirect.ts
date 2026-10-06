/**
 * Accept only same-origin relative application paths for post-auth redirects.
 * This blocks protocol-relative URLs, absolute URLs and backslash variants that
 * browsers can interpret as external navigation.
 */
export function safeReturnPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string") return fallback;
  const candidate = value.trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) {
    return fallback;
  }
  if (candidate.startsWith("/login")) return fallback;
  try {
    const parsed = new URL(candidate, "https://daily-debate.invalid");
    if (parsed.origin !== "https://daily-debate.invalid") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
