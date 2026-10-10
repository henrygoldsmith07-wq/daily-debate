// OpenRouter-backed model calls. Replaces the previous Gemini integration.
//
// Three things differ from the Google SDK this grew out of:
//
//  1. There is no `responseSchema` parameter. OpenRouter's `json_object` mode
//     guarantees syntactically valid JSON but not a particular shape, and the
//     free-tier models vary in how well they honour `json_schema` mode. Each
//     call therefore ships its JSON Schema in the system message, and callers
//     shape-validate the result (see aiFallback.withProviderFallback).
//
//  2. Free pools are shared and return upstream 429s under load, so a request
//     retries with backoff, honours Retry-After, and then fails over to the
//     next model in the chain. The whole budget is bounded to stay inside the
//     serverless function timeout.
//
//  3. Several of these are reasoning models that bill thinking tokens against
//     max_tokens, which can consume the entire budget before any JSON is
//     emitted. Reasoning is disabled by default for that reason.

import type { DebateSide, DebateSummary, TopicSource, TurnScores } from "./types";
import { finalizePvpAssessment } from "./observableAssessment";
import { e2eMockAiEnabled, mockDebateOpening, mockDebateTurn, mockDebateSummary, mockPvpJudge } from "./aiE2eMock";
import { recordAiCall, classifyAiError } from "./aiTelemetry";
import { isValidJudgeExtraction } from "./aiSchema";
import { ensureSpendWithinCap, reserveSpendCall, SPEND_RESERVATION_FALLBACK_USD } from "./spendCap";
import type { ArgumentRoute } from "./argumentTaxonomy";
import { renderUntrusted, renderUntrustedTranscript, UNTRUSTED_INSTRUCTION } from "./untrustedContent";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

/**
 * Interchangeable OpenAI-style judge transports, tried in priority order —
 * the first one whose API key is present serves every call. Each transport
 * has its own model chain (`<LABEL>_MODEL` primary, `<LABEL>_FALLBACK_MODELS`
 * comma-separated failover; an empty string pins to the single model).
 * NVIDIA/OpenRouter keep their historical env names.
 */
export type ProviderLabel = "nvidia" | "openrouter" | "unorouter" | "kiraai";

interface ProviderSpec {
  label: ProviderLabel;
  keyEnv: string;
  url: string;
  defaultModel: string;
  defaultFallbacks: string[];
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
 * A DeepSeek free tier is retained as a trailing fallback.
 */
export const DEFAULT_FALLBACK_MODELS = [
  "nvidia/nemotron-3.5-lightning:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
];

/** NVIDIA-transport fallbacks (no ":free" suffix on the direct API). */
export const NVIDIA_DEFAULT_FALLBACK_MODELS = ["nvidia/nemotron-3-super-120b-a12b"];

/**
 * Provider registry, ordered by MEASURED reliability — this array order *is*
 * the priority order, and `activeProvider` takes the first configured entry.
 *
 * Live judge benchmark, 2026-10-04 (docs/latest-judge-benchmark.json),
 * 312 attempted calls per transport:
 *
 *   unorouter nemotron-3.5-lightning:free    252/312 = 0.808   clears providerReliabilityMin (0.75)
 *   openrouter nvidia/nemotron-3-super:free    92/312 = 0.295   cannot clear it
 *   kiraai    qwen3.8-flash-free                0/24  = 0.000   no usable calls at all
 *
 * This order previously led with OpenRouter Super, justified by a 2026-09-13
 * probe ("live probes found the free Lightning/Ultra pools frequently stall,
 * Super answers in ~1s"). Measurement has since contradicted that: Super drops
 * roughly two calls in three. Leading with it means most PvP judgements have no
 * judgement to return, and the failure is invisible per-call because the
 * failover chain rescues some of them.
 *
 * Agreement is not the tie-breaker it first appears to be. Super scores higher
 * (0.667 vs 0.625) but on a third of the traffic, and neither model clears the
 * 0.75 agreement floor, so neither may back a competitive claim. Between two
 * judges that are both unusable as judges, the one that answers is strictly
 * better — especially for a verdict the learner is waiting on.
 *
 * nvidia sorts last deliberately: it has no benchmark row at all, so ranking
 * it above a measured transport would be ranking on nothing. It still leads
 * when it is the only key configured.
 *
 * Re-measure before reordering. A one-off probe is not evidence, and this
 * comment exists so the next person can check the artifact instead of trusting
 * the last person's optimism.
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
  },
  {
    label: "openrouter",
    keyEnv: "OPENROUTER_API_KEY",
    url: OPENROUTER_API_URL,
    defaultModel: DEFAULT_MODEL,
    defaultFallbacks: DEFAULT_FALLBACK_MODELS,
  },
  {
    label: "kiraai",
    keyEnv: "KIRAAI_API_KEY",
    url: "https://kiraai.vn/api/v1/chat/completions",
    defaultModel: "qwen3.8-flash-free",
    defaultFallbacks: ["glm-5.3-free", "hy3-free", "mimo-v2.5-free"],
  },
  {
    label: "nvidia",
    keyEnv: "NVIDIA_API_KEY",
    url: NVIDIA_API_URL,
    defaultModel: NVIDIA_DEFAULT_MODEL,
    defaultFallbacks: NVIDIA_DEFAULT_FALLBACK_MODELS,
  },
];

/**
 * Whether the FREE provider chain (UnoRouter, free OpenRouter pools, Kirai,
 * NVIDIA free tier) may serve calls at all.
 *
 * Phase 3 judge reliability: the default judge is ONE pinned paid model via
 * a single provider (Anthropic claude-sonnet-5; `ANTHROPIC_MODEL` override).
 * The free chain is opt-in for dev/e2e only:
 *
 *  * unset            -> free chain off everywhere (production default)
 *  * "1"              -> free chain on outside production (local dev, CI)
 *  * "emergency"      -> free chain on even in production. Incident-response
 *                        escape hatch only (e.g. the pinned provider is down,
 *                        or the pre-registered study rejects the switch);
 *                        never a default, always a deliberate operator action.
 */
export function freeProvidersAllowed(env: Record<string, string | undefined> = process.env): boolean {
  const flag = (env.JUDGE_ALLOW_FREE_PROVIDERS ?? "").trim().toLowerCase();
  if (!flag) return false;
  if (flag === "emergency") return true;
  const isProduction = (env.VERCEL_ENV ?? env.NODE_ENV) === "production";
  return flag === "1" && !isProduction;
}

/** All providers that currently have an API key configured AND are allowed to serve calls, in priority order. */
export function configuredProviders(env: Record<string, string | undefined> = process.env): ProviderSpec[] {
  if (!freeProvidersAllowed(env)) return [];
  return PROVIDERS.filter((p) => (env[p.keyEnv] ?? "").trim().length > 0);
}

export function activeProvider(env: Record<string, string | undefined> = process.env): ProviderSpec & { key: string } {
  const [first] = configuredProviders(env);
  if (first) return { ...first, key: (env[first.keyEnv] ?? "").trim() };
  // Default shape when nothing is configured: OpenRouter without a key —
  // apiKey() surfaces the actionable error on first use. Selected by label, not
  // by index, so reordering PROVIDERS on new measurements cannot silently
  // change what an unconfigured deployment reports.
  const shape = PROVIDERS.find((p) => p.label === "openrouter") ?? PROVIDERS[0];
  return { ...shape, key: "" };
}

export function activeProviderLabel(): ProviderLabel {
  return activeProvider().label;
}

const MAX_ATTEMPTS = Number(process.env.OPENROUTER_MAX_ATTEMPTS ?? 4);
const RETRY_BUDGET_MS = Number(process.env.OPENROUTER_RETRY_BUDGET_MS ?? 45_000);

function apiKey(): string {
  const provider = activeProvider();
  if (!provider.key || !configuredProviders().length) {
    throw new Error(
      "No judge provider configured — set ANTHROPIC_API_KEY (the pinned paid default), or opt into the free chain with JUDGE_ALLOW_FREE_PROVIDERS=1 (dev/e2e only).",
    );
  }
  return provider.key;
}

function model(): string {
  const provider = activeProvider();
  return process.env[`${provider.label.toUpperCase()}_MODEL`] || provider.defaultModel;
}

/** The model currently selected on the active transport (for fingerprints/telemetry). */
export function currentModel(): string {
  return model();
}

/**
 * Preferred model first, then fallbacks. Set `<LABEL>_FALLBACK_MODELS` to a
 * comma-separated list to override, or to an empty string to disable failover
 * and pin the app to a single model.
 */
export function modelChain(): string[] {
  const provider = activeProvider();
  const configured = process.env[`${provider.label.toUpperCase()}_FALLBACK_MODELS`];
  const defaults = provider.defaultFallbacks;
  const fallbacks =
    configured === undefined
      ? defaults
      : configured.split(",").map((m) => m.trim()).filter(Boolean);
  const primary = model();
  return [primary, ...fallbacks.filter((m) => m !== primary)];
}

/**
 * A saturated pool rarely clears within seconds, so burning the whole attempt
 * budget on it starves the known-good fallbacks. Only the last model in the
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
  if (!text) throw new Error("OpenRouter did not return any content");
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
      `OpenRouter returned invalid JSON: ${(error as Error).message} (output length ${json.length})`,
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
   * a retryable failure and never returned as a successful result — so malformed
   * model output cannot become a favourable verdict or an apparently valid score.
   */
  validate?: (value: unknown) => boolean;
}

/** ChatOptions with the optional fields resolved to their defaults. */
type ResolvedChatOptions = Required<Omit<ChatOptions, "validate">> &
  Pick<ChatOptions, "validate">;

type Attempt<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Several of these models are reasoning models that bill thinking tokens
 * against max_tokens — GLM 5.2 spent 324 of 349 completion tokens on reasoning
 * and returned 25 tokens of JSON. Disabling reasoning is what keeps the token
 * budget available for the answer. Endpoints that require reasoning reject the
 * flag with a 400, and are retried without it.
 */
async function post(
  m: string,
  { instruction, schema, maxTokens }: ResolvedChatOptions,
  key: string,
  disableReasoning: boolean,
): Promise<Response> {
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
    response_format: { type: "json_object" },
    max_tokens: maxTokens,
  };
  if (disableReasoning) payload.reasoning = { enabled: false };

  const provider = activeProvider();

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
  m: string,
  options: ResolvedChatOptions,
  key: string,
  deadline: number,
  maxAttempts: number,
): Promise<Attempt<T>> {
  let disableReasoning = true;
  let lastError = "";

  interface OpenRouterUsage {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const startedAt = Date.now();
    const response = await post(m, options, key, disableReasoning);
    const body: unknown = await response.json().catch(() => null);
    const usage = (body as { usage?: OpenRouterUsage })?.usage;
    const record = (outcome: "ok" | "error", error?: string) =>
      recordAiCall({
        at: new Date().toISOString(),
        operation: options.operation,
        provider: activeProvider().label,
        model: m,
        promptTokens: usage?.prompt_tokens,
        completionTokens: usage?.completion_tokens,
        totalTokens: usage?.total_tokens,
        costUsd: usage?.cost,
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
        // Shape gate: an output that fails the expected schema is a retryable
        // failure, never a successful result. This is what keeps a malformed or
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

    lastError =
      (body as { error?: { metadata?: { raw?: string } } })?.error?.metadata?.raw ??
      (body as { error?: { message?: string } })?.error?.message ??
      `HTTP ${response.status}`;
    record("error", lastError);

    // Endpoints where reasoning is mandatory reject the disable flag outright.
    if (response.status === 400 && disableReasoning && /reasoning/i.test(lastError)) {
      disableReasoning = false;
      continue;
    }

    // Anything else in the 4xx range will not improve on retry — fall through
    // to the next model instead of spending the budget here.
    if (response.status !== 429 && response.status < 500) {
      return { ok: false, error: `${m}: ${lastError}` };
    }

    const delay = retryDelayMs(response, body, attempt);
    if (Date.now() + delay > deadline) break;
    await sleep(delay);
  }

  return { ok: false, error: `${m}: ${lastError}` };
}

async function chatJson<T>({ instruction, schema, maxTokens = 2_000, operation = "unknown", validate }: ChatOptions): Promise<T> {
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
    const key = apiKey();
    const deadline = Date.now() + RETRY_BUDGET_MS;
    const chain = modelChain();
    const options: ResolvedChatOptions = { instruction, schema, maxTokens, operation, validate };
    const failures: string[] = [];

    for (const [index, m] of chain.entries()) {
      const result = await tryModel<T>(m, options, key, deadline, attemptsFor(index, chain.length));
      if (result.ok) return result.value;
      failures.push(result.error);
      if (Date.now() >= deadline) break;
    }

    throw new Error(`OpenRouter request failed. Tried ${chain.length}: ${failures.join(" | ")}`);
  } finally {
    releaseReservation();
  }
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

  const extracted = await chatJson<{ rationale?: string; argGraph?: import("./argGraph").ArgGraph }>({
    schema: JUDGE_SCHEMA,
    maxTokens: 6_000,
    operation: "judge_pvp",
    validate: isValidJudgeExtraction,
    instruction: `You are a neutral, rigorous debate analyst. Topic: "${params.topicTitle}" — ${params.topicPrompt}\nPlayer A argued "${params.playerASide}"; Player B argued the opposite side.\n\n${UNTRUSTED_INSTRUCTION}\n\nTranscript:\n${params.transcript}\n\nAnalyze the observable argument structure, not which side of the topic is "correct". Judge only what is argued and shown: identical content earns identical treatment regardless of which label (A or B) speaks it, and length, repetition, formatting, fluency or confident tone are not argument quality. Named sources, institutions and statistics count only where the argument makes the evidence usable (mechanism, figure, context); authoritative-sounding references without usable content are noise, never strength. Return a faithful argGraph with nodes (c1,e1,k1,r1,i1, text <=18 words), edges, dropped arguments, contradictions, concessions, fallacies, evidenceStats, and impactComparison. Every cited/strong evidence node MUST include a citation object with a named source; never invent arguments or citations not present in the transcript. Also return a short rationale citing specific graph moments. Numeric scores and winner are computed by the application from the graph and must not be estimated here.`,
  });

  return finalizePvpAssessment(extracted, { extractionSource: "llm" });
}
