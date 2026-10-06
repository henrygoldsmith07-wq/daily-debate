import "server-only";

import { createServiceClient } from "./backend/server";
import { summariseAiOps, type AiOpsReport, type AiOpsRow } from "./aiOps";

export type AiOpsDataStatus = "ok" | "partial" | "unavailable";

export type AiOpsData =
  | {
      status: "unavailable";
      errorCategory: "backend-unavailable" | "ai-log-read-failed";
      report: null;
    }
  | {
      status: "partial";
      errorCategory: "truncated";
      report: AiOpsReport;
    }
  | {
      status: "ok";
      errorCategory: null;
      report: AiOpsReport;
    };

const MAX_AI_OPS_ROWS = 5000;

function aiOpsCutoffIso(): string {
  return new Date(Date.now() - 7 * 86_400_000).toISOString();
}

export async function loadAiOpsData(): Promise<AiOpsData> {
  let service;
  try {
    service = createServiceClient();
  } catch {
    return { status: "unavailable", errorCategory: "backend-unavailable", report: null };
  }

  const { data, error } = await service
    .from("ai_call_log")
    .select("operation, provider, model, latency_ms, outcome, total_tokens, error_category, event_type, input_count, batch_count, routing_decision, expensive_judge_calls_avoided, classification_fallbacks, classification_ambiguous, created_at")
    .gte("created_at", aiOpsCutoffIso())
    .order("created_at", { ascending: false })
    .limit(MAX_AI_OPS_ROWS + 1);
  if (error) {
    return { status: "unavailable", errorCategory: "ai-log-read-failed", report: null };
  }

  const truncated = (data ?? []).length > MAX_AI_OPS_ROWS;
  const rows = (data ?? []).slice(0, MAX_AI_OPS_ROWS);
  const mapped: AiOpsRow[] = rows.map((r) => ({
    operation: r.operation,
    provider: r.provider,
    model: r.model,
    latencyMs: r.latency_ms,
    ok: r.outcome === "ok",
    totalTokens: r.total_tokens,
    errorCategory: r.error_category,
    eventType: r.event_type,
    inputCount: r.input_count,
    batchCount: r.batch_count,
    routingDecision: r.routing_decision,
    expensiveJudgeCallsAvoided: r.expensive_judge_calls_avoided,
    classificationFallbacks: r.classification_fallbacks,
    classificationAmbiguous: r.classification_ambiguous,
    createdAt: r.created_at,
  }));

  const report = summariseAiOps(mapped, {});
  return truncated
    ? { status: "partial", errorCategory: "truncated", report }
    : { status: "ok", errorCategory: null, report };
}
