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

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

/**
 * Two interchangeable OpenAI-style transports:
 *  - NVIDIA (build.nvidia.com) when NVIDIA_API_KEY is set — the intended primary;
 *    direct Nemotron access without the ":free" pool saturation.
 *  - OpenRouter free tier otherwise.
 */
export type ProviderLabel = "nvidia" | "openrouter";

export function activeProvider(): { label: ProviderLabel; url: string; key: string } {
  if (process.env.NVIDIA_API_KEY) {
    return { label: "nvidia", url: NVIDIA_API_URL, key: process.env.NVIDIA_API_KEY };
  }
  return { label: "openrouter", url: OPENROUTER_API_URL, key: process.env.OPENROUTER_API_KEY ?? "" };
}

export function activeProviderLabel(): ProviderLabel {
  return activeProvider().label;
}

/** Free GLM 5.2 on the OpenRouter transport. Override per-environment without a code change. */
export const DEFAULT_MODEL = "z-ai/glm-5.2:free";

/** Direct-NVIDIA default: the strongest Nemotron, no shared free-pool saturation. */
export const NVIDIA_DEFAULT_MODEL = "nvidia/nemotron-3-ultra-550b-a55b";

/**
 * GLM 5.2's free tier is served by a single upstream provider whose shared pool
 * is frequently saturated — it can return 429 for long stretches. These two are
 * the free models measured to hold up on the heaviest call (the PvP argument
 * graph): both returned a well-formed 12-node graph with every cited evidence
 * node carrying a citation. Ordered strongest first.
 */
export const DEFAULT_FALLBACK_MODELS = [
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
];

/** NVIDIA-transport fallbacks (no ":free" suffix on the direct API). */
export const NVIDIA_DEFAULT_FALLBACK_MODELS = ["nvidia/nemotron-3-super-120b-a12b"];

const MAX_ATTEMPTS = Number(process.env.OPENROUTER_MAX_ATTEMPTS ?? 4);
const RETRY_BUDGET_MS = Number(process.env.OPENROUTER_RETRY_BUDGET_MS ?? 45_000);

function apiKey(): string {
  const provider = activeProvider();
  if (!provider.key) {
    throw new Error(
      provider.label === "nvidia"
        ? "NVIDIA_API_KEY is not configured."
        : "OPENROUTER_API_KEY is not configured (or set NVIDIA_API_KEY for the NVIDIA transport).",
    );
  }
  return provider.key;
}

function model(): string {
  if (activeProvider().label === "nvidia") {
    return process.env.NVIDIA_MODEL || NVIDIA_DEFAULT_MODEL;
  }
  return process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
}

/**
 * Preferred model first, then fallbacks. Set OPENROUTER_FALLBACK_MODELS (or
 * NVIDIA_FALLBACK_MODELS on the NVIDIA transport) to a comma-separated list to
 * override, or to an empty string to disable failover and pin the app to a
 * single model.
 */
export function modelChain(): string[] {
  const onNvidia = activeProvider().label === "nvidia";
  const configured = onNvidia ? process.env.NVIDIA_FALLBACK_MODELS : process.env.OPENROUTER_FALLBACK_MODELS;
  const defaults = onNvidia ? NVIDIA_DEFAULT_FALLBACK_MODELS : DEFAULT_FALLBACK_MODELS;
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
    // Surface a snippet so 502s are diagnosable from logs alone.
    throw new Error(
      `OpenRouter returned invalid JSON: ${(error as Error).message} — "${json.slice(0, 200)}"`,
    );
  }
}

interface ChatOptions {
  instruction: string;
  schema: Record<string, unknown>;
  /** The graph judge needs far more room than a single debate turn. */
  maxTokens?: number;
}

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
  { instruction, schema, maxTokens }: Required<ChatOptions>,
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
  options: Required<ChatOptions>,
  key: string,
  deadline: number,
  maxAttempts: number,
): Promise<Attempt<T>> {
  let disableReasoning = true;
  let lastError = "";

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await post(m, options, key, disableReasoning);
    const body: unknown = await response.json().catch(() => null);

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
        return { ok: false, error: `${m} ${why}` };
      }

      try {
        return { ok: true, value: parseJson<T>(content) };
      } catch (error) {
        const truncated = choice?.finish_reason === "length" ? " — output was truncated at max_tokens" : "";
        return { ok: false, error: `${(error as Error).message}${truncated}` };
      }
    }

    lastError =
      (body as { error?: { metadata?: { raw?: string } } })?.error?.metadata?.raw ??
      (body as { error?: { message?: string } })?.error?.message ??
      `HTTP ${response.status}`;

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

async function chatJson<T>({ instruction, schema, maxTokens = 2_000 }: ChatOptions): Promise<T> {
  const key = apiKey();
  const deadline = Date.now() + RETRY_BUDGET_MS;
  const chain = modelChain();
  const options = { instruction, schema, maxTokens };
  const failures: string[] = [];

  for (const [index, m] of chain.entries()) {
    const result = await tryModel<T>(m, options, key, deadline, attemptsFor(index, chain.length));
    if (result.ok) return result.value;
    failures.push(result.error);
    if (Date.now() >= deadline) break;
  }

  throw new Error(`OpenRouter request failed. Tried ${chain.length}: ${failures.join(" | ")}`);
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
}): Promise<DebateTurnResult> {
  const aiSide: DebateSide = params.userSide === "for" ? "against" : "for";

  const transcript = params.history
    .map((turn) => `${turn.role === "ai" ? "AI (opposing)" : "User"}: ${turn.text}`)
    .join("\n");

  return chatJson<DebateTurnResult>({
    schema: TURN_SCHEMA,
    instruction: `You are an AI debate opponent in a critical-thinking training app. Topic: "${params.topicTitle}" — ${params.topicPrompt}\nThe user is arguing the "${params.userSide}" side. You are arguing the "${aiSide}" side, and your job is to challenge the user's thinking as rigorously and fairly as possible so they sharpen their reasoning.\n\nTranscript so far:\n${transcript}\n\nUser's latest response: "${params.latestUserMessage}"\n\nGive brief, specific feedback and produce your next challenge. Do not assign numeric scores; the application computes those from observable argument evidence after this response.`,
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
}): Promise<string> {
  const result = await chatJson<{ aiMessage: string }>({
    schema: OPENING_SCHEMA,
    instruction: `Open a debate on "${params.topicTitle}" — ${params.topicPrompt}\nArgue the "${params.aiSide}" side in 2-4 sentences, stating a clear, specific opening claim (not a vague restatement of the prompt).`,
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
  return chatJson<DebateSummary>({
    schema: SUMMARY_SCHEMA,
    instruction: `Here is a full debate practice transcript on "${params.topicTitle}":\n\n${params.transcript}\n\nGive the user a short overall assessment of their critical-thinking performance, with specific strengths and areas to improve.`,
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
  const extracted = await chatJson<{ rationale?: string; argGraph?: import("./argGraph").ArgGraph }>({
    schema: JUDGE_SCHEMA,
    maxTokens: 6_000,
    instruction: `You are a neutral, rigorous debate analyst. Topic: "${params.topicTitle}" — ${params.topicPrompt}\nPlayer A argued "${params.playerASide}"; Player B argued the opposite side.\n\nTranscript:\n${params.transcript}\n\nAnalyze the observable argument structure, not which side of the topic is "correct". Return a faithful argGraph with nodes (c1,e1,k1,r1,i1, text <=18 words), edges, dropped arguments, contradictions, concessions, fallacies, evidenceStats, and impactComparison. Every cited/strong evidence node MUST include a citation object with a named source; never invent arguments or citations not present in the transcript. Also return a short rationale citing specific graph moments. Numeric scores and winner are computed by the application from the graph and must not be estimated here.`,
  });

  return finalizePvpAssessment(extracted, { extractionSource: "llm" });
}
