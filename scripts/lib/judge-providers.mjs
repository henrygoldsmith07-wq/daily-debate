// Provider adapters for the live judge benchmark and topic generation: a
// registry of interchangeable OpenAI-compatible transports, each with its own
// model chain. Mirrors src/lib/openrouter.ts (the app's transports) so the
// benchmark validates the same providers production uses.
//
// Configured providers (in priority order): NVIDIA_API_KEY → OPENROUTER_API_KEY
// → UNOROUTER_API_KEY → KIRAAI_API_KEY → BAI_API_KEY. Model overrides use
// <LABEL>_MODEL and <LABEL>_FALLBACK_MODELS (comma-separated; empty pins one).

function extractJson(text) {
  const trimmed = String(text ?? "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in output");
  return JSON.parse(candidate.slice(start, end + 1));
}

const VERDICT_SYSTEM =
  "You are a neutral debate judge. Analyse argument structure only. Respond with ONE JSON object, no prose.";

export function verdictUser(transcript) {
  return `Debate transcript (Player A vs Player B):\n\n${transcript}\n\nScore both sides 0-100 on observable argument quality (grounded claims, rebuttals, impact weighing). Decide the winner strictly on that structure.\nReturn JSON exactly: {"winner":"a|b|tie","playerAScore":<int>,"playerBScore":<int>,"confidence":<0..1>}`;
}

function normaliseVerdict(parsed) {
  const winner = ["a", "b", "tie"].includes(parsed.winner) ? parsed.winner : "tie";
  const clamp = (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
  return {
    winner,
    a: clamp(parsed.playerAScore),
    b: clamp(parsed.playerBScore),
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
      throw new Error(`${res.status}: ${bodyText.slice(0, 160)}`);
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
    defaultModel: "nvidia/nemotron-3.5-lightning:free",
    fallbacks: [
      "nvidia/nemotron-3-super-120b-a12b:free",
      "nvidia/nemotron-3-ultra-550b-a55b:free",
      "deepseek/deepseek-v4-flash:free",
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
    defaultModel: "qwen3.8-flash-free",
    fallbacks: ["glm-5.3-free", "hy3-free", "mimo-v2.5-free"],
  },
  {
    label: "bai",
    keyEnv: "BAI_API_KEY",
    url: "https://api.b.ai/v1/chat/completions",
    defaultModel: "qwen3.8-flash",
    fallbacks: ["glm-5.3-flash", "deepseek-v4.1-flash"],
  },
];

export function providerStatus(env = process.env) {
  return PROVIDERS.filter((p) => (env[p.keyEnv] ?? "").trim().length > 0).map((p) => p.label);
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
    url: provider.url,
    key: (env[provider.keyEnv] ?? "").trim(),
    models: chainFor(provider, env),
    extraHeaders: provider.extraHeaders ?? {},
  };
}

/** Chain judge: tries each model in order; the judge id names the primary. */
function makeChainJudge({ url, key, models, extraHeaders = {} }) {
  return async (transcript) => {
    let lastError;
    for (const model of models) {
      try {
        const { content, tokens, promptTokens, completionTokens, latencyMs } = await chat({
          url, key, model, system: VERDICT_SYSTEM, user: verdictUser(transcript), maxTokens: 900, extraHeaders,
        });
        return { ...normaliseVerdict(extractJson(content)), model, tokens, promptTokens, completionTokens, latencyMs };
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError ?? new Error("no models configured");
  };
}

/**
 * All configured providers as benchmark judges. Each runs the full 24-fixture
 * pack + probe battery, so per-model rows compare free transports fairly.
 * NVIDIA appears only via its direct key (its models also ride the OpenRouter
 * chain as ":free" variants when that key exists).
 */
export function allJudgeProviders(env = process.env) {
  const judges = [];
  for (const provider of PROVIDERS) {
    const key = (env[provider.keyEnv] ?? "").trim();
    if (!key) continue;
    if (provider.label === "nvidia") {
      const models = chainFor(provider, env);
      judges.push({ id: `nvidia:${models.join("/")}`, fn: makeChainJudge({ url: provider.url, key, models }) });
      continue;
    }
    if (provider.label === "openrouter" && env.NVIDIA_API_KEY) continue; // already covered as direct nvidia
    const models = chainFor(provider, env);
    judges.push({
      id: `${provider.label}:${models[0]}`,
      fn: makeChainJudge({ url: provider.url, key, models, extraHeaders: provider.extraHeaders ?? {} }),
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
