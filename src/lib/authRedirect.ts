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

/**
 * The login page opens on "Sign in" by default. Every "Create a free account"
 * entry point links here instead, so a new visitor lands on the sign-up tab
 * rather than a sign-in form for an account they do not have yet.
 */
export const SIGN_UP_PATH = "/login?mode=signup";

export type AuthMode = "sign-in" | "sign-up";

/** Read the `?mode=` query value; anything but "signup" opens sign-in. */
export function authModeFromParam(value: unknown): AuthMode {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "signup" ? "sign-up" : "sign-in";
}
