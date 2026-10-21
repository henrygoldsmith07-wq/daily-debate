// Classify a provider's rate-limit error into a WINDOW and a recommended pace.
//
// Why this exists. A free tier's rate ceiling is not one number, and "requests
// per minute" is only one shape of it. The three providers this repository
// actually uses answer with three different windows:
//
//   cerebras   "Requests per hour limit exceeded - too many requests sent."
//   unorouter  "The free tier allows 5 request(s) every 1 min per account"
//   openrouter "Rate limit exceeded: free-models-per-day."
//
// On 2026-10-21 a judge study was paced at 12000 ms per request - exactly
// 300 requests/hour, exactly cerebras's ceiling - and the run died at the
// window boundary AFTER the expensive calls had been spent, because the
// limit was per HOUR and everyone had assumed per-minute.
//
// A rate limit that is misread as a different window is a *mislabelled
// instrument*, and the general lesson in this repo is that mislabelled
// instruments corrupt the record they write. So the window is derived from
// the provider's own words, and the pace is derived from the window rather
// than guessed.
//
// Two rules the recommendation must respect:
//
//   1. The pace must sit UNDER the ceiling, never on it. A pace that exactly
//      equals the ceiling has zero headroom and fails at the boundary.
//   2. A daily cap cannot be paced away. Saying so plainly is better than
//      recommending a pace that cannot possibly work.

/** The windows a provider limit can have. */
export const RATE_LIMIT_WINDOWS = ["second", "minute", "hour", "day", "unknown"];

/**
 * Headroom factor applied to any ceiling we infer. 1.25 means "use at most
 * 80% of the ceiling". A pace that exactly equals the ceiling has no margin:
 * it fails at the window boundary, after the budget is spent.
 */
export const RATE_LIMIT_HEADROOM = 1.25;

/**
 * Requests per hour assumed for an hour-window whose ceiling the provider
 * does not state. Derived empirically: on 2026-10-21 cerebras sustained
 * 313 requests/hour before answering 429, and a study paced at 12000ms
 * (exactly 300/hour) failed at the rollover. 240/hour is 80% of that.
 */
export const DEFAULT_HOURLY_CEILING = 240;

/** Minutes in each window we can convert a request budget into a pace. */
const WINDOW_MS = { second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000 };

/** Normalise the shapes providers use for their rate-limit prose. */
function norm(detail) {
  return String(detail ?? "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Classify a rate-limit error.
 *
 * @param {string} detail the provider's error text (a 429 body, usually).
 * @returns {{
 *   window: "second"|"minute"|"hour"|"day"|"unknown",
 *   limit: number|null,
 *   limitSource: "provider"|"default"|null,
 *   recommendedPaceMs: number|null,
 *   pacingHelps: boolean,
 *   evidence: string|null,
 * }}
 */
export function classifyRateLimit(detail) {
  const text = norm(detail);
  const unknown = { window: "unknown", limit: null, limitSource: null, recommendedPaceMs: null, pacingHelps: false, evidence: null };

  if (!text) return unknown;

  // "the free tier allows 5 request(s) every 1 min per account"
  // "allows 100 requests every 1 hour"
  const explicit = text.match(/allows?\s+(\d+)\s+requests?\b[^.]*?\bevery\s+(\d+)\s*(second|sec|minute|min|hour|hr|day)s?\b/);
  if (explicit) {
    const limit = Number(explicit[1]);
    const count = Number(explicit[2]);
    const unit = explicit[3];
    const window = unit.startsWith("s") && unit !== "second" && unit !== "sec" ? "second" : unit.startsWith("mi") ? "minute" : unit.startsWith("h") ? "hour" : "day";
    const perWindow = Math.max(1, Math.floor(limit / count));
    return {
      window,
      limit: perWindow,
      limitSource: "provider",
      recommendedPaceMs: paceFor(window, perWindow),
      pacingHelps: true,
      evidence: `provider stated ${limit} request(s) every ${count} ${unit}(s)`,
    };
  }

  // "requests per hour limit exceeded" - window known, ceiling not.
  if (/per hour/.test(text) || /hourly limit/.test(text)) {
    return {
      window: "hour",
      limit: DEFAULT_HOURLY_CEILING,
      limitSource: "default",
      recommendedPaceMs: paceFor("hour", DEFAULT_HOURLY_CEILING),
      pacingHelps: true,
      evidence: "provider named an hourly limit but not its size; using the empirically observed ceiling",
    };
  }

  // "per minute" / "too many requests" with a minute window.
  if (/per minute/.test(text) || /minute limit/.test(text)) {
    return {
      window: "minute",
      limit: null,
      limitSource: "default",
      recommendedPaceMs: paceFor("minute", 5),
      pacingHelps: true,
      evidence: "provider named a per-minute limit but not its size; assuming the observed 5/minute ceiling",
    };
  }

  // "free-models-per-day", "per day", "daily limit" - NOT paceable.
  if (/per day/.test(text) || /daily/.test(text) || /free models per day/.test(text)) {
    return {
      window: "day",
      limit: null,
      limitSource: "provider",
      recommendedPaceMs: null,
      pacingHelps: false,
      evidence: "the ceiling is per DAY; no request pace can avoid it - the tier must recover or the provider must change",
    };
  }

  // A 429 with no usable window information.
  if (/429|too many requests|rate limit|too_many_requests/.test(text)) {
    return { ...unknown, evidence: "the provider reported a rate limit without naming its window" };
  }

  return unknown;
}

/** The minimum milliseconds between requests that stays under `perWindow` per window. */
function paceFor(window, perWindow) {
  const ms = WINDOW_MS[window];
  if (!ms || !Number.isFinite(perWindow) || perWindow <= 0) return null;
  const raw = ms / perWindow;
  return Math.ceil(raw * RATE_LIMIT_HEADROOM);
}

/**
 * A one-line, human-readable summary of a classification. Appended to the
 * probe's PROBE-FAIL line so a CI log states the window and the pace
 * explicitly, instead of leaving it to be decoded from provider prose.
 */
export function describeRateLimit(classification) {
  const c = classification;
  if (!c || c.window === "unknown") {
    return c?.evidence ? `window=unknown (${c.evidence})` : "window=unknown";
  }
  const limit = c.limit == null ? "unstated" : `${c.limit}`;
  const limitNote = c.limitSource === "default" ? `${limit} (default)` : limit;
  const pace = c.recommendedPaceMs == null ? "no pace can satisfy it" : `pace>=${c.recommendedPaceMs}ms`;
  return `window=${c.window} limit=${limitNote} ${pace}`;
}
