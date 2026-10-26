// Tests for the rate-limit window classifier.
//
// The fixtures below are the VERBATIM error bodies the three providers this
// repository actually uses returned, observed live on 2026-10-21 and in the
// 2026-10-12/2026-10-19 benchmark artifacts. They are not invented strings:
// the whole point of this module is that the real messages disagree about
// the WINDOW, and a classifier tested on invented messages would not have
// caught the 2026-10-21 failure.

import test from "node:test";
import assert from "node:assert/strict";
import { classifyRateLimit, describeRateLimit, derivePaceFromProviders, RATE_LIMIT_HEADROOM } from "./rate-limit.mjs";
import { makeChainJudgeForTest } from "./judge-providers.mjs";

/** cerebras - live, 2026-10-21. The one that cost the study an arm. */
const CEREBRAS_PER_HOUR =
  '429: {"message":"Requests per hour limit exceeded - too many requests sent.","type":"too_many_requests_error","param":"quota","code":"requests_per_hour"}';

/** unorouter - verbatim from docs/latest-judge-benchmark.json. */
const UNOROUTER_PER_MINUTE =
  '429: {"error":{"message":"Too many requests. The free tier allows 5 request(s) every 1 min per account on nemotron-3-ultra-550b-a55b:free","type":"rate_limit_error"}}';

/** openrouter - verbatim from docs/latest-judge-benchmark.json. */
const OPENROUTER_PER_DAY =
  '429: {"error":{"message":"Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free models requests per day."}}';

test("cerebras's message is recognised as a PER HOUR limit, not a per-minute one", () => {
  const c = classifyRateLimit(CEREBRAS_PER_HOUR);
  assert.equal(c.window, "hour");
  assert.equal(c.pacingHelps, true);
  assert.ok(c.recommendedPaceMs != null);
});

test("cerebras's recommended pace stays UNDER the ceiling that killed the study", () => {
  // The 2026-10-21 run was paced at 12000ms = exactly 300/hour, which is
  // exactly the ceiling, and died at the rollover. The recommendation must
  // be strictly slower than that.
  const c = classifyRateLimit(CEREBRAS_PER_HOUR);
  assert.ok(
    c.recommendedPaceMs > 12_000,
    `recommended pace ${c.recommendedPaceMs}ms must be strictly slower than the 12000ms that failed`,
  );
  const requestsPerHour = Math.floor((3600 * 1000) / c.recommendedPaceMs);
  assert.ok(requestsPerHour <= 260, `pace allows ${requestsPerHour}/hour, too close to the ~300/hour ceiling`);
});

test("unorouter's message is recognised as a PER MINUTE limit and yields its stated ceiling", () => {
  const c = classifyRateLimit(UNOROUTER_PER_MINUTE);
  assert.equal(c.window, "minute");
  assert.equal(c.limit, 5);
  assert.equal(c.limitSource, "provider");
  assert.equal(c.pacingHelps, true);
  // 60000/5 = 12000ms at the ceiling; with headroom it must be slower.
  assert.ok(c.recommendedPaceMs > 12_000, `pace ${c.recommendedPaceMs}ms must leave headroom under 5/minute`);
  assert.equal(c.recommendedPaceMs, Math.ceil((60_000 / 5) * RATE_LIMIT_HEADROOM));
});

test("openrouter's message is recognised as a PER DAY limit, which no pace can satisfy", () => {
  const c = classifyRateLimit(OPENROUTER_PER_DAY);
  assert.equal(c.window, "day");
  assert.equal(c.pacingHelps, false);
  assert.equal(c.recommendedPaceMs, null);
  assert.match(c.evidence, /no request pace can avoid it/);
});

test("the three real providers are never confused with one another", () => {
  const windows = [CEREBRAS_PER_HOUR, UNOROUTER_PER_MINUTE, OPENROUTER_PER_DAY].map((m) => classifyRateLimit(m).window);
  assert.deepEqual(windows, ["hour", "minute", "day"]);
});

test("an unlabelled 429 does not invent a window", () => {
  const c = classifyRateLimit("429: {error: {message: 'Too many requests'}}");
  assert.equal(c.window, "unknown");
  assert.equal(c.recommendedPaceMs, null);
  assert.match(c.evidence, /without naming its window/);
});

test("a non-rate-limit error is not classified as one", () => {
  const c = classifyRateLimit("404: {error: {message: 'model_not_found'}}");
  assert.equal(c.window, "unknown");
  assert.equal(c.pacingHelps, false);
});

test("an empty detail is not classified as a rate limit", () => {
  const c = classifyRateLimit("");
  assert.equal(c.window, "unknown");
  assert.equal(c.recommendedPaceMs, null);
});

test("the summary states the window and the pace explicitly", () => {
  assert.match(describeRateLimit(classifyRateLimit(CEREBRAS_PER_HOUR)), /window=hour/);
  assert.match(describeRateLimit(classifyRateLimit(CEREBRAS_PER_HOUR)), /pace>=\d+ms/);
  assert.match(describeRateLimit(classifyRateLimit(OPENROUTER_PER_DAY)), /no pace can satisfy it/);
  assert.match(describeRateLimit(classifyRateLimit("429")), /window=unknown/);
});

test("the provider's structured error CODE names the window outright", () => {
  // cerebras's real body carries "code":"requests_per_hour". That is not a
  // hint, it is the window - and it is present even when the prose is
  // truncated away.
  const c = classifyRateLimit('{"message":"Requests per hour limit exceeded","code":"requests_per_hour"}');
  assert.equal(c.window, "hour");
  assert.match(c.evidence, /error code names a per-hour window/);
});

test("a structured per-day code is still not paceable", () => {
  const c = classifyRateLimit('{"message":"slow down","code":"requests_per_day"}');
  assert.equal(c.window, "day");
  assert.equal(c.pacingHelps, false);
  assert.equal(c.recommendedPaceMs, null);
});

test("the provider's rate-limit HEADERS beat any inference from prose", () => {
  const c = classifyRateLimit("429: too many requests", {
    headers: { "x-ratelimit-limit-requests": "200", "x-ratelimit-remaining-requests": "0", "x-ratelimit-reset-requests": "1800" },
  });
  assert.equal(c.window, "hour");
  assert.equal(c.limit, 200);
  assert.equal(c.limitSource, "provider");
  // 3600000/200 = 18000ms at the ceiling; with headroom it must be slower.
  assert.ok(c.recommendedPaceMs > 18_000, `pace ${c.recommendedPaceMs}ms must leave headroom under 200/hour`);
  assert.match(c.evidence, /limit=200 remaining=0/);
});

test("headers alone, with no prose, still classify", () => {
  // A small ceiling is a per-minute one; a large one is hourly. The header
  // is the provider's own statement, so it is used even with no prose.
  const c = classifyRateLimit("", { headers: { "x-ratelimit-limit-requests": "5", "x-ratelimit-reset-requests": "45" } });
  assert.equal(c.window, "minute");
  assert.equal(c.limit, 5);
  assert.equal(c.limitSource, "provider");
  assert.equal(c.pacingHelps, true);
});

test("a day-window header is not paceable", () => {
  const c = classifyRateLimit("429", { headers: { "x-ratelimit-reset-requests": "86400" } });
  assert.equal(c.window, "day");
  assert.equal(c.pacingHelps, false);
});

// The ceiling must be a MEASUREMENT, not an inference. Capturing the headers
// only on the error path meant a run that stayed under the ceiling reported
// nothing about it - and a run that never hits the ceiling is exactly the run
// whose pace you want to copy.
const originalFetch = globalThis.fetch;

function fetchWithHeaders(headers) {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
    text: async () =>
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ winner: "tie", playerAScore: 50, playerBScore: 50, confidence: 0.5 }) } }],
      }),
  });
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("a SUCCESSFUL response still carries the provider's stated rate-limit headers", async () => {
  fetchWithHeaders({
    "x-ratelimit-limit-requests": "200",
    "x-ratelimit-remaining-requests": "137",
    "x-ratelimit-reset-requests": "1832",
  });
  const judge = makeChainJudgeForTest({
    url: "https://example.invalid/v1/chat/completions",
    key: "k",
    models: ["model-a"],
  });
  const v = await judge("Side A: a claim.\nSide B: a counter-claim.");
  assert.ok(v.rateLimitHeaders, "a successful call must report the headers the provider sent");
  assert.equal(v.rateLimitHeaders["x-ratelimit-limit-requests"], "200");
  assert.equal(v.rateLimitHeaders["x-ratelimit-remaining-requests"], "137");
  assert.equal(v.rateLimitHeaders["x-ratelimit-reset-requests"], "1832");
});

test("a successful response with no rate-limit headers reports none, and does not invent any", async () => {
  fetchWithHeaders({});
  const judge = makeChainJudgeForTest({
    url: "https://example.invalid/v1/chat/completions",
    key: "k",
    models: ["model-a"],
  });
  const v = await judge("Side A: a claim.\nSide B: a counter-claim.");
  assert.deepEqual(v.rateLimitHeaders ?? {}, {}, "no headers must mean no headers, never a guess");
});

// ---------------------------------------------------------------------------
// derivePaceFromProviders: the benchmark's global pace from every provider's
// own statement. The gate is GLOBAL, so the SLOWEST paceable ceiling governs -
// and the four weekly runs before 2026-10-21 failed precisely because no pace
// was derived at all.
// ---------------------------------------------------------------------------

/** The real providers this repository calls, with their real messages. */
function realStatements() {
  return [
    { label: "unorouter", classification: classifyRateLimit(UNOROUTER_PER_MINUTE) },
    { label: "cerebras", classification: classifyRateLimit(CEREBRAS_PER_HOUR) },
    { label: "openrouter", classification: classifyRateLimit(OPENROUTER_PER_DAY) },
  ];
}

test("the global pace is the SLOWEST paceable ceiling, not the average", () => {
  const d = derivePaceFromProviders(realStatements());
  // unorouter's 5/min -> 15000ms; cerebras's hour window -> 18750ms (default
  // 240/hour with headroom). openrouter is per-DAY and contributes nothing.
  // The gate is global: any provider can take the next request, so the run
  // must sit under EVERY paceable ceiling, which means the slowest one.
  assert.ok(d.paceMs >= 18_750, `pace ${d.paceMs}ms must respect the slowest ceiling (hour window, default 240/hour)`);
  assert.equal(d.derivedFrom.length, 2, "unorouter + cerebras are paceable; openrouter is not");
});

test("a per-DAY ceiling never governs the pace and is reported unpaceable", () => {
  const d = derivePaceFromProviders(realStatements());
  assert.ok(d.unpaceable.some((u) => u.label === "openrouter"), "the per-day provider must be named unpaceable, never silently paced for");
  assert.ok(!d.derivedFrom.some((x) => x.label === "openrouter"));
  assert.match(d.note, /unpaceable/);
  assert.match(d.note, /openrouter/);
});

test("an explicit --pace-ms is a FLOOR: it can slow the run, never speed it up", () => {
  const noFloor = derivePaceFromProviders(realStatements());
  const floored = derivePaceFromProviders(realStatements(), { floorMs: noFloor.paceMs + 10_000 });
  assert.equal(floored.paceMs, noFloor.paceMs + 10_000, "the floor must win when it is slower than every ceiling");
  // ...and a floor BELOW the derived pace changes nothing.
  const lowFloor = derivePaceFromProviders(realStatements(), { floorMs: 1_000 });
  assert.equal(lowFloor.paceMs, noFloor.paceMs);
});

test("a budget cap keeps the run inside the job timeout and names the provider it starves", () => {
  // A ceiling implying a pace slower than the cap must NOT govern: pacing the
  // whole run for it would kill the job at its timeout and publish NOTHING,
  // not even the providers that could have been measured. It is dropped from
  // the derivation and 429s honestly instead - so the pace comes from the
  // providers that FIT, and the note names the one that was starved.
  const d = derivePaceFromProviders(realStatements(), { capMs: 16_000 });
  // cerebras's hour ceiling implies 18000ms > cap -> dropped. unorouter's
  // 15000ms fits and governs.
  assert.equal(d.paceMs, 15_000, "the pace is set by the providers that fit the budget");
  assert.ok(d.capped.some((c) => c.label === "cerebras"), "the provider needing more than the cap is named");
  // cerebras's hour ceiling falls back to the 240/hour default; with the
  // 1.25 headroom that is 3600000/240*1.25 = 18750ms.
  assert.equal(d.capped[0].neededMs, 18_750);
  assert.match(d.note, /budget-capped/);
  assert.ok(!d.derivedFrom.some((x) => x.label === "cerebras"), "a capped provider does not appear in derivedFrom");
});

test("an empty or unknown set of statements derives the floor and says so honestly", () => {
  const d = derivePaceFromProviders([], { floorMs: 15_000 });
  assert.equal(d.paceMs, 15_000);
  assert.match(d.note, /no provider stated a paceable ceiling/);
  const unknown = derivePaceFromProviders([
    { label: "mystery", classification: classifyRateLimit("429: slow down please") },
  ], { floorMs: 15_000 });
  assert.equal(unknown.paceMs, 15_000, "an unknown window contributes nothing");
  assert.ok(!unknown.derivedFrom.some((x) => x.label === "mystery"));
});
