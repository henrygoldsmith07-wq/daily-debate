/**
 * Session cookie identity, shared by the Auth.js config that sets it and the
 * routing proxy that checks for it.
 *
 * The `__Secure-` prefix is only legal on an HTTPS cookie, so Auth.js applies
 * it exactly when the Secure attribute is on — the proxy has to look for both
 * names because it cannot know which one this deployment set.
 */
export const SESSION_COOKIE = "authjs.session-token";
export const SECURE_SESSION_COOKIE = "__Secure-authjs.session-token";

/** Matches the Auth.js `session.maxAge`, in seconds. */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
