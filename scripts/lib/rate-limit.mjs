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
 * @param {object} [opts]
 * @param {object} [opts.headers] the provider's rate-limit response headers,
 *   when it sent any. They are the provider's own statement of its ceiling
 *   and therefore beat any inference from prose.
 * @returns {{
 *   window: "second"|"minute"|"hour"|"day"|"unknown",
 *   limit: number|null,
 *   limitSource: "provider"|"default"|null,
 *   recommendedPaceMs: number|null,
 *   pacingHelps: boolean,
 *   evidence: string|null,
 * }}
 */
export function classifyRateLimit(detail, opts = {}) {
  const raw = String(detail ?? "");
  const text = norm(raw);
  const headers = opts.headers ?? {};
  const unknown = { window: "unknown", limit: null, limitSource: null, recommendedPaceMs: null, pacingHelps: false, evidence: null };

  if (!text && !Object.keys(headers).length) return unknown;

  // 1. The WINDOW. The provider's structured error CODE names it outright
  //    (cerebras answers "code":"requests_per_hour"), and its prose names it
  //    next. The code is matched on the RAW text: normalising would turn
  //    "requests_per_hour" into "requests per hour" and destroy the field.
  const coded = raw.match(/"code"\s*:\s*"([A-Za-z0-9_.-]+)"/);
  const code = coded ? coded[1].toLowerCase() : null;
  let window = null;
  let windowEvidence = null;
  if (code) {
    if (/per[_-]?second/.test(code)) { window = "second"; windowEvidence = "the provider's error code names a per-second window"; }
    else if (/per[_-]?minute/.test(code)) { window = "minute"; windowEvidence = "the provider's error code names a per-minute window"; }
    else if (/per[_-]?hour/.test(code)) { window = "hour"; windowEvidence = "the provider's error code names a per-hour window"; }
    else if (/per[_-]?day/.test(code)) { window = "day"; windowEvidence = "the provider's error code names a per-day window"; }
  }

  // "the free tier allows 5 request(s) every 1 min per account"
  const explicit = text.match(/allows?\s+(\d+)\s+requests?\b[^.]*?\bevery\s+(\d+)\s*(second|sec|minute|min|hour|hr|day)s?\b/);
  if (!window && explicit) {
    const limit = Number(explicit[1]);
    const count = Number(explicit[2]);
    const unit = explicit[3];
    window = unit.startsWith("s") && unit !== "second" && unit !== "sec" ? "second" : unit.startsWith("mi") ? "minute" : unit.startsWith("h") ? "hour" : "day";
    windowEvidence = `provider stated ${limit} request(s) every ${count} ${unit}(s)`;
  }
  if (!window && /per hour/.test(text)) { window = "hour"; windowEvidence = "provider named an hourly limit"; }
  if (!window && /per minute/.test(text)) { window = "minute"; windowEvidence = "provider named a per-minute limit"; }
  if (!window && (/per day/.test(text) || /daily/.test(text) || /free models per day/.test(text))) { window = "day"; windowEvidence = "provider named a daily limit"; }

  // 2. The MAGNITUDE. The provider's rate-limit HEADERS are its own
  //    statement of the ceiling, and they beat any default we would invent.
  const headerLimit = num(headers["x-ratelimit-limit-requests"] ?? headers["x-ratelimit-limit"] ?? headers["x-rate-limit-limit"] ?? headers["ratelimit-limit"]);
  const headerRemaining = num(headers["x-ratelimit-remaining-requests"] ?? headers["x-ratelimit-remaining"] ?? headers["x-rate-limit-remaining"] ?? headers["ratelimit-remaining"]);
  const headerReset = headers["x-ratelimit-reset-requests"] ?? headers["x-ratelimit-reset"] ?? headers["x-rate-limit-reset"] ?? headers["ratelimit-reset"];
  const resetSec = num(headerReset);

  // A window we did not get from prose or code, but the headers can give us
  // one: a large ceiling is an hour window, a small one is a minute window,
  // and a reset of a day or more is a day window.
  if (!window) {
    if (resetSec != null && resetSec >= 86_400) { window = "day"; windowEvidence = "the provider's reset is a day away"; }
    else if (headerLimit != null && headerLimit <= 60) { window = "minute"; windowEvidence = "the provider's header ceiling is a per-minute one"; }
    else if (headerLimit != null || resetSec != null) { window = "hour"; windowEvidence = "the provider's headers state an hourly ceiling"; }
  }

  if (!window) {
    // A 429 with no usable window information.
    if (/429|too many requests|rate limit|too_many_requests/.test(text)) {
      return { ...unknown, evidence: "the provider reported a rate limit without naming its window" };
    }
    return unknown;
  }

  // The magnitude for this window: the provider's header first, then the
  // provider's prose, then the observed default.
  let limit = headerLimit;
  let limitSource = limit != null ? "provider" : null;
  if (limit == null && explicit) {
    limit = Math.max(1, Math.floor(Number(explicit[1]) / Math.max(1, Number(explicit[2]))));
    limitSource = "provider";
  }
  if (limit == null) {
    limit = window === "hour" ? DEFAULT_HOURLY_CEILING : window === "minute" ? 5 : null;
    limitSource = limit == null ? null : "default";
  }

  const parts = [windowEvidence];
  if (headerLimit != null) parts.push(`provider headers state limit=${headerLimit} remaining=${headerRemaining ?? "unstated"}`);
  if (resetSec != null) parts.push(`reset=${resetSec}s`);

  if (window === "day") {
    return { window, limit, limitSource, recommendedPaceMs: null, pacingHelps: false, evidence: `${parts.join(" ")} - the ceiling is per DAY; no request pace can avoid it` };
  }
  return {
    window,
    limit,
    limitSource,
    recommendedPaceMs: paceFor(window, limit),
    pacingHelps: true,
    evidence: parts.join(" "),
  };
}

function num(v) {
  if (v == null) return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
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

/**
 * Derive ONE global request pace from every usable provider's own statement of
 * its ceiling.
 *
 * The request gate in judge-providers.mjs is GLOBAL: one interval for every
 * provider, because the benchmark walks a chain and any provider can take the
 * next call. So the pace that keeps the run inside EVERY ceiling is the
 * SLOWEST of the per-provider paces — pacing for the average lets the
 * fastest-tightening provider 429, and a 429 is scored as provider
 * unreliability, which turns a pacing decision into a judge-quality verdict.
 *
 * Providers whose window is `unknown` contribute nothing (we cannot pace for
 * a ceiling nobody stated, and the historical default pace still applies).
 * Providers whose window is `day` contribute nothing and are reported as
 * unpaceable: a daily cap is not a rate, and pretending a pace satisfies it
 * would be a fabricated claim.
 *
 * @param {Array<{label: string, classification: ReturnType<typeof classifyRateLimit>}>} providers
 * @param {object} [opts]
 * @param {number} [opts.floorMs] a lower bound on the derived pace, so a
 *   generous provider statement can never make the run FASTER than the
 *   operator asked for. The explicit --pace-ms, when given, is that floor.
 * @param {number} [opts.capMs] an upper bound on the derived pace: the
 *   slowest pace the job's time budget can carry. A provider whose ceiling
 *   implies a slower pace than the budget can carry is reported as
 *   `capped`, because the alternative — pacing the whole run for it — gets
 *   the job killed at its timeout and publishes NOTHING, not even the
 *   providers that could have been measured.
 * @returns {{
 *   paceMs: number,
 *   derivedFrom: Array<{label: string, window: string, paceMs: number|null, evidence: string|null}>,
 *   unpaceable: Array<{label: string, evidence: string|null}>,
 *   capped: Array<{label: string, neededMs: number}>,
 *   note: string,
 * }}
 */
export function derivePaceFromProviders(providers, opts = {}) {
  const floorMs = Number.isFinite(opts.floorMs) && opts.floorMs > 0 ? Math.ceil(opts.floorMs) : 0;
  const capMs = Number.isFinite(opts.capMs) && opts.capMs > 0 ? Math.ceil(opts.capMs) : 0;
  const derivedFrom = [];
  const unpaceable = [];
  const capped = [];
  let slowest = 0;

  for (const { label, classification } of providers) {
    const c = classification;
    if (!c) continue;
    if (c.window === "unknown") continue;
    if (c.window === "day" || c.recommendedPaceMs == null || !c.pacingHelps) {
      unpaceable.push({ label, evidence: c.evidence });
      continue;
    }
    if (capMs > 0 && c.recommendedPaceMs > capMs) {
      // The provider's own ceiling is tighter than the job budget can carry.
      // Pacing for it would timeout the run and measure NOTHING; capping lets
      // this provider 429 honestly (its reliability gate fails with the
      // reason in the artifact) while every other provider is still measured.
      capped.push({ label, neededMs: c.recommendedPaceMs });
      continue;
    }
    derivedFrom.push({ label, window: c.window, paceMs: c.recommendedPaceMs, evidence: c.evidence });
    if (c.recommendedPaceMs > slowest) slowest = c.recommendedPaceMs;
  }

  // The floor can only slow the run down, never speed it up: an operator's
  // explicit --pace-ms is a statement about what THIS environment can bear.
  const paceMs = Math.max(slowest, floorMs);
  const from = derivedFrom.length
    ? `derived from ${derivedFrom.map((d) => `${d.label}:${d.window}>=${d.paceMs}ms`).join(", ")}`
    : "no provider stated a paceable ceiling";
  const unpaceableNote = unpaceable.length
    ? `; unpaceable (per-day or unstated ceilings, left to fail honestly): ${unpaceable.map((u) => u.label).join(", ")}`
    : "";
  const cappedNote = capped.length
    ? `; budget-capped (ceiling needs more than the job can carry, will 429 honestly): ${capped.map((u) => `${u.label}>=${u.neededMs}ms`).join(", ")}`
    : "";
  return {
    paceMs,
    derivedFrom,
    unpaceable,
    capped,
    note: `global request pace ${paceMs}ms ${from}${unpaceableNote}${cappedNote}`,
  };
}
