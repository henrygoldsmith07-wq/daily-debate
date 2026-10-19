// The arm probe: whatever providers an arm names must actually answer before
// the study burns a run on them. A named provider that resolves to nothing is
// NO-KEY (never a fallback to a different provider's judge), and a
// comma-separated arm ("unorouter,openrouter" - the ensemble arm's model
// string) probes EVERY named provider, because an arm whose legs must all
// answer cannot clear its probe while any named provider is dead.

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { runQuotaProbe, resolveJudgeForLabel, PROBE_TRANSCRIPT } from "../quota-probe.mjs";

const originalFetch = globalThis.fetch;
const EST_KEYS = ["OPENROUTER_API_KEY", "UNOROUTER_API_KEY", "NVIDIA_API_KEY"];

/** Stub keys for tests that resolve provider judges; explicitly set values beat .env.local, and are restored after. */
function withNetEnv(fn) {
  const saved = Object.fromEntries(EST_KEYS.map((k) => [k, process.env[k]]));
  process.env.OPENROUTER_API_KEY = "probe-test-key-or";
  process.env.UNOROUTER_API_KEY = "probe-test-key-uno";
  delete process.env.NVIDIA_API_KEY;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });
}

function openAiResponse(text) {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: text } }], usage: { total_tokens: 10, prompt_tokens: 6, completion_tokens: 4 } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}
const verdict = JSON.stringify({ winner: "a", playerAScore: 70, playerBScore: 45, confidence: 0.9 });

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("a single named label probes that provider's own chain", () =>
  withNetEnv(async () => {
    const seen = [];
    globalThis.fetch = async (url, init) => {
      seen.push({ url: String(url), body: JSON.parse(init.body) });
      return openAiResponse(verdict);
    };
    const { line, code } = await runQuotaProbe(["openrouter"]);
    assert.equal(code, 0);
    assert.ok(line.startsWith("PROBE-OK"), line);
    assert.equal(seen.length, 1);
    assert.match(seen[0].url, /openrouter\.ai/);
    assert.equal(
      seen[0].body.messages[1].content,
      `Debate transcript (Player A vs Player B):\n\n${PROBE_TRANSCRIPT}\n\nScore both sides 0-100 on observable argument quality (grounded claims, rebuttals, impact weighing). Decide the winner strictly on that structure.\nIf the structural advantage is small or the sides trade comparable blows, return "tie". Confidence must reflect how clear that advantage is: 0.5-0.6 when genuinely balanced; above 0.8 only for a decisive, one-sided advantage; at or below 0.7 when your edge for the winner rests on a single claim that the exchange itself does not ground.\nReturn JSON exactly: {"winner":"a|b|tie","playerAScore":<int>,"playerBScore":<int>,"confidence":<0..1>}`,
    );
  }));

test("every named provider in a multi-label arm is probed; all must answer", () =>
  withNetEnv(async () => {
    const seen = [];
    globalThis.fetch = async (url) => {
      seen.push(String(url));
      return openAiResponse(verdict);
    };
    const { line, code } = await runQuotaProbe(["unorouter,openrouter"]);
    assert.equal(code, 0);
    assert.ok(line.startsWith("PROBE-OK"), line);
    assert.match(line, /unorouter=/);
    assert.match(line, /openrouter=/);
    assert.equal(seen.length, 2);
    assert.ok(seen.some((u) => /openrouter\.ai/.test(u)));
    assert.ok(seen.some((u) => /unorouter\.com/.test(u)));
  }));

test("one dead leg fails the whole probe - the arm cannot start half-alive", () =>
  withNetEnv(async () => {
    globalThis.fetch = async (url) =>
      /unorouter\.com/.test(String(url)) ? openAiResponse(verdict) : new Response("bad request", { status: 400 });
    const { line, code } = await runQuotaProbe(["unorouter,openrouter"]);
    assert.equal(code, 4);
    assert.ok(line.startsWith("PROBE-FAIL"), line);
    assert.match(line, /\(openrouter\)/);
  }));

test("a named provider with no configured key is NO-KEY, never another provider's judge", () =>
  withNetEnv(async () => {
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      return openAiResponse(verdict);
    };
    const { line, code } = await runQuotaProbe(["nvidia"]); // NVIDIA_API_KEY deleted inside withNetEnv
    assert.equal(code, 3);
    assert.ok(line.startsWith("NO-KEY"), line);
    assert.match(line, /nvidia/);
    assert.equal(called, false, "no call may silently go to a different provider");
  }));

test("an empty label keeps the historical any-configured behaviour", () =>
  withNetEnv(async () => {
    const seen = [];
    globalThis.fetch = async (url) => {
      seen.push(String(url));
      return openAiResponse(verdict);
    };
    const { line, code } = await runQuotaProbe([""]);
    assert.equal(code, 0);
    assert.ok(line.startsWith("PROBE-OK"), line);
    assert.equal(seen.length, 1);
    // Registry order (config/ai-providers.json) puts unorouter first and
    // openrouter last; with both keyed the first configured is unorouter.
    assert.match(seen[0], /api\.unorouter\.com/);
  }));

test("resolveJudgeForLabel: strict match, no fuzzy fallthrough", () => {
  assert.equal(resolveJudgeForLabel("sneaky", {}), null, "an unknown label resolves to nothing");
});
