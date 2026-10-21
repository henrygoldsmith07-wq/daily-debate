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
import { classifyRateLimit, describeRateLimit, RATE_LIMIT_HEADROOM } from "./rate-limit.mjs";

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
