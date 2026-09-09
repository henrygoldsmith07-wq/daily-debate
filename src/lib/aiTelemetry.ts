import "server-only";

/**
 * AI cost/telemetry ledger.
 *
 * Every AI provider call (OpenRouter chain, Anthropic SDK) records one ledger
 * entry: which operation, which model, token usage, cost when the provider
 * reports it, latency, and outcome. Entries live in an in-process ring buffer
 * (bounded, no external dependency) and are mirrored best-effort to the
 * structured log and the `ai_call_log` table (migration 006/007).
 *
 * PRIVACY: provider errors are never persisted verbatim. `classifyAiError`
 * reduces every failure to bounded structured fields (category, code, HTTP
 * status, retryable) plus — only where genuinely useful — a sanitised,
 * truncated diagnostic with credentials and response bodies stripped.
 *
 * The ledger is observability only: nothing reads it on the request path, and
 * losing it never fails a user-facing operation. Database persistence is
 * BEST-EFFORT, not guaranteed delivery.
 */

export type AiCallOutcome = "ok" | "error";

export type AiErrorCategory =
  | "rate_limit"
  | "auth"
  | "invalid_request"
  | "timeout"
  | "network"
  | "server"
  | "invalid_response"
  | "unknown";

export interface ClassifiedAiError {
  category: AiErrorCategory;
  /** Short provider/transport code, e.g. "429" or "length" — bounded to 40 chars. */
  code: string;
  httpStatus: number | null;
  retryable: boolean;
  /** Sanitised, truncated diagnostic (≤160 chars) or undefined. */
  sanitized: string | undefined;
}

/** Patterns that must never reach storage: credentials and response bodies. */
const SECRET_PATTERNS: RegExp[] = [
  /bearer\s+\S+/gi,
  /api[-_]?key[s]?\s*[:=]\s*\S+/gi,
  /sk-[A-Za-z0-9_-]{8,}/g,
  /authorization\s*[:=]\s*\S+/gi,
];

export function sanitizeDiagnostic(raw: string, maxChars = 160): string {
  let out = String(raw ?? "");
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, "[redacted]");
  // Collapse whitespace/newlines: multi-line provider bodies become one line.
  out = out.replace(/\s+/g, " ").trim();
  return out.length > maxChars ? `${out.slice(0, maxChars - 1)}…` : out;
}

/**
 * Reduce any provider failure to bounded, non-sensitive fields. Raw provider
 * text (response bodies, headers, account details) never survives this
 * function into storage.
 */
export function classifyAiError(raw: unknown, httpStatus?: number | null): ClassifiedAiError {
  const message = typeof raw === "string" ? raw : String((raw as Error)?.message ?? raw ?? "");
  const lower = message.toLowerCase();
  const status =
    typeof httpStatus === "number" && httpStatus > 0
      ? httpStatus
      : (message.match(/\b(4\d\d|5\d\d)\b/)?.[1] ? Number(message.match(/\b(4\d\d|5\d\d)\b/)![1]) : null);

  let category: AiErrorCategory = "unknown";
  let retryable = false;

  if (/\babort|timeout|timed?\s*out\b/.test(lower)) {
    category = "timeout";
    retryable = true;
  } else if (/\bfetch failed|network|econn|enotfound|dns\b/.test(lower)) {
    category = "network";
    retryable = true;
  } else if (status === 429 || status === 529 || /rate\s*limit|too many requests/.test(lower)) {
    category = "rate_limit";
    retryable = true;
  } else if (status === 401 || status === 403 || /unauthor|forbidden|invalid api key|authentication/.test(lower)) {
    category = "auth";
  } else if (status !== null && status >= 500) {
    category = "server";
    retryable = true;
  } else if (status === 400 || status === 404 || status === 422) {
    category = "invalid_request";
  } else if (/no content|no json|parse|unexpected|finish_reason|truncated/i.test(lower)) {
    category = "invalid_response";
  }

  // Short machine-usable code: explicit finish_reason, else the HTTP status.
  const finishReason = message.match(/finish_reason[:\s]*"?([a-z_]+)"?/i)?.[1];
  const code = (finishReason ?? (status !== null ? String(status) : category)).slice(0, 40);

  const sanitized = message.trim() ? sanitizeDiagnostic(message) : undefined;
  return { category, code, httpStatus: status, retryable, sanitized };
}

export interface AiCallTelemetry {
  /** ISO timestamp of call completion. */
  at: string;
  /** Logical operation, e.g. "judge_pvp" — stable identifiers for attribution. */
  operation: string;
  /** Provider stack that served (or failed) the call: "openrouter" | "anthropic". */
  provider: "openrouter" | "anthropic";
  /** Concrete model identifier attempted, e.g. "anthropic/claude-sonnet-4.5". */
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /** USD cost as reported by the provider (OpenRouter). Absent when not reported. */
  costUsd?: number;
  latencyMs: number;
  outcome: AiCallOutcome;
  /** Structured failure classification — never raw provider text. */
  errorCategory?: AiErrorCategory;
  errorCode?: string;
  httpStatus?: number | null;
  retryable?: boolean;
  /** Sanitised, truncated diagnostic. Undefined for ok calls. */
  error?: string;
}

const MAX_ENTRIES = 500;
const buffer: AiCallTelemetry[] = [];

/**
 * Best-effort durable mirror: writes the entry to ai_call_log (migration
 * 006/007) so latency/error dashboards survive serverless cold starts.
 * Fire-and-forget — never awaited, never allowed to break the request path.
 * BEST-EFFORT persistence: the structured log line below is the guaranteed
 * record via the platform drain; the database row is not.
 */
function mirrorToDatabase(entry: AiCallTelemetry): void {
  void (async () => {
    try {
      const { createServiceClient } = await import("./backend/server");
      const service = createServiceClient();
      await service.from("ai_call_log").insert({
        operation: entry.operation,
        provider: entry.provider,
        model: entry.model,
        prompt_tokens: entry.promptTokens ?? null,
        completion_tokens: entry.completionTokens ?? null,
        total_tokens: entry.totalTokens ?? null,
        latency_ms: entry.latencyMs,
        outcome: entry.outcome,
        error_category: entry.errorCategory ?? null,
        error_code: entry.errorCode ?? null,
        http_status: entry.httpStatus ?? null,
        retryable: entry.retryable ?? null,
        error: entry.error ?? null,
      });
    } catch {
      // Observability must never fail an operation; the log line above
      // still reaches the platform drain.
    }
  })();
}

export function recordAiCall(entry: AiCallTelemetry): void {
  // Defence in depth: even a misbehaving caller cannot store raw provider
  // output — the diagnostic is re-sanitised and bounded at the boundary.
  const safe: AiCallTelemetry =
    entry.error !== undefined
      ? { ...entry, error: sanitizeDiagnostic(entry.error), at: entry.at }
      : entry;
  buffer.push(safe);
  if (buffer.length > MAX_ENTRIES) buffer.shift();
  // Structured log line — survives restarts via the platform's log drain.
  console.info("[ai-telemetry]", JSON.stringify(safe));
  mirrorToDatabase(safe);
}

export function recentAiCalls(limit = 50): AiCallTelemetry[] {
  return buffer.slice(-limit).reverse();
}

export interface AiTelemetryStats {
  calls: number;
  errors: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCostUsd: number;
  costKnown: boolean; // false when some calls lacked provider-reported cost
  avgLatencyMs: number;
}

export function aiCallStats(operation?: string): AiTelemetryStats {
  const scoped = operation ? buffer.filter((e) => e.operation === operation) : buffer;
  let promptTokens = 0;
  let completionTokens = 0;
  let costUsd = 0;
  let costKnown = true;
  let latency = 0;
  let errors = 0;
  for (const e of scoped) {
    promptTokens += e.promptTokens ?? 0;
    completionTokens += e.completionTokens ?? 0;
    if (typeof e.costUsd === "number") costUsd += e.costUsd;
    else costKnown = false;
    latency += e.latencyMs;
    if (e.outcome === "error") errors += 1;
  }
  return {
    calls: scoped.length,
    errors,
    totalPromptTokens: promptTokens,
    totalCompletionTokens: completionTokens,
    totalCostUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
    costKnown,
    avgLatencyMs: scoped.length ? Math.round(latency / scoped.length) : 0,
  };
}

/** Test hook: clear the in-memory buffer. */
export function resetAiTelemetry(): void {
  buffer.length = 0;
}
