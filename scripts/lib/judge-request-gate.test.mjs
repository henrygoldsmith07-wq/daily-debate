// The request-rate gate: free tiers cap REQUESTS PER MINUTE, not judge calls.
// One judge call can issue several requests: the chain walks each model in turn
// (a retired model answers 404 and the walk continues) and each model may be
// retried on a transport error. A gate that counted judge calls therefore let
// the real request rate exceed the documented ceiling several times over, and
// the provider answered 429 - which the benchmark then scored as a judge-quality
// signal instead of a transport fact.
//
// The load-bearing case is the RETIRED MODEL walk: a 404 is not a transport
// error, so the chain does not retry and does not back off - it walks to the
// next model IMMEDIATELY. That is the burst the gate has to prevent, and it is
// exactly what unorouter did while its primary slug was 404-retired.
// A test that only issues one request would pass even with the old call-level
// gate, so each case here drives a chain that must issue several requests.

import test from "node:test";
import assert from "node:assert/strict";
import { setRequestGateMs, getRequestGateMs, makeChainJudgeForTest } from "./judge-providers.mjs";

const originalFetch = globalThis.fetch;

/**
 * A fetch stub that records the wall-clock time of every request it serves.
 * `notFound` requests answer 404 (a retired model: the chain walks to the
 * next model at once, with no retry and no back-off). `rateLimited` requests
 * answer 429 (a transport error: the chain retries with a back-off).
 */
function recordingFetch({ notFound = 0, rateLimited = 0 } = {}) {
  const times = [];
  let served = 0;
  globalThis.fetch = async () => {
    times.push(Date.now());
    served += 1;
    if (served <= notFound) {
      return { ok: false, status: 404, headers: { get: () => null }, text: async () => '{"error":"model_not_found"}' };
    }
    if (served <= notFound + rateLimited) {
      return { ok: false, status: 429, headers: { get: () => null }, text: async () => "429 too many requests" };
    }
    const body = { winner: "tie", playerAScore: 50, playerBScore: 50, confidence: 0.5 };
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }),
    };
  };
  return times;
}

const GATE_MS = 120;
const PROMPT = "Side A (round 1): a claim.\nSide B (round 1): a counter-claim.";

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  setRequestGateMs(0);
});

/** Every consecutive request gap must be at least the gate (minus timer slop). */
function assertSpaced(times, label) {
  assert.ok(times.length >= 2, `${label}: the case must issue several requests, saw ${times.length}`);
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1];
    assert.ok(gap >= GATE_MS - 20, `${label}: consecutive requests must be spaced by the gate, saw ${gap}ms at index ${i}`);
  }
}

test("the gate is off by default and can be read back", () => {
  setRequestGateMs(0);
  assert.equal(getRequestGateMs(), 0, "the default must preserve the historical unpaced behaviour");
  setRequestGateMs(250);
  assert.equal(getRequestGateMs(), 250);
  setRequestGateMs(0);
  assert.equal(getRequestGateMs(), 0);
});

test("a retired model (404) makes the chain walk, and the gate spaces that walk", async () => {
  // model-a answers 404 (retired slug), the chain walks to model-b, which
  // answers. Two requests inside one judge call, issued back to back without
  // the gate.
  const times = recordingFetch({ notFound: 1 });
  setRequestGateMs(GATE_MS);

  const judge = makeChainJudgeForTest({
    url: "https://example.invalid/v1/chat/completions",
    key: "k",
    models: ["model-a", "model-b"],
  });
  await judge(PROMPT);

  assertSpaced(times, "retired-model-walk");
});

test("a judge call that fails on every model still spaces every request", async () => {
  // Every request 429s, so the chain burns both models x both attempts:
  // 4 requests inside a single judge call, then rejects.
  const times = recordingFetch({ rateLimited: 99 });
  setRequestGateMs(GATE_MS);

  const judge = makeChainJudgeForTest({
    url: "https://example.invalid/v1/chat/completions",
    key: "k",
    models: ["model-a", "model-b"],
  });
  await assert.rejects(() => judge(PROMPT));

  assertSpaced(times, "all-fail");
});

test("the gate is what spaces the retired-model walk: with it off, the walk bursts", async () => {
  // The counterfactual that makes the test above meaningful. With the gate off
  // (the pre-fix behaviour) the 404 walk issues its second request at once -
  // the exact burst that overran the provider's per-minute ceiling.
  const times = recordingFetch({ notFound: 1 });
  setRequestGateMs(0);

  const judge = makeChainJudgeForTest({
    url: "https://example.invalid/v1/chat/completions",
    key: "k",
    models: ["model-a", "model-b"],
  });
  await judge(PROMPT);

  assert.ok(times.length >= 2, "the case must issue several requests");
  const burst = times[times.length - 1] - times[0];
  assert.ok(burst < GATE_MS - 20, `without the gate the walk must burst, saw a ${burst}ms spread`);
});
