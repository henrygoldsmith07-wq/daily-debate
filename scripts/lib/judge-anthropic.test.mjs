// The Anthropic (pinned paid) benchmark judge: explicit `--models anthropic`
// selection only, never part of the default sweep, and byte-identical verdict
// prompt semantics to the chain judges (same normaliseVerdict tie policy).

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { anthropicJudgeFor, makeAnthropicJudge, buildVerdictSystem } from "./judge-providers.mjs";

const originalFetch = globalThis.fetch;

function anthropicResponse(text, { usage = { input_tokens: 700, output_tokens: 90 } } = {}) {
  return new Response(
    JSON.stringify({ content: [{ type: "text", text }], usage }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("anthropicJudgeFor returns null without a key and never joins the default sweep", () => {
  assert.equal(anthropicJudgeFor({}), null);
  const keyed = anthropicJudgeFor({ ANTHROPIC_API_KEY: "sk-test" });
  assert.ok(keyed);
  assert.equal(keyed.id, "anthropic:claude-sonnet-5");
  assert.equal(keyed.stats.jobs, 0);
});

test("ANTHROPIC_MODEL pins the exact model id in the judge id and the request", async () => {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
    return anthropicResponse(JSON.stringify({ winner: "a", playerAScore: 71, playerBScore: 40, confidence: 0.8 }));
  };
  const judge = anthropicJudgeFor({ ANTHROPIC_API_KEY: "sk-test", ANTHROPIC_MODEL: "claude-opus-6" });
  assert.equal(judge.id, "anthropic:claude-opus-6");
  const v = await judge.fn("Side A (round 1): claim.\nSide B (round 1): counter.");
  assert.equal(v.model, "claude-opus-6");
  assert.equal(v.winner, "a");
  assert.match(seen[0].url, /api\.anthropic\.com/);
  assert.equal(seen[0].headers["x-api-key"], "sk-test");
  assert.ok(seen[0].headers["anthropic-version"]);
  assert.equal(seen[0].body.model, "claude-opus-6");
  assert.equal(seen[0].body.temperature, 0);
  assert.equal(seen[0].body.system, buildVerdictSystem());
  assert.equal(judge.stats.jobs, 1);
  assert.equal(judge.stats.succeeded, 1);
  assert.equal(judge.stats.errors, 0);
});

test("the production tie policy is applied: a <5-point gap is normalised to a tie", async () => {
  globalThis.fetch = async () =>
    anthropicResponse(JSON.stringify({ winner: "a", playerAScore: 52, playerBScore: 49, confidence: 0.9 }));
  const judge = anthropicJudgeFor({ ANTHROPIC_API_KEY: "sk-test" });
  const v = await judge.fn("transcript");
  assert.equal(v.winner, "tie");
});

test("usage tokens flow into the run metrics for capacity accounting", async () => {
  globalThis.fetch = async () =>
    anthropicResponse(JSON.stringify({ winner: "tie", playerAScore: 50, playerBScore: 50, confidence: 0.6 }));
  const judge = anthropicJudgeFor({ ANTHROPIC_API_KEY: "sk-test" });
  const v = await judge.fn("transcript");
  assert.equal(v.promptTokens, 700);
  assert.equal(v.completionTokens, 90);
  assert.equal(v.tokens, 790);
});

test("a transport failure is reported as an error, not a verdict", async () => {
  globalThis.fetch = async () => new Response("overloaded", { status: 529 });
  const judge = anthropicJudgeFor({ ANTHROPIC_API_KEY: "sk-test" });
  await assert.rejects(() => judge.fn("transcript"), /529/);
  assert.equal(judge.stats.errors >= 1, true);
  assert.equal(judge.stats.succeeded, 0);
});

test("makeAnthropicJudge rejects empty content instead of inventing a verdict", async () => {
  globalThis.fetch = async () => anthropicResponse("   ");
  const fn = makeAnthropicJudge({ key: "k", model: "m" });
  await assert.rejects(() => fn("transcript"), /empty content/);
});
