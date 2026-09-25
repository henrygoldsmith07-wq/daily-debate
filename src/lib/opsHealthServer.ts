import "server-only";
import fs from "node:fs";
import path from "node:path";
import { createServiceClient } from "./backend/server";
import type { TableName } from "./backend/query";
import {
  assessAppHealth,
  assessMigrationReadiness,
  assessDatabaseHealth,
  assessHumanValidation,
  assessJudgeHealth,
  assessTopicHealth,
  assessTopicSlo,
  assessTrainingEvidence,
  buildOpsHealthReport,
  MIGRATION_REQUIRED_COLUMNS,
  type AiProductionEvidence,
  type DurableProofFacts,
  deriveDelayWitness,
  mergeDelayWitnesses,
  matchesExactAiTelemetry,
  parseArtifactWitness,
  type EvidenceSection,
  type OpsHealthReport,
  type TopicArtifactWitness,
  type TopicRunTelemetryRow,
  type TopicScheduledRun,
  type TrainingEvidence,
  type WorkflowStatusInput,
} from "./opsHealth";
import { findZipEntry } from "./zipEntry";
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
      workflow_runs?: Array<{ id?: number; event?: string; status?: string; conclusion?: string | null; created_at?: string }>;
    };
    return (data.workflow_runs ?? [])
      .filter((r) => r.created_at)
      .map((r) => ({
        id: r.id,
        event: r.event ?? "unknown",
        status: r.status ?? "unknown",
        conclusion: r.conclusion ?? null,
        createdAt: r.created_at as string,
      }));
  } catch {
    return null;
  }
}

/**
 * Exact scheduler-witness artifacts (item: never infer a slot when exact
 * evidence exists). For a bounded number of recent topic-generation runs,
 * download the run's own uploaded `topic-run-evidence-{id}` artifact and
 * read its cronSlot / scheduledFor / actual start / schedulerDelayMs (parsing
 * lives in the pure parseArtifactWitness in opsHealth.ts). The map feeds
 * deriveDelayWitness, which prefers these over nearest-slot inference.
 * Token optional; failures degrade to an empty map (inference then remains
 * as the FINAL fallback, never the other way round).
 */
async function fetchArtifactWitnesses(
  token: string | undefined,
  runs: TopicScheduledRun[],
): Promise<Map<number, TopicArtifactWitness>> {
  const out = new Map<number, TopicArtifactWitness>();
  if (!token) return out;
  const headers = { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}` };
  for (const run of runs) {
    if (run.id === undefined || out.size >= 4) continue; // bounded: recent runs only
    try {
      const listRes = await fetch(`https://api.github.com/repos/${REPO}/actions/runs/${run.id}/artifacts`, {
        headers,
        signal: AbortSignal.timeout(8000),
      });
      if (!listRes.ok) continue;
      const list = (await listRes.json()) as {
        artifacts?: Array<{ id: number; name: string; expired?: boolean; archive_url: string }>;
      };
      const artifact = (list.artifacts ?? []).find(
        (a) => a.name === `topic-run-evidence-${run.id}` && !a.expired,
      );
      if (!artifact) continue;
      const zipRes = await fetch(artifact.archive_url, { headers, signal: AbortSignal.timeout(10_000) });
      if (!zipRes.ok) continue;
      const bytes = Buffer.from(await zipRes.arrayBuffer());
      const jsonBytes = findZipEntry(bytes, "topic-run-evidence.json");
      if (!jsonBytes) continue;
      const parsed = JSON.parse(jsonBytes.toString("utf8")) as Record<string, unknown>;
      const witness = parseArtifactWitness(parsed);
      if (witness) out.set(run.id, witness);
    } catch {
      // artifact unavailable for this run — inference stays as final fallback
    }
  }
  return out;
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
      // Column-agnostic existence probe: tables like topic_run_log have a
      // composite PK (run_id, run_attempt) and no `id` column, so selecting
      // `id` misreports a migrated database as schema-incomplete.
      const probed = await service.from(table).select("*", { count: "exact", head: true });
      if (probed.error) missingTables.push(table);
    }
    database = assessDatabaseHealth({
      reachable: true,
      latencyMs,
      migrationsApplied: applied.length,
      missingTables,
      topicRunLogFidelity: await probeTopicRunLogFidelity(),
      migrationReadiness: assessMigrationReadiness(await probeMigrationColumns()),
    });
  } catch {
    database = assessDatabaseHealth({ reachable: false });
  }

  // --- Topic pipeline: latest rows, provenance, evidence -------------------
  let topic;
  let topicStoreReadable = true;
  let topicReadSqlstate: string | null = null;
  let topicReadShapeMatrix: string | null = null;
  // Bounded read-only retry: the original read sits behind a rapid burst of
  // ~10 schema/table probes, and production evidence (failure matrix all-ok
  // inside the same request) points at a transient burst-limit blip on the
  // Neon HTTP transport rather than a query defect. Retry the READ with a
  // short backoff — never the write path.
  // Stage marker: which statement threw (read | cards | assess)? The shape
  // matrix proved every QUERY succeeds inside the failing request, so the
  // thrower is somewhere between the reads and the assessment.
  let failedStage = "read";
  let rowDateKind: string | null = null;
  try {
    const runTopicRead = () =>
      service
        .from("daily_topics")
        .select("id, topic_date, title, generation_source, created_at")
        .order("topic_date", { ascending: false })
        .limit(5);
    let last: { message?: string; code?: string } | null = null;
    let rows: Awaited<ReturnType<typeof runTopicRead>> | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, attempt === 1 ? 200 : 500));
      const attemptResult = await runTopicRead();
      if (!attemptResult.error) {
        rows = attemptResult;
        break;
      }
      last = attemptResult.error;
    }
    if (!rows) {
      // Every attempt returned a builder error: preserve the code (usually
      // the SQLSTATE) on the rethrow — a bare Error drops it, which blinded
      // the SQLSTATE diagnostic on the public probe.
      const err = new Error(last?.message ?? "daily_topics unreadable");
      if (last?.code) (err as { code?: string }).code = last.code;
      throw err;
    }
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
      // Public-safe type diagnostics: JS kind of the row values (never the
      // values themselves) — date columns can arrive as JS Date objects
      // depending on transport type-parsing, which poisons string compares.
      rowDateKind = typeof latest.topic_date;
      // ROOT-CAUSE FIX: topic_date can arrive as a JS Date (transport
      // type-parsing), but assessTopicHealth's comparisons and day-diff
      // arithmetic require 'YYYY-MM-DD' strings. Normalise at the boundary.
      const toDate = (v: unknown): string =>
        v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
      const latestDate = toDate(latest.topic_date);
      failedStage = "cards";
      const cards = await service
        .from("topic_evidence")
        .select("id", { count: "exact", head: true })
        .eq("topic_id", latest.id);
      failedStage = "assess";
      topic = assessTopicHealth(
        {
          topic_date: latestDate,
          title: latest.title,
          generation_source: latest.generation_source,
          evidence_cards: typeof cards.count === "number" ? cards.count : null,
        },
        now,
      );
    }
  } catch (error) {
    // This catch previously DISCARDED the failure reason: a persistent
    // daily_topics read failure surfaced only as proofs.databaseReachable
    // = false with no diagnostic anywhere. Postgres error messages contain
    // no secrets (no connection strings), so recording the message is safe
    // and turns a silent degradation into a nameable, fixable defect.
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[ops-health] topic store read failed at stage", failedStage, "dateKind", rowDateKind, ":", reason);
    const { sqlstateClass } = await import("./backend/sql");
    topicReadSqlstate = sqlstateClass(error);
    // Failure-shape matrix (read-only, failure path only): which minimal
    // read shapes survive? Discriminates projection vs ordering vs row-level
    // vs filter-level failures. Reports labels + SQLSTATE classes only —
    // never row data or messages.
    const probeShape = async (
      label: string,
      q: PromiseLike<{ error: { code?: string } | null }>,
    ): Promise<string> => {
      try {
        const r = await q;
        return r.error ? `${label}:${r.error.code?.slice(0, 2) ?? "fail"}` : `${label}:ok`;
      } catch (e) {
        return `${label}:${sqlstateClass(e) ?? "fail"}`;
      }
    };
    const shapes = await Promise.all([
      probeShape("plain", service.from("daily_topics").select("id").limit(1)),
      probeShape("star", service.from("daily_topics").select("*").limit(1)),
      probeShape("ordered", service.from("daily_topics").select("id").order("topic_date", { ascending: false }).limit(1)),
      probeShape("eqfilter", service.from("topic_evidence").select("id", { count: "exact", head: true }).eq("topic_id", "00000000-0000-0000-0000-000000000000").limit(1)),
      // The EXACT original query: if it succeeds here (after the DB burst
      // has drained) while failing above, the cause is a transient burst-
      // limit/cold-compute blip, not the query itself.
      probeShape(
        "orig",
        service
          .from("daily_topics")
          .select("id, topic_date, title, generation_source, created_at")
          .order("topic_date", { ascending: false })
          .limit(5),
      ),
    ]);
    console.error("[ops-health] topic read shape matrix:", shapes.join(" "));
    // Stage/kind prefix LAST so it cannot be clobbered by this assignment.
    topicReadShapeMatrix = `stage=${failedStage}${rowDateKind ? ` dateKind=${rowDateKind}` : ""}; ${shapes.join(" ")}`;
    topicStoreReadable = false;
    topic = {
      ...assessTopicHealth(null, now),
      status: "blocked" as const,
      note: `Topic store unreadable — database or permissions failure, not just staleness. (${reason})`,
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
  const dbTelemetry = await loadTopicRunTelemetry();
  // Durable proofs come from topic_run_log over its WHOLE table — an old
  // manual run must not fall outside an eight-run GitHub page and erase the
  // manual→scheduled fact. GitHub history stays the fallback when the DB
  // aggregate is unreadable (and for current scheduler state/failures).
  const durableProofs = await loadDurableProofFacts();
  // Second witness: when topic_run_log is unreachable (the DB is down),
  // scheduler-delay telemetry comes from the runs' OWN uploaded artifacts
  // (exact cron slot), with nearest-slot GitHub inference only as the final
  // fallback — so a platform-vs-database question stays answerable during an
  // outage without understating large delays. DB rows stay primary; witness
  // rows only fill gaps (see mergeDelayWitnesses).
  const artifactWitnesses = topicRuns ? await fetchArtifactWitnesses(token, topicRuns) : new Map<number, TopicArtifactWitness>();
  const telemetry = mergeDelayWitnesses(dbTelemetry, deriveDelayWitness(topicRuns ?? [], artifactWitnesses));
  const aiEvidence = topicStoreReadable ? await loadAiProductionEvidence(telemetry) : null;
  const topicSlo = assessTopicSlo(
    {
      runs: topicRuns ?? [],
      productionDbReadable: topicStoreReadable,
      tomorrowReady: topic.tomorrowReady,
      telemetry,
      aiEvidence,
      durableProofs,
    },
    now,
  );

  return buildOpsHealthReport({ generatedAt: now, topic, topicReadSqlstate, topicReadShapeMatrix, topicSlo, judge, database, app, human, training });
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
 * information_schema column listing for every table a required migration
 * touches, keyed by table name. null when the schema is unreadable —
 * readiness then reports unknown instead of guessing.
 */
async function probeMigrationColumns(): Promise<Map<string, Set<string>> | null> {
  try {
    const { queryRows } = await import("./backend/sql");
    const tables = [...new Set(Object.values(MIGRATION_REQUIRED_COLUMNS).flatMap((g) => g.map((t) => t.table)))];
    const rows = await queryRows<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name IN (${tables.map((_, i) => `$${i + 1}`).join(", ")})`,
      tables,
    );
    const map = new Map<string, Set<string>>();
    for (const r of rows) {
      let cols = map.get(r.table_name);
      if (!cols) map.set(r.table_name, (cols = new Set()));
      cols.add(r.column_name);
    }
    // Constraints ride the same map (prefixed) so 019 readiness needs its
    // VALUE constraint present too — the column alone would accept any value.
    const constraints = await queryRows<{ table_name: string; constraint_name: string }>(
      `SELECT table_name, constraint_name FROM information_schema.table_constraints
        WHERE table_schema = 'public' AND constraint_type = 'CHECK'
          AND table_name IN (${tables.map((_, i) => `$${i + 1}`).join(", ")})`,
      tables,
    );
    for (const c of constraints) {
      let cols = map.get(c.table_name);
      if (!cols) map.set(c.table_name, (cols = new Set()));
      cols.add(`constraint:${c.constraint_name}`);
    }
    return map;
  } catch {
    return null;
  }
}

/**
 * Real-AI end-to-end evidence: the newest AI-provenance row with surviving
 * non-empty sources, matched by ONE telemetry row satisfying the entire
 * exact-fingerprint predicate (see matchesExactAiTelemetry). A fallback
 * standing in for AI — or a fingerprint verified by a DIFFERENT run — can
 * never satisfy this.
 */
async function loadAiProductionEvidence(
  telemetry: TopicRunTelemetryRow[],
): Promise<AiProductionEvidence | null> {
  try {
    const service = createServiceClient();
    const rows = await service
      .from("daily_topics")
      .select("topic_date, sources, generation_source, topic_fingerprint")
      .eq("generation_source", "ai")
      .order("topic_date", { ascending: false })
      .limit(5);
    if (rows.error) return null;
    const list = (rows.data ?? []) as Array<{
      topic_date: string;
      sources: unknown;
      generation_source: string | null;
      topic_fingerprint: string | null;
    }>;
    if (!list.length) {
      return { targetDate: null, aiRowPresent: false, sourcesNonEmpty: false, rowFingerprint: null, exactVerifiedAiTelemetry: false };
    }
    const row = list[0];
    const sources = Array.isArray(row.sources) ? row.sources : [];
    const targetDate = String(row.topic_date).slice(0, 10);
    const rowFingerprint = row.topic_fingerprint ?? null;
    return {
      targetDate,
      aiRowPresent: true,
      sourcesNonEmpty: sources.length > 0,
      rowFingerprint,
      exactVerifiedAiTelemetry: matchesExactAiTelemetry(telemetry, { targetDate, rowFingerprint }),
    };
  } catch {
    return null;
  }
}

/**
 * Durable production-proof facts (item: proofs must not live inside a
 * GitHub API page): one aggregate over the WHOLE topic_run_log.
 *
 *   manualSuccess = exists workflow_dispatch ∧ result=success ∧ freshnessOk
 *   scheduledSuccessAfterManual = exists such a manual M AND such a
 *     scheduled S with S.started_at > M.started_at
 *
 * null when the table/columns are unreadable (pre-014 schema or DB down) —
 * assessTopicSlo then falls back to the GitHub run window, never to a guess.
 */
async function loadDurableProofFacts(): Promise<DurableProofFacts | null> {
  try {
    const { queryRows } = await import("./backend/sql");
    const rows = await queryRows<{ manual_success: boolean; scheduled_after_manual: boolean }>(
      `SELECT
         EXISTS (
           SELECT 1 FROM topic_run_log
            WHERE event = 'workflow_dispatch' AND result = 'success' AND freshness_ok IS TRUE
         ) AS manual_success,
         EXISTS (
           SELECT 1 FROM topic_run_log m
            WHERE m.event = 'workflow_dispatch' AND m.result = 'success' AND m.freshness_ok IS TRUE
              AND EXISTS (
                SELECT 1 FROM topic_run_log s
                 WHERE s.event = 'schedule' AND s.result = 'success' AND s.freshness_ok IS TRUE
                   AND s.started_at > m.started_at
              )
         ) AS scheduled_after_manual`,
    );
    if (!rows.length) return null;
    return {
      manualSuccess: rows[0].manual_success === true,
      scheduledSuccessAfterManual: rows[0].scheduled_after_manual === true,
    };
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
