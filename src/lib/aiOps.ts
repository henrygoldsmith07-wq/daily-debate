// AI operations report — latency/error reliability of the model layer.
//
// Consumes rows from ai_call_log (migration 006, mirrored from aiTelemetry)
// and produces per-operation reliability stats: call volume, error rate, mean
// and p95 latency. Pure — the admin loader fetches rows.
//
// Honesty: operations with fewer than MIN_SAMPLE calls show no rates; the p95
// uses nearest-rank on the sample actually present.

export interface AiOpsRow {
  operation: string;
  provider: string;
  model: string;
  latencyMs: number;
  ok: boolean;
  totalTokens: number | null;
  /** Structured failure category (never raw provider text). */
  errorCategory: string | null;
  createdAt: string;
  eventType?: "model_call" | "routing" | string | null;
  inputCount?: number | null;
  batchCount?: number | null;
  routingDecision?: string | null;
  expensiveJudgeCallsAvoided?: number | null;
  classificationFallbacks?: number | null;
  classificationAmbiguous?: number | null;
}

export interface AiOpsStats {
  operation: string;
  calls: number;
  errors: number;
  errorRate: number | null;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  /** Bounded failure-category counts (rate_limit, timeout, …). */
  byCategory: Record<string, number>;
  /** Error rate is only reported at MIN_SAMPLE calls. */
  note: string | null;
}

export interface AiOpsReport {
  generatedAt: string;
  windowDays: number;
  totalCalls: number;
  overall: AiOpsStats;
  byOperation: AiOpsStats[];
  routing: {
    events: number;
    argumentsClassified: number;
    batches: number;
    expensiveJudgeCallsAvoided: number;
    fallbacks: number;
    ambiguous: number;
    byRoute: Record<string, number>;
  };
  note: string | null;
}

export const AI_OPS_MIN_SAMPLE = 5;
export const AI_OPS_DEFAULT_WINDOW_DAYS = 7;

function p95NearestRank(sortedAsc: number[]): number | null {
  if (!sortedAsc.length) return null;
  const rank = Math.max(1, Math.ceil(0.95 * sortedAsc.length));
  return sortedAsc[Math.min(rank, sortedAsc.length) - 1];
}

function summarise(operation: string, rows: AiOpsRow[], minSample: number): AiOpsStats {
  const latencies = rows.map((r) => r.latencyMs).sort((a, b) => a - b);
  const errors = rows.filter((r) => !r.ok).length;
  const byCategory: Record<string, number> = {};
  for (const r of rows) {
    if (r.ok || !r.errorCategory) continue;
    byCategory[r.errorCategory] = (byCategory[r.errorCategory] ?? 0) + 1;
  }
  const measurable = rows.length >= minSample;
  return {
    operation,
    calls: rows.length,
    errors,
    errorRate: measurable ? +(errors / rows.length).toFixed(3) : null,
    avgLatencyMs: measurable ? Math.round(latencies.reduce((s, v) => s + v, 0) / rows.length) : null,
    p95LatencyMs: p95NearestRank(latencies),
    byCategory,
    note: measurable ? null : `not yet measurable — ${rows.length} call${rows.length === 1 ? "" : "s"} (need ${minSample})`,
  };
}

function summariseRouting(rows: AiOpsRow[]): AiOpsReport["routing"] {
  const routing = rows.filter((row) => row.eventType === "routing" || row.operation === "argument_routing");
  const byRoute: Record<string, number> = {};
  for (const row of routing) {
    if (row.routingDecision) byRoute[row.routingDecision] = (byRoute[row.routingDecision] ?? 0) + 1;
  }
  return {
    events: routing.length,
    argumentsClassified: routing.reduce((sum, row) => sum + (row.inputCount ?? 0), 0),
    batches: routing.reduce((sum, row) => sum + (row.batchCount ?? 0), 0),
    expensiveJudgeCallsAvoided: routing.reduce((sum, row) => sum + (row.expensiveJudgeCallsAvoided ?? 0), 0),
    fallbacks: routing.reduce((sum, row) => sum + (row.classificationFallbacks ?? 0), 0),
    ambiguous: routing.reduce((sum, row) => sum + (row.classificationAmbiguous ?? 0), 0),
    byRoute,
  };
}

export function summariseAiOps(
  rows: AiOpsRow[],
  opts: { now?: string; windowDays?: number; minSample?: number } = {},
): AiOpsReport {
  const windowDays = opts.windowDays ?? AI_OPS_DEFAULT_WINDOW_DAYS;
  const minSample = opts.minSample ?? AI_OPS_MIN_SAMPLE;
  const now = opts.now ?? new Date().toISOString();
  const cutoff = Date.parse(now) - windowDays * 86_400_000;
  const inWindow = rows.filter((r) => Date.parse(r.createdAt) >= cutoff);

  const byOperation = [...new Set(inWindow.map((r) => r.operation))]
    .map((op) => summarise(op, inWindow.filter((r) => r.operation === op), minSample))
    .sort((a, b) => b.calls - a.calls);

  return {
    generatedAt: now,
    windowDays,
    totalCalls: inWindow.length,
    overall: summarise("all", inWindow, minSample),
    byOperation,
    routing: summariseRouting(inWindow),
    note: inWindow.length === 0 ? "No AI calls recorded in this window." : null,
  };
}
