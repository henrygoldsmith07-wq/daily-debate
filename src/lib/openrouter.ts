// Model calls over free-tier OpenAI-compatible APIs (UnoRouter, Groq,
// Cerebras, Gemini, NVIDIA, OpenRouter). There is no paid provider.
//
//  1. There is no shared `responseSchema` parameter. `json_object` mode
//     guarantees syntactically valid JSON but not a particular shape, and the
//     free-tier models vary in how well they honour `json_schema` mode. Each
//     call therefore ships its JSON Schema in the system message and
//     shape-validates the result before accepting it.
//
//  2. Free pools are shared and return 429s under load, so a request retries
//     with backoff, honours Retry-After, then fails over to the next model and
//     then the next PROVIDER. The whole budget is bounded to stay inside the
//     serverless function timeout.
//
//  3. Several of these are reasoning models that bill thinking tokens against
//     max_tokens, which can consume the entire budget before any JSON is
//     emitted. Reasoning is disabled or set low for that reason.

import type { DebateSide, DebateSummary, TopicSource, TurnScores } from "./types";
import { finalizePvpAssessment } from "./observableAssessment";
import { e2eMockAiEnabled, mockDebateOpening, mockDebateTurn, mockDebateSummary, mockPvpJudge } from "./aiE2eMock";
import { recordAiCall, classifyAiError } from "./aiTelemetry";
import { isValidDebateTurn, isValidGeneratedTopic, isValidJudgeExtraction, isValidOpening, isValidSummary } from "./aiSchema";
import { ensureSpendWithinCap, reserveSpendCall, SPEND_RESERVATION_FALLBACK_USD } from "./spendCap";
import type { ArgumentRoute } from "./argumentTaxonomy";
import { renderUntrusted, renderUntrustedTranscript, UNTRUSTED_INSTRUCTION } from "./untrustedContent";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

/**
 * Interchangeable OpenAI-style transports, all on FREE tiers. Every call walks
 * the configured providers in priority order, each with its own model chain
 * (`<LABEL>_MODEL` primary, `<LABEL>_FALLBACK_MODELS` comma-separated
 * failover; an empty string pins to the single model), until one returns a
 * schema-valid answer. `<LABEL>_DISABLED=1` removes a keyed provider.
 * NVIDIA/OpenRouter keep their historical env names.
 */
export type ProviderLabel = "unorouter" | "groq" | "cerebras" | "gemini" | "nvidia" | "openrouter";

export interface ProviderSpec {
  label: ProviderLabel;
  keyEnv: string;
  url: string;
  defaultModel: string;
  defaultFallbacks: string[];
  /**
   * Sends OpenRouter's `reasoning: { enabled: false }` extension. Only the
   * OpenRouter-style gateways understand it; other APIs would reject it.
   */
  reasoningToggle: boolean;
  /**
   * Provider-specific request fields. gpt-oss and Gemini Flash are reasoning
   * models that bill thinking against max_tokens, so they are asked for low
   * effort to keep the budget for the JSON answer.
   */
  extraBody?: Record<string, unknown>;
}

/** Free NVIDIA Nemotron on the OpenRouter transport. Override per-environment without a code change.
 * Nemotron 3 Super leads the chain: live probes (2026-09-13) found the free
 * Lightning/Ultra pools frequently stall, Super answers in ~1s.
 */
export const DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";

/** Direct-NVIDIA default: the strongest Nemotron, no shared free-pool saturation. */
export const NVIDIA_DEFAULT_MODEL = "nvidia/nemotron-3-ultra-550b-a55b";

/**
 * Free OpenRouter models that hold up on the heaviest calls (the PvP argument
 * graph). Ordered strongest first: Nemotron 3.5 Super, then the full Ultra.
 */
export const DEFAULT_FALLBACK_MODELS = [
  "nvidia/nemotron-3.5-lightning:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
];

/** NVIDIA-transport fallbacks (no ":free" suffix on the direct API). */
export const NVIDIA_DEFAULT_FALLBACK_MODELS = ["nvidia/nemotron-3-super-120b-a12b"];

/**
 * Provider registry — this array order *is* the priority order every call
 * walks. Ordered measured-good, then unmeasured, then measured-bad:
 *
 * Live judge benchmark (docs/latest-judge-benchmark.json, 2026-10-12):
 *
 *   unorouter nemotron-3.5-lightning:free    278/312 = 0.891   clears providerReliabilityMin (0.75)
 *   openrouter nvidia/nemotron-3-super:free    72/300 = 0.240   cannot clear it (mostly 429s)
 *
 * groq, cerebras, gemini and nvidia have no benchmark row. They sit between
 * the two measured transports: ranking them above unorouter would be ranking
 * on nothing, but OpenRouter's free pool is measured to drop three calls in
 * four, and with cross-provider failover a provider that mostly 429s spends
 * the shared retry budget before the others get a turn.
 *
 * Kirai was removed: its free slugs were retired (hard 404s) and the surviving
 * ones bill a wallet (402), so it is no longer a free provider at all.
 *
 * Default model ids (2026-10): Groq retired llama-3.3-70b-versatile for free
 * tiers on 2026-08-16 and names openai/gpt-oss-120b as the replacement;
 * Cerebras's catalog lists gpt-oss-120b; Google's OpenAI-compatibility docs use
 * gemini-3.8-flash. Free rosters churn quarterly — a retired id returns a 4xx
 * and the call falls through to the next model, and every id is env-overridable.
 *
 * Re-measure before reordering. A one-off probe is not evidence.
 */
export const PROVIDERS: readonly ProviderSpec[] = [
  {
    label: "unorouter",
    keyEnv: "UNOROUTER_API_KEY",
    url: "https://api.unorouter.com/v1/chat/completions",
    defaultModel: "nemotron-3.5-lightning:free",
    // glm-5.3:free excluded from the chain: its free tier allows 1 request
    // per minute per account — it 429s under burst traffic and poisons the
    // failover chain instead of rescuing it.
    defaultFallbacks: ["nemotron-3-super-120b-a12b:free", "nemotron-3-ultra-550b-a55b:free"],
    reasoningToggle: true,
  },
  {
    label: "groq",
    keyEnv: "GROQ_API_KEY",
    url: "https://api.groq.com/openai/v1/chat/completions",
    defaultModel: "openai/gpt-oss-120b",
    defaultFallbacks: ["openai/gpt-oss-20b"],
    reasoningToggle: false,
    extraBody: { reasoning_effort: "low" },
  },
  {
    label: "cerebras",
    keyEnv: "CEREBRAS_API_KEY",
    url: "https://api.cerebras.ai/v1/chat/completions",
    defaultModel: "gpt-oss-120b",
    defaultFallbacks: [],
    reasoningToggle: false,
    extraBody: { reasoning_effort: "low" },
  },
  {
    label: "gemini",
    keyEnv: "GEMINI_API_KEY",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    defaultModel: "gemini-3.8-flash",
    defaultFallbacks: ["gemini-3.5-flash-lite"],
    reasoningToggle: false,
    extraBody: { reasoning_effort: "low" },
  },
  {
    label: "nvidia",
    keyEnv: "NVIDIA_API_KEY",
    url: NVIDIA_API_URL,
    defaultModel: NVIDIA_DEFAULT_MODEL,
    defaultFallbacks: NVIDIA_DEFAULT_FALLBACK_MODELS,
    reasoningToggle: true,
  },
  {
    label: "openrouter",
    keyEnv: "OPENROUTER_API_KEY",
    url: OPENROUTER_API_URL,
    defaultModel: DEFAULT_MODEL,
    defaultFallbacks: DEFAULT_FALLBACK_MODELS,
    reasoningToggle: true,
  },
];

function disabled(label: ProviderLabel, env: Record<string, string | undefined>): boolean {
  return /^(1|true|yes)$/i.test((env[`${label.toUpperCase()}_DISABLED`] ?? "").trim());
}

/** Providers that have an API key and are not disabled, in priority order. */
export function configuredProviders(env: Record<string, string | undefined> = process.env): ProviderSpec[] {
  return PROVIDERS.filter((p) => (env[p.keyEnv] ?? "").trim().length > 0 && !disabled(p.label, env));
}

const MAX_ATTEMPTS = Number(process.env.OPENROUTER_MAX_ATTEMPTS ?? 4);
const RETRY_BUDGET_MS = Number(process.env.OPENROUTER_RETRY_BUDGET_MS ?? 45_000);

/**
 * Preferred model first, then fallbacks, for one provider. Set
 * `<LABEL>_FALLBACK_MODELS` to a comma-separated list to override, or to an
 * empty string to disable failover and pin that provider to a single model.
 */
export function modelChainFor(provider: ProviderSpec, env: Record<string, string | undefined> = process.env): string[] {
  const upper = provider.label.toUpperCase();
  const configured = env[`${upper}_FALLBACK_MODELS`];
  const fallbacks =
    configured === undefined
      ? provider.defaultFallbacks
      : configured.split(",").map((m) => m.trim()).filter(Boolean);
  const primary = env[`${upper}_MODEL`] || provider.defaultModel;
  return [primary, ...fallbacks.filter((m) => m !== primary)];
}

/** One step of the cross-provider failover chain. */
export interface ChainStep {
  provider: ProviderSpec;
  key: string;
  model: string;
}

/** Every (provider, model) pair a call may try, in order. */
export function failoverChain(env: Record<string, string | undefined> = process.env): ChainStep[] {
  return configuredProviders(env).flatMap((provider) =>
    modelChainFor(provider, env).map((model) => ({ provider, key: (env[provider.keyEnv] ?? "").trim(), model })),
  );
}

/** Which transport and model actually produced a result (for fingerprints). */
export interface ServedBy {
  provider: ProviderLabel;
  model: string;
}

/**
 * A saturated pool rarely clears within seconds, so burning the whole attempt
 * budget on it starves the known-good fallbacks. Only the last step in the
 * chain — which has nothing to fall through to — gets the full allowance.
 */
function attemptsFor(index: number, chainLength: number): number {
  return index === chainLength - 1 ? MAX_ATTEMPTS : Math.min(2, MAX_ATTEMPTS);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retry-After is advisory and arrives in two different places depending on
 * whether the limit came from OpenRouter itself or the upstream provider.
 */
function retryDelayMs(response: Response, body: unknown, attempt: number): number {
  const advisedSeconds = (body as { error?: { metadata?: { retry_after_seconds?: number } } })?.error
    ?.metadata?.retry_after_seconds;
  const headerSeconds = Number(response.headers.get("retry-after"));
  const advised = advisedSeconds ?? (Number.isFinite(headerSeconds) ? headerSeconds : undefined);
  const backoff = Math.min(8_000, 500 * 2 ** attempt);
  return Math.max(advised ? advised * 1_000 : 0, backoff);
}

/** Free models often wrap their JSON in prose or a markdown fence. */
export function extractJson(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : trimmed).trim();
  if (candidate.startsWith("{") || candidate.startsWith("[")) return candidate;

  const start = candidate.search(/[{[]/);
  if (start === -1) return candidate;
  const closeChar = candidate[start] === "{" ? "}" : "]";
  const end = candidate.lastIndexOf(closeChar);
  return end > start ? candidate.slice(start, end + 1) : candidate;
}

function parseJson<T>(text: string | undefined): T {
  if (!text) throw new Error("Provider did not return any content");
  const json = extractJson(text);
  try {
    return JSON.parse(json) as T;
  } catch (error) {
    // The parse failure reason is safe to surface, but the model's raw output
    // is not: the provider is fed debate transcripts, so the output can echo
    // user-authored text. `ai_call_log.error` is persisted, and the privacy
    // policy states that no prompt or response content is ever stored. Only
    // the length is disclosed, which is enough to diagnose a truncated or
    // fenced response without durably storing a single character of it.
    throw new Error(
      `Provider returned invalid JSON: ${(error as Error).message} (output length ${json.length})`,
    );
  }
}

interface ChatOptions {
  instruction: string;
  schema: Record<string, unknown>;
  /** The graph judge needs far more room than a single debate turn. */
  maxTokens?: number;
  /** Logical operation name for the AI telemetry ledger (e.g. "judge_pvp"). */
  operation?: string;
  /**
   * Output-shape gate. When present, a parsed value that fails it is treated as
   * a failure and never returned as a successful result — so malformed model
   * output cannot become a favourable verdict or an apparently valid score —
   * and the call moves on to the next model/provider.
   */
  validate?: (value: unknown) => boolean;
}

/** ChatOptions with the optional fields resolved to their defaults. */
type ResolvedChatOptions = Required<Omit<ChatOptions, "validate">> &
  Pick<ChatOptions, "validate">;

type Attempt<T> = { ok: true; value: T } | { ok: false; error: string; status?: number };

/** Request features a provider may reject with a 400; each is dropped and retried once. */
interface Compat {
  reasoning: boolean;
  jsonMode: boolean;
}

/**
 * Several of these models are reasoning models that bill thinking tokens
 * against max_tokens — GLM 5.2 spent 324 of 349 completion tokens on reasoning
 * and returned 25 tokens of JSON. Asking for no/low reasoning is what keeps the
 * token budget available for the answer. Endpoints that reject the reasoning
 * fields or json_object mode with a 400 are retried without them.
 */
async function post(step: ChainStep, { instruction, schema, maxTokens }: ResolvedChatOptions, compat: Compat): Promise<Response> {
  const { provider, key, model: m } = step;
  const payload: Record<string, unknown> = {
    model: m,
    messages: [
      {
        role: "system",
        content:
          "You return a single JSON object and nothing else — no prose, no markdown fences. " +
          `It must conform to this JSON Schema:\n${JSON.stringify(schema)}`,
      },
      { role: "user", content: instruction },
    ],
    max_tokens: maxTokens,
  };
  if (compat.jsonMode) payload.response_format = { type: "json_object" };
  if (compat.reasoning) {
    if (provider.reasoningToggle) payload.reasoning = { enabled: false };
    Object.assign(payload, provider.extraBody);
  }

  return fetch(provider.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      // Attribution only; OpenRouter uses these for its model rankings.
      ...(provider.label === "openrouter"
        ? {
            "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "https://daily-debate-brown.vercel.app",
            "X-Title": "Daily Debate",
          }
        : {}),
    },
    body: JSON.stringify(payload),
  });
}

async function tryModel<T>(
  step: ChainStep,
  options: ResolvedChatOptions,
  deadline: number,
  maxAttempts: number,
): Promise<Attempt<T>> {
  const m = step.model;
  const compat: Compat = { reasoning: true, jsonMode: true };
  let lastError = "";
  let lastStatus: number | undefined;

  interface OpenRouterUsage {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const startedAt = Date.now();
    const response = await post(step, options, compat);
    const body: unknown = await response.json().catch(() => null);
    const usage = (body as { usage?: OpenRouterUsage })?.usage;
    const record = (outcome: "ok" | "error", error?: string) =>
      recordAiCall({
        at: new Date().toISOString(),
        operation: options.operation,
        provider: step.provider.label,
        model: m,
        promptTokens: usage?.prompt_tokens,
        completionTokens: usage?.completion_tokens,
        totalTokens: usage?.total_tokens,
        // Every registered transport is a free tier: a provider that reports a
        // cost (OpenRouter, e.g. if a paid model is configured) is metered
        // verbatim, and silence means $0 rather than the declared uncosted
        // charge, which would otherwise trip the daily cap on free traffic.
        costUsd: usage?.cost ?? 0,
        latencyMs: Date.now() - startedAt,
        outcome,
        ...(error
          ? (() => {
              const classified = classifyAiError(error, response.status);
              return {
                errorCategory: classified.category,
                errorCode: classified.code,
                httpStatus: classified.httpStatus,
                retryable: classified.retryable,
                error: classified.sanitized,
              };
            })()
          : {}),
      });

    if (response.ok) {
      const choice = (
        body as { choices?: { message?: { content?: string }; finish_reason?: string }[] }
      )?.choices?.[0];
      const content = choice?.message?.content;

      if (!content) {
        // A reasoning model that burns the whole budget thinking returns a null
        // content with finish_reason "length" — say so rather than reporting
        // unparseable JSON.
        const why =
          choice?.finish_reason === "length"
            ? `hit the ${options.maxTokens}-token limit before emitting any content`
            : `returned no content (finish_reason: ${choice?.finish_reason ?? "unknown"})`;
        record("error", why);
        return { ok: false, error: `${m} ${why}` };
      }

      try {
        const value = parseJson<T>(content);
        // Shape gate: an output that fails the expected schema is a failure,
        // never a successful result. This is what keeps a malformed or
        // truncated judge graph from becoming a valid-looking score or verdict.
        if (options.validate && !options.validate(value)) {
          const invalid = `${m} returned an output that failed schema validation`;
          record("error", invalid);
          return { ok: false, error: invalid };
        }
        record("ok");
        return { ok: true, value };
      } catch (error) {
        const truncated = choice?.finish_reason === "length" ? " — output was truncated at max_tokens" : "";
        const message = `${(error as Error).message}${truncated}`;
        record("error", message);
        return { ok: false, error: message };
      }
    }

    lastStatus = response.status;
    lastError =
      (body as { error?: { metadata?: { raw?: string } } })?.error?.metadata?.raw ??
      (body as { error?: { message?: string } })?.error?.message ??
      `HTTP ${response.status}`;
    record("error", lastError);

    // A feature the endpoint does not support is dropped and retried once,
    // without consuming an attempt.
    if (response.status === 400 && compat.reasoning && /reasoning/i.test(lastError)) {
      compat.reasoning = false;
      attempt -= 1;
      continue;
    }
    if (response.status === 400 && compat.jsonMode && /response_format|json_object|json mode/i.test(lastError)) {
      compat.jsonMode = false;
      attempt -= 1;
      continue;
    }

    // Anything else in the 4xx range will not improve on retry — fall through
    // to the next model instead of spending the budget here.
    if (response.status !== 429 && response.status < 500) {
      return { ok: false, error: `${m}: ${lastError}`, status: response.status };
    }

    const delay = retryDelayMs(response, body, attempt);
    if (Date.now() + delay > deadline) break;
    await sleep(delay);
  }

  return { ok: false, error: `${m}: ${lastError}`, status: lastStatus };
}

/**
 * Statuses that mean the whole provider is unusable, not just this model: a
 * rejected key. 402/403 stay per-model — OpenRouter answers 403 for a single
 * model that is "only available on agentic harnesses" and 402 for a paid model,
 * while its free models on the same key still work.
 */
const PROVIDER_FATAL_STATUSES = new Set([401]);

async function chatJsonServed<T>({ instruction, schema, maxTokens = 2_000, operation = "unknown", validate }: ChatOptions): Promise<{ value: T; servedBy: ServedBy }> {
  // Durable daily spend cap: explicit SpendCapReachedError when today's
  // metered spend is exhausted (callers degrade visibly, never silently).
  await ensureSpendWithinCap();
  // Reserve this request's declared charge for the duration of the retry loop.
  // The loop can make several attempts, so a flat reservation per chatJson
  // call under-charges; the retry budget is bounded (RETRY_BUDGET_MS), and the
  // durable meter still catches the total. It closes the burst hole without
  // needing a per-attempt price table the providers do not report.
  const releaseReservation = reserveSpendCall(SPEND_RESERVATION_FALLBACK_USD);
  try {
    const chain = failoverChain();
    if (!chain.length) {
      throw new Error(
        "No AI provider configured — set at least one free-tier key: UNOROUTER_API_KEY, GROQ_API_KEY, CEREBRAS_API_KEY, GEMINI_API_KEY, NVIDIA_API_KEY or OPENROUTER_API_KEY.",
      );
    }
    const deadline = Date.now() + RETRY_BUDGET_MS;
    const options: ResolvedChatOptions = { instruction, schema, maxTokens, operation, validate };
    const failures: string[] = [];
    const deadProviders = new Set<ProviderLabel>();

    for (const [index, step] of chain.entries()) {
      if (deadProviders.has(step.provider.label)) continue;
      const result = await tryModel<T>(step, options, deadline, attemptsFor(index, chain.length));
      if (result.ok) return { value: result.value, servedBy: { provider: step.provider.label, model: step.model } };
      failures.push(`${step.provider.label}/${result.error}`);
      if (result.status !== undefined && PROVIDER_FATAL_STATUSES.has(result.status)) deadProviders.add(step.provider.label);
      if (Date.now() >= deadline) break;
    }

    throw new Error(`All AI providers failed. Tried ${failures.length}: ${failures.join(" | ")}`);
  } finally {
    releaseReservation();
  }
}

async function chatJson<T>(options: ChatOptions): Promise<T> {
  return (await chatJsonServed<T>(options)).value;
}

// --- Daily topic -----------------------------------------------------------

export interface GeneratedTopic {
  title: string;
  prompt: string;
  category: string;
  sources: TopicSource[];
}

const TOPIC_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short, punchy title for the topic (under 10 words)." },
    prompt: {
      type: "string",
      description:
        "A one or two sentence debate proposition/question, phrased neutrally so it can be argued from either side.",
    },
    category: {
      type: "string",
      description: "One word/short phrase category, e.g. Technology, Ethics, Politics, Science, Economics.",
    },
    sources: {
      type: "array",
      description:
        "3-5 well-known, credible, real institutions or outlets (never invent deep-link URLs) whose reporting or research bears on this topic, each with the angle/data they're known for.",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Name of the real institution/outlet, e.g. Pew Research Center." },
          homepage: { type: "string", description: "Its real root homepage URL, e.g. https://www.pewresearch.org" },
          angle: { type: "string", description: "One sentence on what perspective or data this source is known for on the topic." },
        },
        required: ["name", "homepage", "angle"],
      },
    },
  },
  required: ["title", "prompt", "category", "sources"],
};

export async function generateDailyTopic(recentTitles: string[]): Promise<GeneratedTopic> {
  const avoid = recentTitles.length
    ? `Avoid repeating or closely resembling these recent topics: ${recentTitles.join("; ")}.`
    : "";

  return chatJson<GeneratedTopic>({
    schema: TOPIC_SCHEMA,
    operation: "generate_daily_topic",
    validate: isValidGeneratedTopic,
    instruction: `Pick today's debate topic for a daily critical-thinking app used by the general public. It should be genuinely debatable (reasonable people disagree), civically or intellectually meaningful, and not needlessly inflammatory or a pure culture-war flashpoint. Draw from technology, science, ethics, economics, education, or public policy. ${avoid} Ground it with 3-5 real, well-known, credible institutions (never fabricate a specific article URL — only real root homepages) relevant to the topic.`,
  });
}

// --- Solo debate -----------------------------------------------------------

export interface DebateTurnResult {
  aiMessage: string;
  /** Back-compat only. The route computes scores from observable features. */
  scores?: TurnScores;
  feedback: string;
}

const TURN_SCHEMA = {
  type: "object",
  properties: {
    feedback: {
      type: "string",
      description: "One or two sentences of specific, constructive feedback on this response.",
    },
    aiMessage: {
      type: "string",
      description:
        "The AI opponent's next move: a sharp counter-argument, a probing follow-up question, or a challenge to a weak point — 2-4 sentences, arguing the opposite side from the user.",
    },
  },
  required: ["feedback", "aiMessage"],
};

export async function debateTurn(params: {
  topicTitle: string;
  topicPrompt: string;
  userSide: DebateSide;
  history: { role: "ai" | "user"; text: string }[];
  latestUserMessage: string;
  argumentRoute?: ArgumentRoute;
  /** Opponent persona/difficulty/format directives (opponentPersona.ts). */
  directive?: string;
}): Promise<DebateTurnResult> {
  const aiSide: DebateSide = params.userSide === "for" ? "against" : "for";

  const transcript = renderUntrustedTranscript(params.history);

  if (e2eMockAiEnabled()) return mockDebateTurn();

  const routeGuidance = params.argumentRoute === "response-generation"
    ? "The submitted move is structurally a question: answer the question directly first, then add one concise challenge grounded in the debate motion."
    : params.argumentRoute === "lightweight"
      ? "The submitted move is structurally off-topic or non-substantive: acknowledge briefly, redirect to the motion, and ask for one relevant claim."
      : "";

  const opponentStyle = params.directive ? `\n\n${params.directive}` : "";
  const latest = renderUntrusted("User's latest response", params.latestUserMessage);

  return chatJson<DebateTurnResult>({
    schema: TURN_SCHEMA,
    operation: "debate_turn",
    validate: isValidDebateTurn,
    instruction: `You are an AI debate opponent in a critical-thinking training app. Topic: "${params.topicTitle}" — ${params.topicPrompt}\nThe user is arguing the "${params.userSide}" side. You are arguing the "${aiSide}" side, and your job is to challenge the user's thinking as rigorously and fairly as possible so they sharpen their reasoning.\n\n${routeGuidance}${opponentStyle}\n\n${UNTRUSTED_INSTRUCTION}\n\nTranscript so far:\n${transcript}\n\n${latest}\n\nGive brief, specific feedback and produce your next challenge. Do not assign numeric scores; the application computes those from observable argument evidence after this response.`,
  });
}

const OPENING_SCHEMA = {
  type: "object",
  properties: {
    aiMessage: { type: "string", description: "Opening argument, 2-4 sentences." },
  },
  required: ["aiMessage"],
};

export async function debateOpening(params: {
  topicTitle: string;
  topicPrompt: string;
  aiSide: DebateSide;
  /** Opponent persona/difficulty/format directives (opponentPersona.ts). */
  directive?: string;
}): Promise<string> {
  if (e2eMockAiEnabled()) return mockDebateOpening();
  const opponentStyle = params.directive ? `\n\n${params.directive}` : "";
  const result = await chatJson<{ aiMessage: string }>({
    schema: OPENING_SCHEMA,
    operation: "debate_opening",
    validate: (value) => isValidOpening((value as { aiMessage?: unknown } | null)?.aiMessage),
    instruction: `Open a debate on "${params.topicTitle}" — ${params.topicPrompt}\nArgue the "${params.aiSide}" side in 2-4 sentences, stating a clear, specific opening claim (not a vague restatement of the prompt).${opponentStyle}`,
  });
  return result.aiMessage;
}

const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    overallFeedback: { type: "string", description: "2-3 sentence overall assessment of the user's reasoning across the session." },
    strengths: { type: "array", items: { type: "string" }, description: "1-3 short specific strengths." },
    improvements: { type: "array", items: { type: "string" }, description: "1-3 short specific things to improve." },
  },
  required: ["overallFeedback", "strengths", "improvements"],
};

export async function summarizeSoloDebate(params: {
  topicTitle: string;
  transcript: string;
}): Promise<DebateSummary> {
  if (e2eMockAiEnabled()) return mockDebateSummary();
  return chatJson<DebateSummary>({
    schema: SUMMARY_SCHEMA,
    operation: "summarize_solo",
    validate: isValidSummary,
    instruction: `Here is a full debate practice transcript on "${params.topicTitle}":\n\n${UNTRUSTED_INSTRUCTION}\n\n${params.transcript}\n\nGive the user a short overall assessment of their critical-thinking performance, with specific strengths and areas to improve.`,
  });
}

// --- PvP judging -----------------------------------------------------------

export interface PvpJudgeResult {
  winner: "a" | "b" | "tie";
  playerAScore: number;
  playerBScore: number;
  rationale: string;
  decidingFactor?: string;
  breakdown?: { a: { claims: number; evidence: number; rebuttals: number; impacts: number; fallacies: number; droppedSuffered: number }; b: { claims: number; evidence: number; rebuttals: number; impacts: number; fallacies: number; droppedSuffered: number } };
  argGraph?: import("./argGraph").ArgGraph;
  scoreStatus?: import("./observableAssessment").AssessmentStatus;
  observableAssessment?: import("./observableAssessment").ObservableAssessment;
  /** The transport and model that produced this verdict (absent for the e2e mock). */
  servedBy?: ServedBy;
}

const FALLACY_ENUM = ["strawman", "ad_hominem", "false_dilemma", "slippery_slope", "appeal_to_emotion", "hasty_generalization", "appeal_to_authority", "whataboutism", "begging_the_question", "equivocation", "none"];
const OWNER_ENUM = ["a", "b", "ai"];

const EVIDENCE_CITATION_SCHEMA = {
  type: "object",
  properties: {
    sourceName: { type: "string", description: "Real institution/outlet name backing this evidence, e.g. 'Pew Research Center'. Must be real; never invent." },
    homepage: { type: "string", description: "Root homepage URL only, e.g. https://www.pewresearch.org. Never invent article URLs." },
    excerpt: { type: "string", description: "<=200 chars: what this source is known for or the data point it supports." },
  },
  required: ["sourceName"],
};

const ARG_NODE_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", description: "Stable id like c1, e1, k1, r1, i1." },
    kind: { type: "string", enum: ["claim", "evidence", "counterclaim", "rebuttal", "impact"] },
    owner: { type: "string", enum: OWNER_ENUM },
    text: { type: "string", description: "One-sentence summary (<=18 words)." },
    round: { type: "integer", description: "Round where introduced." },
    evidenceStrength: { type: "string", enum: ["anecdotal", "general", "cited", "strong"] },
    citations: { type: "array", description: "Source grounding for this node. cited/strong evidence MUST include >=1 citation; anecdotal/general may omit.", items: EVIDENCE_CITATION_SCHEMA },
    targets: { type: "array", items: { type: "string" }, description: "For rebuttals: ids rebutted." },
    fallacy: { type: "string", enum: FALLACY_ENUM },
  },
  required: ["id", "kind", "owner", "text", "round"],
};

const SIDE_BREAKDOWN_SCHEMA = {
  type: "object",
  properties: {
    claims: { type: "integer" },
    evidence: { type: "integer" },
    rebuttals: { type: "integer" },
    impacts: { type: "integer" },
    fallacies: { type: "integer" },
    droppedSuffered: { type: "integer" },
  },
  required: ["claims", "evidence", "rebuttals", "impacts", "fallacies", "droppedSuffered"],
};

const ARG_GRAPH_SCHEMA = {
  type: "object",
  description: "Full argument graph. Keep every text field concise (<=18 words). cited/strong evidence must carry citations.",
  properties: {
    nodes: { type: "array", items: ARG_NODE_SCHEMA },
    edges: { type: "array", items: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, relation: { type: "string", enum: ["supports", "counters", "rebuts", "impacts"] } }, required: ["from", "to", "relation"] } },
    dropped: { type: "array", items: { type: "object", properties: { nodeId: { type: "string" }, text: { type: "string" }, owner: { type: "string", enum: OWNER_ENUM }, round: { type: "integer" } }, required: ["nodeId", "text", "owner", "round"] } },
    contradictions: { type: "array", items: { type: "object", properties: { a: { type: "string" }, b: { type: "string" }, explanation: { type: "string" }, owner: { type: "string", enum: OWNER_ENUM } }, required: ["a", "b", "explanation", "owner"] } },
    concessions: { type: "array", items: { type: "object", properties: { nodeId: { type: "string" }, by: { type: "string", enum: OWNER_ENUM }, note: { type: "string" } }, required: ["nodeId", "by", "note"] } },
    fallacies: { type: "array", items: { type: "object", properties: { nodeId: { type: "string" }, fallacy: { type: "string", enum: FALLACY_ENUM }, note: { type: "string" } }, required: ["nodeId", "fallacy", "note"] } },
    evidenceStats: { type: "object", properties: { total: { type: "integer" }, byOwner: { type: "object", properties: { a: { type: "integer" }, b: { type: "integer" }, ai: { type: "integer" } }, required: ["a", "b", "ai"] }, byStrength: { type: "object", properties: { anecdotal: { type: "integer" }, general: { type: "integer" }, cited: { type: "integer" }, strong: { type: "integer" } }, required: ["anecdotal", "general", "cited", "strong"] }, unsupportedClaimIds: { type: "array", items: { type: "string" } } }, required: ["total", "byOwner", "byStrength", "unsupportedClaimIds"] },
    impactComparison: { type: "object", properties: { a: { type: "integer" }, b: { type: "integer" }, rationale: { type: "string" } }, required: ["a", "b", "rationale"] },
  },
  required: ["nodes", "edges", "dropped", "contradictions", "concessions", "fallacies", "evidenceStats", "impactComparison"],
};

const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    rationale: { type: "string", description: "2-4 sentences, citing specific transcript moments." },
    decidingFactor: { type: "string", description: "One sentence naming the single biggest reason the winner won." },
    breakdown: { type: "object", properties: { a: SIDE_BREAKDOWN_SCHEMA, b: SIDE_BREAKDOWN_SCHEMA }, required: ["a", "b"] },
    argGraph: ARG_GRAPH_SCHEMA,
  },
  required: ["rationale", "argGraph"],
};

export async function judgePvpMatch(params: {
  topicTitle: string;
  topicPrompt: string;
  playerASide: DebateSide;
  transcript: string;
}): Promise<PvpJudgeResult> {
  if (e2eMockAiEnabled()) return finalizePvpAssessment(mockPvpJudge(), { extractionSource: "llm" });

  const { value: extracted, servedBy } = await chatJsonServed<{ rationale?: string; argGraph?: import("./argGraph").ArgGraph }>({
    schema: JUDGE_SCHEMA,
    maxTokens: 6_000,
    operation: "judge_pvp",
    validate: isValidJudgeExtraction,
    instruction: `You are a neutral, rigorous debate analyst. Topic: "${params.topicTitle}" — ${params.topicPrompt}\nPlayer A argued "${params.playerASide}"; Player B argued the opposite side.\n\n${UNTRUSTED_INSTRUCTION}\n\nTranscript:\n${params.transcript}\n\nAnalyze the observable argument structure, not which side of the topic is "correct". Judge only what is argued and shown: identical content earns identical treatment regardless of which label (A or B) speaks it, and length, repetition, formatting, fluency or confident tone are not argument quality. Named sources, institutions and statistics count only where the argument makes the evidence usable (mechanism, figure, context); authoritative-sounding references without usable content are noise, never strength. Return a faithful argGraph with nodes (c1,e1,k1,r1,i1, text <=18 words), edges, dropped arguments, contradictions, concessions, fallacies, evidenceStats, and impactComparison. Every cited/strong evidence node MUST include a citation object with a named source; never invent arguments or citations not present in the transcript. Also return a short rationale citing specific graph moments. Numeric scores and winner are computed by the application from the graph and must not be estimated here.`,
  });

  return { ...finalizePvpAssessment(extracted, { extractionSource: "llm" }), servedBy };
}
