// Provider adapters for the live judge benchmark and topic generation: a
// registry of interchangeable OpenAI-compatible transports, each with its own
// model chain. Mirrors src/lib/openrouter.ts (the app's transports) so the
// benchmark validates the same providers production uses.
//
// Configured providers, in config/ai-providers.json priority order (shared
// with the app), plus KIRAAI_API_KEY (opt-in only, benchmark history). All
// free tiers; there is no paid judge. Model overrides use <LABEL>_MODEL and
// <LABEL>_FALLBACK_MODELS (comma-separated; empty pins one).

import providerConfig from "../../config/ai-providers.json" with { type: "json" };

function extractJson(text) {
  const trimmed = String(text ?? "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in output");
  return JSON.parse(candidate.slice(start, end + 1));
}

const VERDICT_SYSTEM_BASE =
  "You are a neutral, rigorous debate judge. Analyse the observable argument structure only — never which side of the topic is 'correct'. Judge only what is argued and shown: identical content earns identical scores regardless of which label (A or B) speaks it, and length, repetition, formatting, fluency or confident tone are not argument quality. ";
const VERDICT_SYSTEM_TAIL = " Do not reward verbosity, fluency, or confidence by itself; credit grounded claims, direct engagement, and weighing that is supported.";

/**
 * The ONE clause about citations/evidence standing is parameterised so a
 * single-variable experiment can change only it (never rewrite the whole
 * prompt per experiment - multi-rule stacks cannot be attributed).
 * v5 default clause (shipped):
 */
export const CITATION_CLAUSE_DEFAULT =
  "Named sources, institutions and statistics count only where the argument makes the evidence usable (mechanism, figure, context); authoritative-sounding references without usable content are noise, not strength.";

export function buildVerdictSystem(citationClause = CITATION_CLAUSE_DEFAULT) {
  return VERDICT_SYSTEM_BASE + citationClause + VERDICT_SYSTEM_TAIL;
}

/** Benchmark verdict-prompt wording. v5 (2026-09-14): fairness clauses added
 *  against live diagnostic evidence (label/format flips, ungrounded-citation
 *  influence, overconfidence) — general judge-policy wording only, never
 *  fixture-specific tuning. Production's graph-extraction leg (openrouter.ts
 *  judge_pvp) carries the same clauses at PROMPT_VERSION 4.
 *  Experiment variants change only CITATION_CLAUSE via buildVerdictSystem. */
export const VERDICT_PROMPT_VERSION = 5;

export function verdictUser(transcript) {
  return `Debate transcript (Player A vs Player B):\n\n${transcript}\n\nScore both sides 0-100 on observable argument quality (grounded claims, rebuttals, impact weighing). Decide the winner strictly on that structure.\nIf the structural advantage is small or the sides trade comparable blows, return "tie". Confidence must reflect how clear that advantage is: 0.5-0.6 when genuinely balanced; above 0.8 only for a decisive, one-sided advantage; at or below 0.7 when your edge for the winner rests on a single claim that the exchange itself does not ground.\nReturn JSON exactly: {"winner":"a|b|tie","playerAScore":<int>,"playerBScore":<int>,"confidence":<0..1>}`;
}

function normaliseVerdict(parsed) {
  const clamp = (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
  let winner = ["a", "b", "tie"].includes(parsed.winner) ? parsed.winner : "tie";
  const a = clamp(parsed.playerAScore);
  const b = clamp(parsed.playerBScore);
  // Production tie policy: observableAssessment (WINNER_TIE_THRESHOLD = 5)
  // only declares a winner when the score gap clears the threshold. A judge
  // awarding 52-49 must say "tie" — exactly what the app does downstream of
  // extraction. Aligned here so the benchmark measures the production
  // verdict rule, not a harsher one the product never applies.
  if (winner !== "tie" && Math.abs(a - b) < 5) winner = "tie";
  return {
    winner,
    a,
    b,
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
  };
}

async function chat({ url, key, model, system, user, maxTokens, extraHeaders = {}, timeoutMs = 35_000, disableReasoning = true, reasoningToggle = true, extraBody = {} }) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const payload = {
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      max_tokens: maxTokens,
      temperature: 0,
    };
    // Free Nemotron models bill thinking tokens against max_tokens; the
    // verdict JSON is small, so reasoning is disabled (OpenRouter-style
    // gateways) or set low (extraBody, e.g. gpt-oss reasoning_effort) exactly
    // like the app's transport (openrouter.ts post()). Endpoints that reject
    // either are retried without them.
    if (disableReasoning) {
      if (reasoningToggle) payload.reasoning = { enabled: false };
      Object.assign(payload, extraBody);
    }
    // The gate sits here, immediately before the fetch, so it counts the
    // requests the provider actually receives - including the requests the
    // chain walk and the transport retries make on top of the judge call.
    await waitForRequestSlot();
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...extraHeaders },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const bodyText = await res.text();
    if (!res.ok) {
      if (disableReasoning && res.status === 400 && /reasoning/i.test(bodyText)) {
        return chat({ url, key, model, system, user, maxTokens, extraHeaders, timeoutMs, disableReasoning: false, reasoningToggle, extraBody });
      }
      const err = new Error(`${res.status}: ${bodyText.slice(0, 160)}`);
      err.httpStatus = res.status;
      err.retryAfterSec = Number(res.headers?.get?.("retry-after")) || null;
      throw err;
    }
    const data = JSON.parse(bodyText);
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new Error("empty content");
    return {
      content,
      tokens: data?.usage?.total_tokens ?? null,
      promptTokens: data?.usage?.prompt_tokens ?? null,
      completionTokens: data?.usage?.completion_tokens ?? null,
      latencyMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The provider registry: config/ai-providers.json, the same list and priority
 * order the app reads (src/lib/openrouter.ts), so the benchmark and topic
 * generation run the chain production runs. Script-only additions below.
 */
const sharedProviders = providerConfig.providers;

/** Script-side request extras the app sets differently (attribution only). */
const SCRIPT_EXTRA_HEADERS = {
  openrouter: { "HTTP-Referer": "https://daily-debate.app" },
};

export const PROVIDERS = [
  ...sharedProviders.map((p) => ({
    ...p,
    ...(SCRIPT_EXTRA_HEADERS[p.label] ? { extraHeaders: SCRIPT_EXTRA_HEADERS[p.label] } : {}),
  })),
  // Benchmark history only — not in the app chain, and providerUsable keeps
  // it off without an explicit KIRAAI_ENABLED=1.
  {
    label: "kiraai",
    keyEnv: "KIRAAI_API_KEY",
    url: "https://kiraai.vn/api/v1/chat/completions",
    // 2026-09-15: kiraai retired ALL "-free" slugs mid-session (hard 404 -
    // they powered the day's studies and vanished from the catalog; mimo was
    // the first to go). Base slugs exist but bill against the account
    // wallet (402 at 0 VND). Chain points at surviving slugs; the provider
    // is unusable until the wallet or a free tier returns - scripts/quota-probe.mjs
    // documents that live state instead of assuming.
    defaultModel: "qwen3.8-flash",
    fallbacks: ["glm-5.3", "hy3"],
    reasoningToggle: true,
  },
];

export function providerStatus(env = process.env) {
  return PROVIDERS.filter((p) => (env[p.keyEnv] ?? "").trim().length > 0).map((p) => p.label);
}

function flagSet(value) {
  return /^(1|true|yes)$/i.test(String(value ?? "").trim());
}

/**
 * Whether a configured provider may actually be called. A present key is
 * necessary but not sufficient:
 * - `<LABEL>_DISABLED=1` explicitly removes a provider (incident response).
 * - `kiraai` additionally requires `KIRAAI_ENABLED=1`: its free tier was
 *   retired mid-session (hard 404s, then wallet-billed 402s), so calling it
 *   on key presence alone burns a whole ladder slot on a known-dead tier.
 *   Re-enable deliberately once capacity is confirmed (see quota-probe.mjs).
 */
export function providerUsable(provider, env = process.env) {
  if (!((env[provider.keyEnv] ?? "").trim().length > 0)) return false;
  if (flagSet(env[`${provider.label.toUpperCase()}_DISABLED`])) return false;
  if (provider.label === "kiraai" && !flagSet(env.KIRAAI_ENABLED)) return false;
  return true;
}

/** Usable providers in configured priority order (never blind-calls the dead). */
export function usableProviders(env = process.env) {
  return PROVIDERS.filter((p) => providerUsable(p, env));
}

/**
 * GLOBAL request-rate throttle, shared by every provider call in this process.
 *
 * Free tiers cap REQUESTS PER MINUTE, not judge calls. One judge call can
 * issue several HTTP requests: the chain walks each model in turn (a retired
 * model answers 404 and the walk continues) and each model may be retried on
 * a transport error. Throttling only the judge call therefore let the real
 * request rate exceed the documented ceiling several times over, and the
 * provider answered 429 - which the benchmark then scored as a judge-quality
 * signal instead of a transport fact.
 *
 * The gate is applied inside chat(), i.e. immediately before each fetch, so
 * it counts exactly the requests the provider sees. It is deliberately
 * process-global and provider-agnostic: one shared account is one shared
 * budget, and the study runs one provider at a time anyway.
 *
 * 0 disables the gate entirely, which preserves the historical behaviour.
 */
let requestGateMs = 0;
let lastRequestAt = 0;

export function setRequestGateMs(ms) {
  requestGateMs = Number.isFinite(ms) && ms > 0 ? Number(ms) : 0;
  lastRequestAt = 0;
}

export function getRequestGateMs() {
  return requestGateMs;
}

async function waitForRequestSlot() {
  if (requestGateMs <= 0) return;
  const wait = lastRequestAt + requestGateMs - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

/** Model chain for one provider entry: primary + fallbacks (env-overridable). */
export function chainFor(provider, env = process.env) {
  const upper = provider.label.toUpperCase();
  const primary = env[`${upper}_MODEL`] || provider.defaultModel;
  const fallbacks = env[`${upper}_FALLBACK_MODELS`] !== undefined
    ? env[`${upper}_FALLBACK_MODELS`].split(",").map((m) => m.trim()).filter(Boolean)
    : provider.fallbacks;
  return [primary, ...fallbacks.filter((m) => m !== primary)];
}

/**
 * Every USABLE provider's chain in priority order, for provider-level
 * failover: exhaust provider A's models, then B's, and so on, before the
 * curated fallback. Providers without capacity are skipped, never called.
 */
export function generationChains(env = process.env) {
  return usableProviders(env).map((provider) => ({
    label: provider.label,
    url: provider.url,
    key: (env[provider.keyEnv] ?? "").trim(),
    models: chainFor(provider, env),
    extraHeaders: provider.extraHeaders ?? {},
    extraBody: provider.extraBody ?? {},
  }));
}

/** Chain judge: tries each model in order; the judge id names the primary.
 *  One transport retry per model on 429/5xx/timeout/network (honouring small
 *  Retry-After values) mirrors the app's own retry policy (src/lib/openrouter
 *  .ts MAX_ATTEMPTS/RETRY_BUDGET), so the benchmark measures the reliability
 *  production actually gets. Malformed model output is deterministic at
 *  temperature 0 and is never retried — that is a model-quality signal. */
const CHAIN_ATTEMPTS_PER_MODEL = 2;
const CHAIN_RETRY_BUDGET_MS = 8_000;
export const RETRY_POLICY = { attemptsPerModel: CHAIN_ATTEMPTS_PER_MODEL, budgetMs: CHAIN_RETRY_BUDGET_MS };

function isTransportError(e) {
  const s = e?.httpStatus;
  if (s === 429 || (s >= 500 && s <= 599)) return true;
  return /abort|fetch failed|network|ETIMEDOUT|ECONN/i.test(String(e?.message ?? e));
}

/** The request-shape fields chat() needs from a registry entry. */
function requestCompat(provider) {
  return { reasoningToggle: provider.reasoningToggle !== false, extraBody: provider.extraBody ?? {} };
}

/**
 * Test seam for the request-rate gate. The gate lives inside chat(), so the
 * only way to prove it counts REQUESTS rather than judge calls is to drive a
 * real chain judge against a stubbed fetch and measure the request times.
 * Exported for scripts/lib/judge-request-gate.test.mjs; not used in production.
 */
export function makeChainJudgeForTest(opts) {
  return makeChainJudge(opts);
}

function makeChainJudge({ url, key, models, extraHeaders = {}, system = buildVerdictSystem(), userFn = verdictUser, maxTokens = 900, stats = null, reasoningToggle = true, extraBody = {} }) {
  return async (input) => {
    let lastError;
    const chainErrors = {};
    const started = Date.now();
    if (stats) stats.jobs += 1;
    for (const model of models) {
      for (let attempt = 1; attempt <= CHAIN_ATTEMPTS_PER_MODEL; attempt++) {
        try {
          if (stats) {
            stats.attempts += 1;
            stats.byModel[model] = (stats.byModel[model] ?? 0) + 1;
          }
          const { content, tokens, promptTokens, completionTokens, latencyMs } = await chat({
            url, key, model, system, user: userFn(input), maxTokens, extraHeaders, reasoningToggle, extraBody,
          });
          if (stats) stats.succeeded += 1;
          return { ...normaliseVerdict(extractJson(content)), model, tokens, promptTokens, completionTokens, latencyMs };
        } catch (e) {
          if (stats) stats.errors += 1;
          chainErrors[model] = String(e?.message ?? e).slice(0, 90);
          lastError = e;
          if (attempt >= CHAIN_ATTEMPTS_PER_MODEL || !isTransportError(e)) break;
          const backoff = Math.min(e.retryAfterSec ? e.retryAfterSec * 1000 : 1200 * attempt, Math.max(0, CHAIN_RETRY_BUDGET_MS - (Date.now() - started)));
          if (backoff <= 0) break;
          if (stats) stats.backoffMs += backoff;
          await new Promise((r) => setTimeout(r, backoff));
        }
      }
    }
    if (lastError) {
      // Attach (do not replace) so error classification keeps the real status
      // line while probes and diagnostics can see the whole chain.
      lastError.chainErrors = chainErrors;
    }
    throw lastError ?? new Error("no models configured");
  };
}

// --- Architecture arms (item 6-7): evidence-grounding pass, then verdict ----
// ONE controlled architecture change: pass 1 extracts each side's claims and
// classifies every piece of supplied evidence as supported / unsupported /
// unverifiable FROM THE TRANSCRIPT ALONE; pass 2 judges the standard verdict
// question from that grounded representation plus the transcript, under an
// explicit rule that a citation string with unverifiable content raises
// neither score nor confidence. Latency and tokens now cover BOTH calls, so
// the trade-off is measured, not assumed.

export const EXTRACT_SYSTEM =
  "You extract argument structure from debate transcripts with zero interpretation. For each side list its main claims and, for each claim, the evidence supplied FOR it in the transcript. Classify every evidence item as: supported (the transcript conveys the source's content or mechanism), unsupported (claim with no cited source at all), or unverifiable (a source/statistic is named but the transcript does not show its content). Return JSON only: {\"sides\":[{\"side\":\"a\",\"claims\":[{\"claim\":\"<=20 words\",\"evidence\":[{\"text\":\"<=20 words\",\"status\":\"supported|unsupported|unverifiable\"}]}]},{\"side\":\"b\",\"claims\":[...]}]}";

export function groundingVerdictUser(grounded) {
  return (transcript) =>
    `Grounded evidence representation (extracted by a prior pass; statuses are the transcript's own verifiability, not the sources' real truth):\n${JSON.stringify(grounded)}\n\nDebate transcript (Player A vs Player B):\n\n${transcript}\n\nScore both sides 0-100 on observable argument quality using the grounded representation: credit supported evidence, treat unsupported assertions equally on both sides, and let unverifiable citation strings add NOTHING to score or confidence - a named source whose content cannot be checked from the material is rhetorical decoration, not evidence. Decide the winner strictly on structure; if the structural advantage is small or the sides trade comparable blows, return "tie". Confidence must reflect how clear the advantage is: 0.5-0.6 when balanced, above 0.8 only for decisive one-sided structure, and never above 0.75 when the leading side's edge depends on unverifiable evidence.\nReturn JSON exactly: {"winner":"a|b|tie","playerAScore":<int>,"playerBScore":<int>,"confidence":<0..1>}`;
}

function makeGroundingJudge({ url, key, models, extraHeaders = {}, system = buildVerdictSystem(), stats = null, reasoningToggle = true, extraBody = {} }) {
  // Pass 1: extract + classify evidence verifiability. One attempt per chain
  // model (no verdict parsing); failures surface as ordinary call errors, so
  // the arm's reliability is measured honestly, not flattered by retries.
  async function extractPass(transcript) {
    let lastError;
    for (const model of models) {
      if (stats) stats.jobs += 1;
      try {
        if (stats) { stats.attempts += 1; stats.byModel[model] = (stats.byModel[model] ?? 0) + 1; }
        const { content, tokens, promptTokens, completionTokens, latencyMs } = await chat({
          url, key, model, system: EXTRACT_SYSTEM, user: `Transcript:\n\n${transcript}\n\nReturn only the JSON.`,
          maxTokens: 1_200, extraHeaders, reasoningToggle, extraBody,
        });
        if (stats) stats.succeeded += 1;
        return { grounding: extractJson(content), tokens, promptTokens, completionTokens, latencyMs };
      } catch (e) {
        if (stats) stats.errors += 1;
        lastError = e;
      }
    }
    throw lastError ?? new Error("extraction failed");
  }
  return async (transcript) => {
    const g = await extractPass(transcript);
    const judge = makeChainJudge({
      url, key, models, extraHeaders, stats, reasoningToggle, extraBody,
      system,
      userFn: groundingVerdictUser(g.grounding),
    });
    const v = await judge(transcript);
    return {
      ...v,
      tokens: (g.tokens ?? 0) + (v.tokens ?? 0),
      promptTokens: (g.promptTokens ?? 0) + (v.promptTokens ?? 0),
      completionTokens: (g.completionTokens ?? 0) + (v.completionTokens ?? 0),
      latencyMs: (g.latencyMs ?? 0) + (v.latencyMs ?? 0),
    };
  };
}

/**
 * Ensemble arm (registered 2026-09-16, `ensemble-two-model-agreement`):
 * exactly two configured providers judge the SAME transcript with the SAME
 * shipped system prompt and verdict question (each leg keeps its own full
 * model chain + retry policy). The ensemble verdict is deterministic:
 * mean scores, the production tie rule applied to the MEAN gap, and mean
 * confidence — discounted when the legs disagree on the winner (a leg saying
 * "tie" counts as disagreeing with a decisive leg). No prompt changes.
 *
 * A failed leg fails the fixture. Serving the surviving leg's verdict as the
 * "ensemble" would measure a different architecture (1-2 legs, availability
 * dependent) and corrupt the mean, so both legs must produce a verdict; the
 * registered reliability floor then prices leg failure honestly.
 */

export const ENSEMBLE_DISAGREEMENT_DISCOUNT = 0.5;

/** Deterministic aggregation of exactly two normalised leg verdicts. */
export function aggregateEnsembleVerdicts(legA, legB, discount = ENSEMBLE_DISAGREEMENT_DISCOUNT) {
  const clamp = (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
  const a = Math.round((clamp(legA.a) + clamp(legB.a)) / 2);
  const b = Math.round((clamp(legA.b) + clamp(legB.b)) / 2);
  // Production tie policy on the MEAN gap (observableAssessment
  // WINNER_TIE_THRESHOLD): identical to what the app does downstream of
  // extraction. Two unanimous-decisive legs (both winner "a" with per-leg
  // gaps >= 5) mathematically imply a mean gap >= 5, so a mean below the
  // threshold can only arise from genuine cross-model disagreement — the
  // mean rule never overrides two agreeing decisive legs.
  const winner = Math.abs(a - b) < 5 ? "tie" : a > b ? "a" : "b";
  const disagree = legA.winner !== legB.winner;
  const round4 = (x) => Math.round(x * 1e4) / 1e4;
  return {
    winner,
    a,
    b,
    disagree,
    confidence: round4(Math.max(0, Math.min(1, ((legA.confidence + legB.confidence) / 2) * (disagree ? discount : 1)))),
    disagreementDiscount: discount,
  };
}

function makeEnsembleJudge({ legs }) {
  if (!Array.isArray(legs) || legs.length !== 2) {
    throw new Error("ensemble arm needs exactly two provider legs");
  }
  return async (input) => {
    const settled = await Promise.allSettled(legs.map((leg) => leg.judge(input)));
    const reasons = settled
      .map((r, i) => [r, legs[i].label])
      .filter(([r]) => r.status === "rejected")
      .map(([r, label]) => `${label}(${String(r.reason?.message ?? r).slice(0, 90)})`);
    if (reasons.length) {
      const err = new Error(`ensemble leg(s) failed, no ensemble verdict exists: ${reasons.join("; ")}`);
      // Attach per-leg chain traces, keyed by leg label so cross-provider
      // model-name collisions cannot blur the error trail.
      err.chainErrors = Object.fromEntries(
        settled.flatMap((r, i) =>
          r.status === "rejected"
            ? Object.entries(r.reason?.chainErrors ?? {}).map(([k, v]) => [`${legs[i].label}:${k}`, v])
            : [],
        ),
      );
      throw err;
    }
    const [v1, v2] = settled.map((r) => r.value);
    const agg = aggregateEnsembleVerdicts(v1, v2);
    return {
      winner: agg.winner,
      a: agg.a,
      b: agg.b,
      confidence: agg.confidence,
      model: `ensemble(${legs[0].label}+${legs[1].label})`,
      disagree: agg.disagree,
      envelope: { kind: "ensemble-two-model", disagreementDiscount: ENSEMBLE_DISAGREEMENT_DISCOUNT },
      // Leg diaries are evidence: the raw (normalised) leg verdicts stay in
      // the run artifact so aggregation can be re-derived, not trusted.
      legs: [v1, v2].map((v, i) => ({
        label: legs[i].label,
        model: v.model,
        winner: v.winner,
        a: v.a,
        b: v.b,
        confidence: v.confidence,
        tokens: v.tokens,
      })),
      tokens: (v1.tokens ?? 0) + (v2.tokens ?? 0),
      promptTokens: (v1.promptTokens ?? 0) + (v2.promptTokens ?? 0),
      completionTokens: (v1.completionTokens ?? 0) + (v2.completionTokens ?? 0),
      // Legs run in parallel; wall latency is the slower leg, not the sum.
      latencyMs: Math.max(v1.latencyMs ?? 0, v2.latencyMs ?? 0),
    };
  };
}

export function newJudgeStats() {
  return { jobs: 0, attempts: 0, succeeded: 0, errors: 0, backoffMs: 0, byModel: {} };
}

/**
 * All configured providers as benchmark judges. Each runs the full 24-fixture
 * pack + probe battery, so per-model rows compare free transports fairly.
 * NVIDIA appears only via its direct key (its models also ride the OpenRouter
 * chain as ":free" variants when that key exists).
 *
 * `kind: "ensemble-two-model"` builds ONE ensemble judge from exactly two
 * usable providers — the labels named in `select` when given (the study passes
 * `--models` through), otherwise the top two usable in registry priority for
 * unfiltered ad-hoc runs. Any other count (0, 1, or 3+ usable/selected) is not
 * the registered two-leg architecture and returns [] so the caller reports the
 * absence instead of silently running something else.
 */
export function allJudgeProviders(env = process.env, { system = buildVerdictSystem(), kind = "single-prompt", select = [] } = {}) {
  if (kind === "ensemble-two-model") {
    const requested = (Array.isArray(select) ? select : String(select ?? "").split(",")).map((s) => String(s).trim()).filter(Boolean);
    let members = usableProviders(env);
    if (requested.length) members = members.filter((p) => requested.includes(p.label));
    else members = members.slice(0, 2);
    if (members.length !== 2) return [];
    const stats = newJudgeStats(); // shared: both legs attribute jobs/attempts/latency into one run record
    const legs = members.map((provider) => ({
      label: provider.label,
      judge: makeChainJudge({
        url: provider.url,
        key: (env[provider.keyEnv] ?? "").trim(),
        models: chainFor(provider, env),
        extraHeaders: provider.extraHeaders ?? {},
        system,
        stats,
        ...requestCompat(provider),
      }),
    }));
    return [{ id: `ensemble:${legs.map((l) => l.label).join("+")}`, stats, fn: makeEnsembleJudge({ legs }) }];
  }
  const build = kind === "two-pass-grounding" ? makeGroundingJudge : makeChainJudge;
  const judges = [];
  for (const provider of PROVIDERS) {
    const key = (env[provider.keyEnv] ?? "").trim();
    if (!key) continue;
    if (provider.label === "nvidia") {
      const models = chainFor(provider, env);
      const nvidiaStats = newJudgeStats();
      judges.push({ id: `nvidia:${models.join("/")}`, stats: nvidiaStats, fn: build({ url: provider.url, key, models, system, stats: nvidiaStats, ...requestCompat(provider) }) });
      continue;
    }
    if (provider.label === "openrouter" && env.NVIDIA_API_KEY) continue; // already covered as direct nvidia
    const models = chainFor(provider, env);
    const stats = newJudgeStats();
    judges.push({
      id: `${provider.label}:${models[0]}`,
      stats,
      fn: build({ url: provider.url, key, models, extraHeaders: provider.extraHeaders ?? {}, system, stats, ...requestCompat(provider) }),
    });
  }
  return judges;
}

/** Historical direct-nvidia alias kept for older env setups. */
export function primaryChainJudge(env = process.env) {
  return allJudgeProviders(env)[0] ?? null;
}

/**
 * Cost per 1M tokens (USD) for priced models. Used only to PUBLISH an
 * estimated run cost — never a gate. Free-tier models (any ":free"/"-free"
 * suffix) are $0; unknown paid models report null.
 */
export const COST_PER_MTOK = {
  "nvidia/nemotron-3-ultra-550b-a55b": { input: 0.6, output: 1.8 },
  "nvidia/nemotron-3-super-120b-a12b": { input: null, output: null },
};

/** Estimated run cost in USD given prompt/completion token totals; null when unpriced. */
export function estimatedCost(model, promptTokens, completionTokens) {
  const isFree = /:free\b|-free\b|\/free\b/i.test(model);
  if (isFree) return 0;
  const price = Object.entries(COST_PER_MTOK).find(([slug]) => model.endsWith(slug) || model.includes(slug))?.[1];
  if (!price || price.input === null) return null;
  return +(((promptTokens / 1e6) * price.input) + ((completionTokens / 1e6) * price.output)).toFixed(4);
}
