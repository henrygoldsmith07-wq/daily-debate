// Provider adapters for the live judge benchmark and topic generation: a
// registry of interchangeable OpenAI-compatible transports, each with its own
// model chain. Mirrors src/lib/openrouter.ts (the app's transports) so the
// benchmark validates the same providers production uses.
//
// Configured providers (in priority order): NVIDIA_API_KEY → OPENROUTER_API_KEY
// → UNOROUTER_API_KEY → KIRAAI_API_KEY. Model overrides use <LABEL>_MODEL and
// <LABEL>_FALLBACK_MODELS (comma-separated; empty pins one).

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
 *  fixture-specific tuning. Production's graph-extraction legs (openrouter.ts
 *  / anthropic.ts judge_pvp) carry the same clauses at PROMPT_VERSION 4.
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

async function chat({ url, key, model, system, user, maxTokens, extraHeaders = {}, timeoutMs = 35_000, disableReasoning = true }) {
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
    // verdict JSON is small, so reasoning is disabled exactly like the app's
    // transport (openrouter.ts post()). Endpoints that require reasoning
    // reject the flag and are retried without it.
    if (disableReasoning) payload.reasoning = { enabled: false };
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...extraHeaders },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const bodyText = await res.text();
    if (!res.ok) {
      if (disableReasoning && res.status === 400 && /reasoning/i.test(bodyText)) {
        return chat({ url, key, model, system, user, maxTokens, extraHeaders, timeoutMs, disableReasoning: false });
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
 * The provider registry — same transports and priority order the app uses.
 * Default chains verified against each /models endpoint on 2026-09-11.
 */
export const PROVIDERS = [
  {
    label: "nvidia",
    keyEnv: "NVIDIA_API_KEY",
    url: "https://integrate.api.nvidia.com/v1/chat/completions",
    defaultModel: "nvidia/nemotron-3-ultra-550b-a55b",
    fallbacks: ["nvidia/nemotron-3-super-120b-a12b"],
  },
  {
    label: "openrouter",
    keyEnv: "OPENROUTER_API_KEY",
    url: "https://openrouter.ai/api/v1/chat/completions",
    // Super first: live probes (2026-09-13) found the free Lightning/Ultra
    // pools frequently stall; Super answers in ~1s. No non-existent
    // ":free" slugs in the chain — they add only error noise.
    defaultModel: "nvidia/nemotron-3-super-120b-a12b:free",
    fallbacks: [
      "nvidia/nemotron-3.5-lightning:free",
      "nvidia/nemotron-3-ultra-550b-a55b:free",
    ],
    extraHeaders: { "HTTP-Referer": "https://daily-debate.app" },
  },
  {
    label: "unorouter",
    keyEnv: "UNOROUTER_API_KEY",
    url: "https://api.unorouter.com/v1/chat/completions",
    defaultModel: "nemotron-3.5-lightning:free",
    // glm-5.3:free deliberately excluded: its free tier allows 1 request per
    // minute per account, which poisons burst benchmark traffic with 429s.
    fallbacks: ["nemotron-3-super-120b-a12b:free", "nemotron-3-ultra-550b-a55b:free"],
  },
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

/** Model chain for one provider entry: primary + fallbacks (env-overridable). */
export function chainFor(provider, env = process.env) {
  const upper = provider.label.toUpperCase();
  const primary = env[`${upper}_MODEL`] || provider.defaultModel;
  const fallbacks = env[`${upper}_FALLBACK_MODELS`] !== undefined
    ? env[`${upper}_FALLBACK_MODELS`].split(",").map((m) => m.trim()).filter(Boolean)
    : provider.fallbacks;
  return [primary, ...fallbacks.filter((m) => m !== primary)];
}

/** OpenAI-style chain transport for topic generation: { url, key, models } or null. */
export function generationChain(env = process.env) {
  const [provider] = PROVIDERS.filter((p) => (env[p.keyEnv] ?? "").trim().length > 0);
  if (!provider) return null;
  return {
    label: provider.label,
    url: provider.url,
    key: (env[provider.keyEnv] ?? "").trim(),
    models: chainFor(provider, env),
    extraHeaders: provider.extraHeaders ?? {},
  };
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

function makeChainJudge({ url, key, models, extraHeaders = {}, system = buildVerdictSystem(), userFn = verdictUser, maxTokens = 900, stats = null }) {
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
            url, key, model, system, user: userFn(input), maxTokens, extraHeaders,
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

function makeGroundingJudge({ url, key, models, extraHeaders = {}, system = buildVerdictSystem(), stats = null }) {
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
          maxTokens: 1_200, extraHeaders,
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
      url, key, models, extraHeaders, stats,
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

export function newJudgeStats() {
  return { jobs: 0, attempts: 0, succeeded: 0, errors: 0, backoffMs: 0, byModel: {} };
}

/**
 * All configured providers as benchmark judges. Each runs the full 24-fixture
 * pack + probe battery, so per-model rows compare free transports fairly.
 * NVIDIA appears only via its direct key (its models also ride the OpenRouter
 * chain as ":free" variants when that key exists).
 */
export function allJudgeProviders(env = process.env, { system = buildVerdictSystem(), kind = "single-prompt" } = {}) {
  const build = kind === "two-pass-grounding" ? makeGroundingJudge : makeChainJudge;
  const judges = [];
  for (const provider of PROVIDERS) {
    const key = (env[provider.keyEnv] ?? "").trim();
    if (!key) continue;
    if (provider.label === "nvidia") {
      const models = chainFor(provider, env);
      const nvidiaStats = newJudgeStats();
      judges.push({ id: `nvidia:${models.join("/")}`, stats: nvidiaStats, fn: build({ url: provider.url, key, models, system, stats: nvidiaStats }) });
      continue;
    }
    if (provider.label === "openrouter" && env.NVIDIA_API_KEY) continue; // already covered as direct nvidia
    const models = chainFor(provider, env);
    const stats = newJudgeStats();
    judges.push({
      id: `${provider.label}:${models[0]}`,
      stats,
      fn: build({ url: provider.url, key, models, extraHeaders: provider.extraHeaders ?? {}, system, stats }),
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
