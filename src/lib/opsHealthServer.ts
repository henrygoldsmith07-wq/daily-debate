import "server-only";
import fs from "node:fs";
import path from "node:path";
import { createServiceClient } from "./backend/server";
import type { TableName } from "./backend/query";
import {
  assessAppHealth,
  assessDatabaseHealth,
  assessHumanValidation,
  assessJudgeHealth,
  assessTopicHealth,
  assessTopicSlo,
  assessTrainingEvidence,
  buildOpsHealthReport,
  type AiProductionEvidence,
  type EvidenceSection,
  type OpsHealthReport,
  type TopicRunTelemetryRow,
  type TopicScheduledRun,
  type TrainingEvidence,
  type WorkflowStatusInput,
} from "./opsHealth";
import { computeCorpusMetrics, type MetricItem, type MetricRating } from "./corpusMetrics";
import { buildRepairOutcomeFunnel } from "./productFunnel";
import { loadFunnelData } from "./productFunnelServer";

// Server-side data gathering for the operational-health report. All state
// interpretation lives in the pure opsHealth.ts assessors (unit-tested);
// this module only fetches. Every source degrades gracefully: a failed
// source yields "unknown"/"blocked", never green and never a throw.

const REPO = "henrygoldsmith07-wq/daily-debate";
export const CI_ACTIONS_URL = `https://github.com/${REPO}/actions`;

/** Tables the background systems require (topics, corpus, repairs, events, ledger). */
const REQUIRED_TABLES: TableName[] = [
  "daily_topics",
  "topic_evidence",
  "corpus_items",
  "corpus_ratings",
  "repair_results",
  "product_events",
  "app_migrations",
];

const CI_WORKFLOWS = ["daily-debate.yml", "judge-benchmark.yml", "topic-generation.yml"];

async function fetchWorkflowRuns(token: string): Promise<WorkflowStatusInput[] | null> {
  try {
    const runs: WorkflowStatusInput[] = [];
    for (const workflow of CI_WORKFLOWS) {
      const res = await fetch(
        `https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/runs?per_page=1&branch=main`,
        {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
          signal: AbortSignal.timeout(8000),
        },
      );
      if (!res.ok) return null;
      const data = (await res.json()) as {
        workflow_runs?: Array<{ name?: string; status?: string; conclusion?: string | null }>;
      };
      const run = data.workflow_runs?.[0];
      if (!run) return null;
      runs.push({
        name: run.name ?? workflow,
        status: (run.status as WorkflowStatusInput["status"]) ?? null,
        conclusion: run.conclusion ?? null,
      });
    }
    return runs;
  } catch {
    return null;
  }
}

/**
 * Production scheduler truth: the last several runs of topic-generation.yml,
 * with their trigger event. `schedule` events are the ONLY runs that can
 * prove the production SLO; workflow_dispatch proves a manual run; CI runs
 * of the app workflow prove neither.
 */
async function fetchTopicGenerationRuns(token?: string): Promise<TopicScheduledRun[] | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/actions/workflows/topic-generation.yml/runs?per_page=8&branch=main`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      workflow_runs?: Array<{ event?: string; status?: string; conclusion?: string | null; created_at?: string }>;
    };
    return (data.workflow_runs ?? [])
      .filter((r) => r.created_at)
      .map((r) => ({
        event: r.event ?? "unknown",
        status: r.status ?? "unknown",
        conclusion: r.conclusion ?? null,
        createdAt: r.created_at as string,
      }));
  } catch {
    return null;
  }
}

function readJudgeArtifact(): {
  at: string;
  limit: number | null;
  allPass: boolean | null;
  models: string[];
} | null {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), "docs", "latest-judge-benchmark.json"), "utf8");
    const parsed = JSON.parse(raw) as {
      at?: unknown;
      limit?: unknown;
      allPass?: unknown;
      results?: unknown;
    };
    if (typeof parsed.at !== "string") return null;
    const results = Array.isArray(parsed.results) ? parsed.results : [];
    return {
      at: parsed.at,
      limit: typeof parsed.limit === "number" ? parsed.limit : null,
      allPass: typeof parsed.allPass === "boolean" ? parsed.allPass : null,
      models: results
        .map((r) => (r && typeof r === "object" && "model" in r ? String((r as { model: unknown }).model) : null))
        .filter((m): m is string => !!m),
    };
  } catch {
    return null;
  }
}

export async function loadOpsHealth(nowIso?: string): Promise<OpsHealthReport> {
  const now = nowIso ?? new Date().toISOString();
  const service = createServiceClient();
  const human = await loadHumanSection();
  const training = await loadTrainingSection(now);

  // --- Database: connectivity, latency, migrations, required tables --------
  let database;
  try {
    const started = Date.now();
    const migrations = await service.from("app_migrations").select("name");
    const latencyMs = Date.now() - started;
    if (migrations.error) throw new Error(migrations.error.message ?? "migration ledger unreadable");
    const applied = ((migrations.data ?? []) as Array<{ name: string }>).map((r) => r.name);
    const missingTables: string[] = [];
    for (const table of REQUIRED_TABLES) {
      const probed = await service.from(table).select("id").limit(1);
      if (probed.error) missingTables.push(table);
    }
    database = assessDatabaseHealth({
      reachable: true,
      latencyMs,
      migrationsApplied: applied.length,
      missingTables,
      topicRunLogFidelity: await probeTopicRunLogFidelity(),
    });
  } catch {
    database = assessDatabaseHealth({ reachable: false });
  }

  // --- Topic pipeline: latest rows, provenance, evidence -------------------
  let topic;
  let topicStoreReadable = true;
  try {
    const rows = await service
      .from("daily_topics")
      .select("id, topic_date, title, generation_source, created_at")
      .order("topic_date", { ascending: false })
      .limit(5);
    if (rows.error) throw new Error(rows.error.message ?? "daily_topics unreadable");
    const list = (rows.data ?? []) as Array<{
      id: string;
      topic_date: string;
      title: string;
      generation_source: string | null;
    }>;
    if (!list.length) {
      topic = assessTopicHealth(null, now);
    } else {
      const latest = list[0];
      const cards = await service
        .from("topic_evidence")
        .select("id", { count: "exact", head: true })
        .eq("topic_id", latest.id);
      topic = assessTopicHealth(
        {
          topic_date: latest.topic_date,
          title: latest.title,
          generation_source: latest.generation_source,
          evidence_cards: typeof cards.count === "number" ? cards.count : null,
        },
        now,
      );
    }
  } catch {
    topicStoreReadable = false;
    topic = {
      ...assessTopicHealth(null, now),
      status: "blocked" as const,
      note: "Topic store unreadable — database or permissions failure, not just staleness.",
    };
  }

  // --- Judge validation: checked-in live artifact --------------------------
  const judge = assessJudgeHealth(readJudgeArtifact(), now);

  // --- App CI/E2E: GitHub Actions when a token is available ----------------
  const token = process.env.GITHUB_TOKEN?.trim();
  const app = assessAppHealth(token ? await fetchWorkflowRuns(token) : null, CI_ACTIONS_URL);

  // --- Topic production SLO: real scheduler runs + production store --------
  // Deliberately independent of CI: topic-pipeline job success is NOT counted
  // here; only schedule/dispatch runs of topic-generation.yml plus a readable
  // production topic store can mark this healthy. The durable topic_run_log
  // (migration 014) supplies scheduler-delay/availability telemetry; missing
  // table or unreadable rows degrade to "no telemetry", never to errors.
  const topicRuns = await fetchTopicGenerationRuns(token);
  const telemetry = await loadTopicRunTelemetry();
  const aiEvidence = topicStoreReadable ? await loadAiProductionEvidence(telemetry) : null;
  const topicSlo = assessTopicSlo(
    {
      runs: topicRuns ?? [],
      productionDbReadable: topicStoreReadable,
      tomorrowReady: topic.tomorrowReady,
      telemetry,
      aiEvidence,
    },
    now,
  );

  return buildOpsHealthReport({ generatedAt: now, topic, topicSlo, judge, database, app, human, training });
}

/**
 * Migration 016 readiness probe: full when topic_run_log carries
 * run_created_at, queue_delay_ms, generator_result and provider_health,
 * legacy when telemetry flows without them, unknown when the table cannot
 * be inspected. Legacy stays visible (degraded) rather than silently
 * presenting full telemetry capability.
 */
async function probeTopicRunLogFidelity(): Promise<"full" | "legacy" | "unknown"> {
  try {
    const { queryRows } = await import("./backend/sql");
    const rows = await queryRows<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'topic_run_log'`,
    );
    const present = new Set(rows.map((r) => String(r.column_name)));
    if (!present.size) return "unknown";
    const required = ["run_created_at", "queue_delay_ms", "generator_result", "provider_health"];
    return required.every((c) => present.has(c)) ? "full" : "legacy";
  } catch {
    return "unknown";
  }
}

/**
 * Real-AI end-to-end evidence: the newest AI-provenance row with surviving
 * non-empty sources, matched against a verified AI telemetry row for the
 * same target date. A fallback standing in for AI can never satisfy this.
 */
async function loadAiProductionEvidence(
  telemetry: TopicRunTelemetryRow[],
): Promise<AiProductionEvidence | null> {
  try {
    const service = createServiceClient();
    const rows = await service
      .from("daily_topics")
      .select("topic_date, sources, generation_source")
      .eq("generation_source", "ai")
      .order("topic_date", { ascending: false })
      .limit(5);
    if (rows.error) return null;
    const list = (rows.data ?? []) as Array<{
      topic_date: string;
      sources: unknown;
      generation_source: string | null;
    }>;
    if (!list.length) return { targetDate: null, aiRowPresent: false, sourcesNonEmpty: false, telemetryVerifiedAi: false };
    for (const row of list) {
      const sources = Array.isArray(row.sources) ? row.sources : [];
      const targetDate = String(row.topic_date).slice(0, 10);
      const verified = telemetry.some(
        (t) => t.targetDate === targetDate && t.generatorResult === "ai" && t.freshnessOk === true,
      );
      if (sources.length > 0) {
        return { targetDate, aiRowPresent: true, sourcesNonEmpty: true, telemetryVerifiedAi: verified };
      }
      return { targetDate, aiRowPresent: true, sourcesNonEmpty: false, telemetryVerifiedAi: verified };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Per-run durable telemetry from topic_run_log. completedBeforeDeadline is
 * derived, not stored: a run for target date T "hit the deadline" iff it
 * completed by T's date-boundary + SLO clock (03:00 UTC of the day the topic
 * serves - i.e. T 00:00 is when it becomes today; 03:00 is the hard cap).
 */
async function loadTopicRunTelemetry(): Promise<TopicRunTelemetryRow[]> {
  const parseAttempts = (raw: unknown): TopicRunTelemetryRow["providerAttempts"] => {
    if (raw === null || raw === undefined) return null;
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!Array.isArray(parsed)) return null;
      return parsed
        .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
        .map((a) => ({
          provider: typeof a.provider === "string" ? a.provider : null,
          model: typeof a.model === "string" ? a.model : "unknown",
          outcome: typeof a.outcome === "string" ? a.outcome : "other",
          latencyMs: typeof a.latencyMs === "number" ? a.latencyMs : null,
          httpStatus: typeof a.httpStatus === "number" ? a.httpStatus : null,
          errorCategory: typeof a.errorCategory === "string" ? a.errorCategory : null,
        }));
    } catch {
      return null;
    }
  };
  const mapRow = (r: {
    event: string;
    started_at: string;
    run_created_at?: string | null;
    completed_at: string | null;
    delay_ms: string | number | null;
    queue_delay_ms?: string | number | null;
    target_date: string | null;
    result: string;
    freshness_ok: boolean | null;
    provider_health?: string | null;
    generator_result?: string | null;
    topic_fingerprint?: string | null;
    provider_attempts?: unknown;
  }): TopicRunTelemetryRow => {
    let beforeDeadline: boolean | null = null;
    if (r.completed_at && r.target_date) {
      const deadline = Date.parse(`${r.target_date.slice(0, 10)}T00:00:00Z`) + 3 * 3_600_000;
      beforeDeadline = Date.parse(r.completed_at) <= deadline && r.freshness_ok !== false;
    }
    return {
      event: r.event,
      at: r.started_at,
      runCreatedAt: r.run_created_at ?? null,
      completedAt: r.completed_at,
      result: r.result,
      delayMs: r.delay_ms === null ? null : Number(r.delay_ms),
      queueDelayMs: r.queue_delay_ms === null || r.queue_delay_ms === undefined ? null : Number(r.queue_delay_ms),
      targetDate: r.target_date ? r.target_date.slice(0, 10) : null,
      completedBeforeDeadline: beforeDeadline,
      freshnessOk: r.freshness_ok,
      providerHealth: r.provider_health ?? null,
      generatorResult: r.generator_result ?? null,
      topicFingerprint: r.topic_fingerprint ?? null,
      providerAttempts: parseAttempts(r.provider_attempts),
    };
  };
  try {
    const { queryRows } = await import("./backend/sql");
    try {
      const rows = await queryRows<{
        event: string;
        started_at: string;
        run_created_at: string | null;
        completed_at: string | null;
        delay_ms: string | number | null;
        queue_delay_ms: string | number | null;
        target_date: string | null;
        result: string;
        freshness_ok: boolean | null;
        provider_health: string | null;
        generator_result: string | null;
        topic_fingerprint: string | null;
        provider_attempts: unknown;
      }>(
        `SELECT event, started_at, run_created_at, completed_at, delay_ms, queue_delay_ms,
                target_date, result, freshness_ok, provider_health, generator_result,
                topic_fingerprint, provider_attempts
           FROM topic_run_log ORDER BY started_at DESC LIMIT 60`,
      );
      return rows.map(mapRow);
    } catch {
      // Pre-016 databases lack the fidelity columns — fall back to the
      // legacy shape so telemetry still loads instead of going dark.
      const rows = await queryRows<{
        event: string;
        started_at: string;
        completed_at: string | null;
        delay_ms: string | number | null;
        target_date: string | null;
        result: string;
        freshness_ok: boolean | null;
      }>(
        `SELECT event, started_at, completed_at, delay_ms, target_date, result, freshness_ok
           FROM topic_run_log ORDER BY started_at DESC LIMIT 60`,
      );
      return rows.map(mapRow);
    }
  } catch {
    return [];
  }
}

/**
 * Human-evaluation readiness: consensus volume, independent-rater count and
 * winner κ gate whether the corpus may be called ground truth. A read failure
 * is reported as blocked, never as healthy.
 */
async function loadHumanSection(): Promise<EvidenceSection> {
  try {
    const service = createServiceClient();
    const [{ data: items }, { data: ratings }] = await Promise.all([
      service.from("corpus_items").select("id, side_mapping, status"),
      service
        .from("corpus_ratings")
        .select("corpus_id, rater_id, winner, confidence, scores_a, scores_b, presented_first, corrections"),
    ]);
    const metrics = computeCorpusMetrics(
      (items ?? []) as MetricItem[],
      (ratings ?? []) as unknown as MetricRating[],
    );
    return assessHumanValidation({
      items: metrics.corpus.items,
      raters: metrics.corpus.raters,
      itemsWithTwoPlusRatings: metrics.corpus.itemsWithTwoPlusRatings,
      consensusReady: metrics.humanValidation.consensusReadyItems,
      unresolvedDisagreements: metrics.humanValidation.unresolvedDisagreements,
      meanWinnerKappa: metrics.humanValidation.meanWinnerKappa,
      canUseAsGroundTruth: metrics.humanValidation.groundTruth.ready,
      adjudicatedItems: metrics.corpus.adjudicatedItems,
      correctedRatings: metrics.corpus.correctedRatings,
      presentationBalance: metrics.corpus.presentation.balance,
    });
  } catch {
    return {
      status: "blocked",
      headline: "human corpus unreadable from this runtime",
      facts: [],
      note: "Could not load corpus_items / corpus_ratings — validation status is unresolved, not green.",
    };
  }
}

/**
 * Training-loop evidence: repairs recorded, eligible retests observed, and
 * whether the primary first-retest recurrence rate is reportable yet. The
 * section reports MEASUREMENT READINESS separately from observed outcomes,
 * which are listed with denominators and never colour-coded.
 */
async function loadTrainingSection(now: string): Promise<TrainingEvidence> {
  try {
    const { events, repairs, debateWeaknesses } = await loadFunnelData();
    const funnel = buildRepairOutcomeFunnel(repairs, debateWeaknesses, events, { now });
    return assessTrainingEvidence({
      repairs: funnel.repairs,
      retestsObserved: funnel.retestsObserved,
      retestsPending: funnel.retestsPending,
      firstRetestRate: funnel.firstRetestRecurrence.rate,
      firstRetestN: funnel.firstRetestRecurrence.denominator,
      firstThreeDenominator: funnel.firstThreeExposure.denominator,
      medianOpportunitiesToRecurrence: funnel.opportunitiesBeforeRecurrence.median,
      censoredRepairs: funnel.timeToFirstRecurrence.censoredRepairs,
    });
  } catch {
    return {
      status: "blocked",
      headline: "training-loop data unreadable from this runtime",
      facts: [],
      note: "Could not load repair/event data — outcome status is unresolved, not green.",
      measurement: "invalid" as const,
      outcomes: [],
    };
  }
}
