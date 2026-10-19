// The registered two-model ensemble arm (`ensemble-two-model-agreement`):
// strict both-legs execution, deterministic mean/tie/discount aggregation,
// exact-two-provider selection, and the byte-identical shipped prompt on both
// legs. Network is stubbed with a fetch mock.

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  aggregateEnsembleVerdicts,
  allJudgeProviders,
  buildVerdictSystem,
  ENSEMBLE_DISAGREEMENT_DISCOUNT,
} from "./judge-providers.mjs";
import { EXPERIMENTS, experimentSystem } from "./judge-experiments.mjs";
import { validateRegistration } from "./judge-registration.mjs";

const originalFetch = globalThis.fetch;
const V = (winner, playerAScore, playerBScore, confidence) =>
  JSON.stringify({ winner, playerAScore, playerBScore, confidence });

function openAiResponse(model, text, { usage = { total_tokens: 10, prompt_tokens: 6, completion_tokens: 4 } } = {}) {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }], usage }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const envWith = (extra = {}) => ({ OPENROUTER_API_KEY: "k-or", UNOROUTER_API_KEY: "k-uno", ...extra });

/** Judge the ensemble selected over the two registered providers. */
function ensembleJudge(env = envWith()) {
  const judges = allJudgeProviders(env, { kind: "ensemble-two-model", select: ["openrouter", "unorouter"] });
  assert.equal(judges.length, 1, "expected exactly one two-leg ensemble judge");
  return judges[0];
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// --- Deterministic aggregation (pure) ---------------------------------------

test("aggregation: agreeing legs take mean scores and mean confidence, no discount", () => {
  const out = aggregateEnsembleVerdicts(
    { winner: "a", a: 70, b: 50, confidence: 0.8 },
    { winner: "a", a: 62, b: 44, confidence: 0.7 },
  );
  assert.deepEqual(out, {
    winner: "a",
    a: 66,
    b: 47,
    disagree: false,
    confidence: 0.75,
    disagreementDiscount: ENSEMBLE_DISAGREEMENT_DISCOUNT,
  });
});

test("aggregation: decisive disagreement whose mean gap clears the tie threshold keeps a winner at halved confidence", () => {
  // mean a=(80+45)/2=62.5->63, b=(55+80)/2=67.5->68, gap=5 (not < 5)
  const out = aggregateEnsembleVerdicts(
    { winner: "a", a: 80, b: 55, confidence: 0.9 },
    { winner: "b", a: 45, b: 80, confidence: 0.7 },
  );
  assert.equal(out.winner, "b");
  assert.equal(out.a, 63);
  assert.equal(out.b, 68);
  assert.equal(out.disagree, true);
  assert.equal(out.confidence, 0.4);
});

test("aggregation: cross-model disagreement inside the threshold resolves to tie (never a forced winner)", () => {
  const out = aggregateEnsembleVerdicts(
    { winner: "a", a: 60, b: 50, confidence: 0.9 },
    { winner: "b", a: 50, b: 62, confidence: 0.85 },
  );
  assert.equal(out.winner, "tie");
  assert.equal(out.disagree, true);
  assert.equal(out.confidence, +(0.875 * 0.5).toFixed(4));
});

test("aggregation: a leg calling tie disagrees with a decisive leg", () => {
  const out = aggregateEnsembleVerdicts(
    { winner: "tie", a: 58, b: 55, confidence: 0.7 },
    { winner: "a", a: 70, b: 45, confidence: 0.9 },
  );
  assert.equal(out.winner, "a");
  assert.equal(out.disagree, true);
  assert.equal(out.confidence, 0.4);
});

test("aggregation: both legs tie -> tie without discount; float dust is rounded away", () => {
  const out = aggregateEnsembleVerdicts(
    { winner: "tie", a: 60, b: 58, confidence: 0.7 },
    { winner: "tie", a: 55, b: 53, confidence: 0.65 },
  );
  assert.equal(out.winner, "tie");
  assert.equal(out.disagree, false);
  assert.equal(out.confidence, 0.675);
});

// --- Provider selection (build-time only, no network) ------------------------

test("selection: no keys -> no ensemble judge", () => {
  assert.deepEqual(allJudgeProviders({}, { kind: "ensemble-two-model", select: ["openrouter", "unorouter"] }), []);
});

test("selection: exactly two usable providers -> one ensemble judge, members in registry order", () => {
  const judges = allJudgeProviders(envWith(), { kind: "ensemble-two-model", select: ["unorouter", "openrouter"] });
  assert.equal(judges.length, 1);
  assert.equal(judges[0].id, "ensemble:unorouter+openrouter");
  assert.equal(judges[0].stats.jobs, 0);
});

test("selection: extra configured providers outside the selection never leak into the ensemble", () => {
  const judges = allJudgeProviders(envWith({ NVIDIA_API_KEY: "k-nv" }), { kind: "ensemble-two-model", select: ["openrouter", "unorouter"] });
  assert.equal(judges.length, 1);
  assert.equal(judges[0].id, "ensemble:unorouter+openrouter");
});

test("selection: fewer or more than two selected providers is not the registered architecture", () => {
  assert.deepEqual(
    allJudgeProviders(envWith(), { kind: "ensemble-two-model", select: ["openrouter"] }),
    [],
    "one selected provider cannot form an ensemble",
  );
  assert.deepEqual(
    allJudgeProviders(envWith({ NVIDIA_API_KEY: "k-nv", KIRAAI_API_KEY: "k-ki", KIRAAI_ENABLED: "1" }), {
      kind: "ensemble-two-model",
      select: ["openrouter", "unorouter", "nvidia"],
    }),
    [],
    "a three-way ensemble is a different arm; refuse to build it",
  );
});

// --- Behaviour through the full judge path (stubbed transport) ----------------

test("ensemble judge: both legs run on the same shipped prompt and the aggregated row carries leg diaries", async () => {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), body: JSON.parse(init.body) });
    const body = String(url).includes("unorouter.com") ? V("a", 62, 44, 0.7) : V("a", 70, 45, 0.9);
    return openAiResponse("leg", body);
  };
  const judge = ensembleJudge();
  const row = await judge.fn("Side A claims X.\nSide B counters.");
  assert.equal(row.model, "ensemble(unorouter+openrouter)");
  assert.equal(row.winner, "a");
  assert.equal(row.a, 66); // mean of 70 and 62
  assert.equal(row.b, 45); // (45+44)/2 = 44.5 rounds up
  assert.equal(row.disagree, false);
  assert.equal(row.confidence, 0.8);
  assert.equal(row.envelope.kind, "ensemble-two-model");
  assert.equal(row.envelope.disagreementDiscount, ENSEMBLE_DISAGREEMENT_DISCOUNT);
  assert.equal(row.legs.length, 2);
  for (const leg of row.legs) {
    assert.ok(["openrouter", "unorouter"].includes(leg.label));
    assert.equal(leg.winner, "a");
  }
  assert.equal(row.tokens, 20);
  assert.equal(row.promptTokens, 12);
  assert.equal(row.completionTokens, 8);
  // Both legs see the byte-identical shipped system prompt and the same transcript.
  assert.equal(seen.length, 2);
  for (const s of seen) {
    assert.equal(s.body.messages[0].role, "system");
    assert.equal(s.body.messages[0].content, buildVerdictSystem());
    assert.match(s.body.messages[1].content, /Side A claims X\./);
    assert.equal(s.body.temperature, 0);
  }
  // Shared transport stats: one ensemble call issues one call per leg.
  assert.equal(judge.stats.jobs, 2);
  assert.equal(judge.stats.succeeded, 2);
  assert.equal(Object.keys(judge.stats.byModel).length, 2);
});

test("ensemble judge: a failed leg fails the fixture - the healthy leg's verdict is never served as the ensemble", async () => {
  globalThis.fetch = async (url) => {
    if (String(url).includes("unorouter.com")) {
      return openAiResponse("leg", V("a", 70, 45, 0.9));
    }
    // 400 without the word "reasoning": a non-transport error, so the chain
    // fails fast without retry sleeps.
    return new Response("bad request", { status: 400 });
  };
  const judge = ensembleJudge();
  await assert.rejects(() => judge.fn("transcript"), /ensemble leg\(s\) failed[\s\S]*openrouter\(/);
  assert.equal(judge.stats.jobs >= 1, true);
  assert.equal(judge.stats.errors >= 1, true);
  assert.equal(judge.stats.succeeded >= 1, true);
});

test("ensemble judge: leg-level output is normalised by the leg's own tie policy before aggregation", async () => {
  globalThis.fetch = async (url) =>
    openAiResponse("leg", String(url).includes("unorouter.com") ? V("a", 70, 50, 0.8) : V("a", 52, 49, 0.9));
  const judge = ensembleJudge();
  const row = await judge.fn("transcript");
  // The openrouter leg's 52-49 is tie-normalised; the ensemble mean is
  // a=(70+52)/2=61, b=(50+49)/2=49.5->50, gap 11 -> winner "a"; the tie leg counts as disagreement.
  assert.equal(row.legs.find((l) => l.label === "openrouter").winner, "tie");
  assert.equal(row.winner, "a");
  assert.equal(row.disagree, true);
  assert.equal(row.confidence, 0.425); // (0.8 + 0.9) / 2 = 0.85, halved
});

// --- Registration is executable once the arm exists --------------------------

test("the ensemble registration validates and its candidate arm must use the byte-identical shipped prompt", async () => {
  const regPath = path.resolve(import.meta.dirname, "..", "..", "docs", "judge-experiments", "registrations", "ensemble-two-model-agreement.json");
  const reg = JSON.parse(await readFile(regPath, "utf8"));
  const validation = validateRegistration(reg, { experiments: EXPERIMENTS });
  assert.deepEqual(validation.errors, []);
  assert.equal(reg.arms.candidate.experiment, "ensemble-two-model");
  assert.equal(EXPERIMENTS["ensemble-two-model"].implementationPending, undefined, "implemented arms cannot carry the pending flag");
  assert.equal(EXPERIMENTS["ensemble-two-model"].kind, "ensemble-two-model");
  const baseline = experimentSystem("baseline");
  const candidate = experimentSystem("ensemble-two-model");
  assert.equal(candidate.system, baseline.system, "the ensemble arm changes the AGGREGATION, never the prompt");
  assert.equal(candidate.isDefault, true);
});
