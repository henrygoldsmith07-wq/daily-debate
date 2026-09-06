import "server-only";

/**
 * AI cost/telemetry ledger.
 *
 * Every AI provider call (OpenRouter chain, Anthropic SDK) records one ledger
 * entry: which operation, which model, token usage, cost when the provider
 * reports it, latency, and outcome. Entries live in an in-process ring buffer
 * (bounded, no external dependency) and are mirrored to the structured log so
 * server-side log drains capture them even across cold starts.
 *
 * The ledger is observability only: nothing reads it on the request path, and
 * losing it never fails a user-facing operation.
 */

export type AiCallOutcome = "ok" | "error";

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
  /** Short failure summary when outcome === "error". */
  error?: string;
}

const MAX_ENTRIES = 500;
const buffer: AiCallTelemetry[] = [];

export function recordAiCall(entry: AiCallTelemetry): void {
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.shift();
  // Structured log line — survives restarts via the platform's log drain.
  console.info("[ai-telemetry]", JSON.stringify(entry));
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
