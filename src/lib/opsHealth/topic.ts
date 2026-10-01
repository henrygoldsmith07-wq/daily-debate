// Topic pipeline health.
//
// Two questions: is there a topic for today (and tomorrow), and did the
// scheduled generation actually run and produce AI-backed content within its
// SLO? The second is a production scheduler SLO, independent of CI evidence.

import type { CoachingContextDegradationReason } from "../types";
import { addDaysUtc, dayDiffUtc, todayIsoUtc, type HealthState } from "./core";

// --- Topic pipeline --------------------------------------------------------

export interface TopicRowInput {
  topic_date: string;
  title: string;
  generation_source: string | null;
  evidence_cards: number | null;
}

export interface TopicHealth {
  status: HealthState;
  /** Most recent stored topic date (UTC), or null when the table is empty. */
  lastTopicDate: string | null;
  /** Whether tomorrow's topic is already stored. */
  tomorrowReady: boolean;
  origin: "ai" | "fallback" | "unknown" | null;
  evidenceCards: number | null;
  /** Days since the latest stored topic (null when empty). */
  ageDays: number | null;
  note: string | null;
}

export function assessTopicHealth(latest: TopicRowInput | null, nowIso: string): TopicHealth {
  const today = todayIsoUtc(nowIso);
  const tomorrow = addDaysUtc(today, 1);
  if (!latest) {
    return {
      status: "blocked",
      lastTopicDate: null,
      tomorrowReady: false,
      origin: null,
      evidenceCards: null,
      ageDays: null,
      note: "daily_topics holds no rows — the pipeline has never stored a topic here.",
    };
  }
  const origin = latest.generation_source === "ai" || latest.generation_source === "fallback"
    ? latest.generation_source
    : "unknown";
  if (latest.topic_date >= tomorrow) {
    return {
      status: "healthy",
      lastTopicDate: latest.topic_date,
      tomorrowReady: true,
      origin,
      evidenceCards: latest.evidence_cards,
      ageDays: 0,
      note: origin === "unknown" ? "Tomorrow's topic is stored but its provenance was not recorded." : null,
    };
  }
  if (latest.topic_date === today) {
    return {
      status: "degraded",
      lastTopicDate: latest.topic_date,
      tomorrowReady: false,
      origin,
      evidenceCards: latest.evidence_cards,
      ageDays: 0,
      note: "Today's topic is present but tomorrow's is not yet stored — tonight's run must succeed.",
    };
  }
  const ageDays = dayDiffUtc(today, latest.topic_date);
  if (ageDays <= 3) {
    return {
      status: "stale",
      lastTopicDate: latest.topic_date,
      tomorrowReady: false,
      origin,
      evidenceCards: latest.evidence_cards,
      ageDays,
      note: `Latest stored topic is ${ageDays} day${ageDays === 1 ? "" : "s"} old — dashboard visitors are on curated fallbacks.`,
    };
  }
  return {
    status: "failed",
    lastTopicDate: latest.topic_date,
    tomorrowReady: false,
    origin,
    evidenceCards: latest.evidence_cards,
    ageDays,
    note: `No topic stored for ${ageDays} days — the generation pipeline is broken, not just late.`,
  };
}

// --- Topic production SLO ---------------------------------------------------
//
// Two INDEPENDENT dimensions answer two different questions (item 9):
//   Scheduler reliability    - did the job run, and did it run cleanly?
//   Topic availability       - is tomorrow's valid topic actually there?
// Overall status is the deterministic worst of the two. The 03:00 UTC
// deadline is ENFORCED, not documentation: before it, absence is
// pending-before-deadline; after it, absence is a missed-deadline breach.
// CI evidence never counts: availability reads the production store and
// scheduler reads the real workflow run history.

export const TOPIC_SLO_DEADLINE_UTC = "03:00";
export const TOPIC_SLO_STALL_HOURS = 36;

export type SchedulerState = "healthy" | "degraded" | "stale" | "failed" | "unknown";
export type AvailabilityState = "ready" | "pending-before-deadline" | "missed-deadline" | "invalid" | "unknown";

const SCHEDULER_SEVERITY: Record<SchedulerState, number> = { healthy: 0, degraded: 2, stale: 3, failed: 5, unknown: 1 };
const AVAILABILITY_SEVERITY: Record<AvailabilityState, number> = {
  ready: 0,
  "pending-before-deadline": 0,
  unknown: 1,
  "missed-deadline": 5,
  invalid: 5,
};

export interface TopicScheduledRun {
  id?: number; // Actions run id — key for exact artifact-witness lookup
  event: string; // "schedule" | "workflow_dispatch" | "push"...
  status: string; // "completed" | "in_progress" | "queued"...
  conclusion: string | null; // success | failure | cancelled | ...
  createdAt: string;
}

/**
 * Exact scheduler-witness facts from a run's OWN uploaded artifact
 * (topic-run-evidence.json): the true triggering cron slot plus its exact
 * delay — the second witness when topic_run_log is unreachable, and the ONLY
 * acceptable non-DB source. Nearest-slot inference below is the last resort.
 */
export interface TopicArtifactWitness {
  cronSlot: string | null;
  scheduledFor: string | null;
  actualCreatedAt: string | null;
  actualStartedAt: string | null;
  schedulerDelayMs: number | null;
}

/** Validate a downloaded artifact's exact-slot fields; null when unusable. */
export function parseArtifactWitness(parsed: Record<string, unknown>): TopicArtifactWitness | null {
  const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const witness: TopicArtifactWitness = {
    cronSlot: str(parsed.cronSlot),
    scheduledFor: str(parsed.scheduledFor),
    actualCreatedAt: str(parsed.actualCreatedAt),
    actualStartedAt: str(parsed.actualStartedAt),
    schedulerDelayMs: num(parsed.schedulerDelayMs),
  };
  // Usable as exact evidence only when it can pin the true slot + a delay.
  return witness.scheduledFor && (witness.schedulerDelayMs !== null || witness.actualStartedAt !== null)
    ? witness
    : null;
}

/** One bounded provider/model attempt as persisted in topic_run_log.provider_attempts. */
export interface TopicProviderAttemptRow {
  provider: string | null;
  model: string;
  outcome: string; // success | invalid-response | timeout | rate-limit | authentication | quota | other
  latencyMs: number | null;
  httpStatus: number | null;
  errorCategory: string | null;
}

export interface TopicRunTelemetryRow {
  event: string; // "schedule" | "workflow_dispatch" | ...
  at: string; // runStartedAt ISO (distinct from runCreatedAt)
  runCreatedAt?: string | null; // Actions API run creation time (queue-delay input)
  completedAt?: string | null; // wall-clock completion time
  result: string; // "success" | "failure" | ...
  delayMs: number | null; // schedulerDelay = runStartedAt - scheduledFor (schedule rows)
  queueDelayMs?: number | null; // queueDelay = runStartedAt - runCreatedAt
  targetDate: string | null; // ISO date the run generated for
  completedBeforeDeadline: boolean | null; // availability S1 held for that run
  freshnessOk?: boolean | null; // post-write verifier verdict for this run
  providerHealth?: string | null; // success | invalid-response | timeout | rate-limit | authentication | quota | other
  generatorResult?: string | null; // ai | fallback-after-provider-failure | fallback-by-policy | failure
  topicFingerprint?: string | null; // canonical content identity for idempotence proofs
  providerAttempts?: TopicProviderAttemptRow[] | null; // bounded per-model ledger
}

/** Evidence that a real AI-generated topic survived production end to end. */
export interface AiProductionEvidence {
  targetDate: string | null;
  aiRowPresent: boolean;
  sourcesNonEmpty: boolean;
  /** The stored row's topic_fingerprint (null when absent/unreadable). */
  rowFingerprint: string | null;
  /**
   * ONE telemetry row satisfies the WHOLE predicate at once:
   *   result = success ∧ targetDate matches ∧ topicFingerprint equals this
   *   EXACT row ∧ generatorResult = ai ∧ freshnessOk = true.
   * Not two independent `some()` checks — those could be satisfied by two
   * different rows (an AI row plus a fallback row's fingerprint match).
   */
  exactVerifiedAiTelemetry: boolean;
}

/**
 * Pure single-predicate matcher for the AI proof: does ONE telemetry row
 * carry every required fact for this stored row? Exported so the truth table
 * (item: AI+fp+fresh+success true; every mixed case false) is unit-testable,
 * not just the server-side loader that assembles evidence.
 */
export function matchesExactAiTelemetry(
  telemetry: TopicRunTelemetryRow[],
  row: { targetDate: string | null; rowFingerprint: string | null },
): boolean {
  if (!row.targetDate || !row.rowFingerprint) return false;
  return telemetry.some(
    (t) =>
      t.result === "success" &&
      t.targetDate === row.targetDate &&
      t.topicFingerprint === row.rowFingerprint &&
      t.generatorResult === "ai" &&
      t.freshnessOk === true,
  );
}

export const TOPIC_MISSED_START_THRESHOLD_MS = 90 * 60_000;

/**
 * Canonical topic-generation cron slots in UTC (mirror of
 * .github/workflows/topic-generation.yml — update both together). Used by the
 * second-witness delay derivation below; the workflow itself records the
 * exact slot via github.event.schedule into topic_run_log, which stays the
 * PRIMARY source. This mirror only fills gaps when the DB is unreachable.
 */
export const TOPIC_LADDER_SLOTS_UTC_MINUTES = [20 * 60, 21 * 60 + 30, 22 * 60 + 45, 23 * 60 + 40, 15, 2 * 60 + 15];

/**
 * Most recent ladder slot (UTC, wrapping midnight) strictly <= nowMs.
 * Mirrors scheduledForCron in scripts/record-topic-run.mjs for the fixed
 * daily-slot ladder; a shared module was rejected to keep the Next runtime
 * free of cross-imports from scripts/.
 */
export function mostRecentTopicSlot(nowMs: number): number | null {
  const d = new Date(nowMs);
  for (const offsetDays of [0, 1, 2]) {
    const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const candidates = TOPIC_LADDER_SLOTS_UTC_MINUTES.map((m) => dayStart - offsetDays * 86_400_000 + m * 60_000);
    const best = Math.max(...candidates.filter((t) => t <= nowMs));
    if (candidates.some((t) => t <= nowMs)) return best;
  }
  return null;
}

/**
 * SECOND-WITNESS scheduler-delay telemetry, derived from GitHub run history
 * alone. The primary source is topic_run_log (recorded by the run itself,
 * with the exact cron slot). But that telemetry lives in the same database
 * the pipeline needs: when the DB is down — precisely when you want to know
 * whether the platform or the store failed — the delay log disappears with
 * it. This derivation reconstructs approximate delays from run_created_at
 * vs the most recent ladder slot so the scheduler-delay view keeps working.
 *
 * Approximate by design: the actual slot a run belonged to is inferred
 * (created_at vs started_at also differ slightly). Only schedule runs are
 * witnessed; targetDate stays null so these rows can never contribute to
 * the availability proofs — those remain DB-backed.
 */
export function deriveDelayWitness(
  runs: TopicScheduledRun[],
  exactByRunId?: Map<number, TopicArtifactWitness>,
): TopicRunTelemetryRow[] {
  const out: TopicRunTelemetryRow[] = [];
  for (const r of runs) {
    if (r.event !== "schedule") continue;
    const at = Date.parse(r.createdAt);
    if (!Number.isFinite(at)) continue;

    // EXACT artifact evidence FIRST: the run's uploaded artifact carries the
    // true triggering slot (github.event.schedule) and its exact delay.
    // Inferring "nearest slot before createdAt" here would UNDERSTATE large
    // delays — a 20:00 trigger whose run was created at 22:05 is a 125-min
    // missed start, not a 35-min one against the 21:30 slot. Approximate
    // inference is used ONLY when no exact artifact exists for this run.
    const exact = r.id !== undefined ? exactByRunId?.get(r.id) : undefined;
    if (exact?.scheduledFor && Number.isFinite(Date.parse(exact.scheduledFor))) {
      const startedMs = Date.parse(exact.actualStartedAt ?? "");
      const delayMs =
        typeof exact.schedulerDelayMs === "number" && Number.isFinite(exact.schedulerDelayMs)
          ? exact.schedulerDelayMs
          : at - Date.parse(exact.scheduledFor); // exact slot; start approximated by creation
      out.push({
        event: "schedule",
        at: Number.isFinite(startedMs) ? (exact.actualStartedAt as string) : r.createdAt,
        runCreatedAt: exact.actualCreatedAt ?? null,
        result: r.status === "completed" ? r.conclusion ?? "unknown" : r.status,
        delayMs,
        targetDate: null,
        completedBeforeDeadline: null,
      });
      continue;
    }

    const slot = mostRecentTopicSlot(at);
    if (slot === null) continue;
    out.push({
      event: "schedule",
      at: r.createdAt,
      result: r.status === "completed" ? r.conclusion ?? "unknown" : r.status,
      delayMs: at - slot,
      targetDate: null,
      completedBeforeDeadline: null,
    });
  }
  return out;
}

/**
 * Merge DB-recorded telemetry (primary) with derived witness rows: a DB row
 * within ±5 minutes of a witness covers it (same run recorded precisely),
 * so nothing is double-counted; witness rows only fill real gaps.
 */
export function mergeDelayWitnesses(dbRows: TopicRunTelemetryRow[], witnesses: TopicRunTelemetryRow[]): TopicRunTelemetryRow[] {
  const covered = (w: TopicRunTelemetryRow) =>
    dbRows.some((d) => {
      const a = Date.parse(d.at);
      const b = Date.parse(w.at);
      return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 5 * 60_000;
    });
  return [...dbRows, ...witnesses.filter((w) => !covered(w))];
}

export interface TopicSloInput {
  runs: TopicScheduledRun[];
  /** Can this runtime read the production topic store at all? */
  productionDbReadable: boolean;
  /** Does the production store hold tomorrow's (or later) topic? */
  tomorrowReady: boolean;
  /**
   * Did the most recent run's post-write freshness verification pass?
   * null/undefined = unknown (older runs pre-verifier, or fetch failure).
   */
  latestRunVerified?: boolean | null;
  /** Persisted per-run telemetry (topic_run_log); newest first or any order. */
  telemetry?: TopicRunTelemetryRow[];
  /**
   * Real-AI end-to-end evidence for the aiGeneratedProductionSuccess proof:
   * an AI row with surviving non-empty sources plus ONE telemetry row that
   * satisfies the entire exact-fingerprint predicate. null/undefined =
   * unevidenced (proof stays false).
   */
  aiEvidence?: AiProductionEvidence | null;
  /**
   * Durable proof facts computed from topic_run_log directly (an aggregate
   * over the WHOLE table, not a GitHub API page). null/undefined = telemetry
   * unreadable → fall back to the workflow-run window.
   */
  durableProofs?: DurableProofFacts | null;
}

/** manual→scheduled existence proofs read from durable telemetry. */
export interface DurableProofFacts {
  manualSuccess: boolean;
  scheduledSuccessAfterManual: boolean;
}

export interface TopicSlo {
  scheduler: {
    state: SchedulerState;
    consecutiveScheduledFailures: number;
    lastScheduledRunAt: string | null;
    lastScheduledRunConclusion: string | null;
  };
  availability: {
    state: AvailabilityState;
    deadlineUtc: string;
    note: string | null;
  };
  /**
   * Platform-scheduling health, deliberately SEPARATE from both dimensions:
   * GitHub cron can start a run hours late without any app being wrong, and
   * that must not read as generator failure (or hide as success).
   */
  scheduling: {
    latestDelayMs: number | null;
    medianDelayMs: number | null;
    p95DelayMs: number | null;
    missedStarts: number;
    thresholdMs: number;
    note: string | null;
  };
  /** Deterministic overall: worst of scheduler + availability. */
  status: HealthState;
  lastSuccessfulRun: { at: string; event: string } | null;
  /**
   * Production proofs: six independent facts. Idempotence requires matching
   * content fingerprints from separate verified attempts — never merely two
   * successes — and the AI proof requires a real AI topic surviving
   * end to end, never a fallback standing in for it.
   */
  proofs: {
    databaseReachable: boolean;
    manualSuccess: boolean;
    scheduledSuccessAfterManual: boolean;
    sameDateContentIdempotence: boolean;
    onTimeBeforeDeadline: boolean;
    aiGeneratedProductionSuccess: boolean;
  };
  /**
   * Longitudinal provider/model roll-up over the telemetry window. Ordering
   * stays configured priority (no automatic health-based decisions); these
   * numbers inform humans, with minimum-sample discipline left to the reader
   * via the denominators.
   */
  providerSummary: {
    byModel: ProviderModelSummary[];
    fallbackTriggerRate: number | null;
    windowRuns: number;
  } | null;
  note: string | null;
}

export interface ProviderModelSummary {
  provider: string | null;
  model: string;
  attempts: number;
  successRate: number | null;
  invalidResponses: number;
  timeouts: number;
  rateLimits: number;
  authFailures: number;
  quotaFailures: number;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
}

/**
 * Aggregate bounded per-attempt rows longitudinally by provider/model.
 * Pure over telemetry rows so dashboards, ops health and tests share it.
 */
export function summariseProviderAttempts(rows: TopicRunTelemetryRow[]): {
  byModel: ProviderModelSummary[];
  fallbackTriggerRate: number | null;
  windowRuns: number;
} {
  const attempts: TopicProviderAttemptRow[] = [];
  for (const row of rows) {
    if (Array.isArray(row.providerAttempts)) attempts.push(...row.providerAttempts);
  }
  const byKey = new Map<string, { provider: string | null; model: string; rows: TopicProviderAttemptRow[] }>();
  for (const a of attempts) {
    const key = `${a.provider ?? "unknown"}|${a.model}`;
    const bucket = byKey.get(key) ?? { provider: a.provider ?? null, model: a.model, rows: [] };
    bucket.rows.push(a);
    byKey.set(key, bucket);
  }
  const byModel = [...byKey.values()].map(({ provider, model, rows: rs }) => {
    const latencies = rs
      .map((r) => r.latencyMs)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
      .sort((x, y) => x - y);
    const ok = rs.filter((r) => r.outcome === "success").length;
    return {
      provider,
      model,
      attempts: rs.length,
      successRate: rs.length ? Math.round((ok / rs.length) * 1000) / 1000 : null,
      invalidResponses: rs.filter((r) => r.outcome === "invalid-response").length,
      timeouts: rs.filter((r) => r.outcome === "timeout").length,
      rateLimits: rs.filter((r) => r.outcome === "rate-limit").length,
      authFailures: rs.filter((r) => r.outcome === "authentication").length,
      quotaFailures: rs.filter((r) => r.outcome === "quota").length,
      p50LatencyMs: quantile(latencies, 0.5),
      p95LatencyMs: quantile(latencies, 0.95),
    };
  });
  const windowed = rows.filter((r) => (r.providerAttempts?.length ?? 0) > 0);
  const fallbackTriggerRate = windowed.length
    ? Math.round((windowed.filter((r) => r.generatorResult === "fallback-after-provider-failure").length / windowed.length) * 1000) / 1000
    : null;
  return { byModel, fallbackTriggerRate, windowRuns: windowed.length };
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[idx];
}

function assessScheduling(telemetry: TopicRunTelemetryRow[]): TopicSlo["scheduling"] {
  const delays = telemetry
    .filter((r) => r.event === "schedule" && typeof r.delayMs === "number" && Number.isFinite(r.delayMs))
    .map((r) => r.delayMs as number);
  const sorted = delays.slice().sort((a, b) => a - b);
  const latest = telemetry
    .filter((r) => r.event === "schedule" && typeof r.delayMs === "number")
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  const missedStarts = sorted.filter((d) => d > TOPIC_MISSED_START_THRESHOLD_MS).length;
  return {
    latestDelayMs: latest?.delayMs ?? null,
    medianDelayMs: quantile(sorted, 0.5),
    p95DelayMs: quantile(sorted, 0.95),
    missedStarts,
    thresholdMs: TOPIC_MISSED_START_THRESHOLD_MS,
    note: sorted.length
      ? `${sorted.length} scheduled runs measured; ${missedStarts} started later than the ${Math.round(TOPIC_MISSED_START_THRESHOLD_MS / 60000)}-min missed-start threshold`
      : null,
  };
}

export function assessTopicSlo(input: TopicSloInput, nowIso: string): TopicSlo {
  const telemetry = input.telemetry ?? [];
  const scheduled = input.runs
    .filter((r) => r.event === "schedule")
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const successBy = (r: TopicScheduledRun) => r.status === "completed" && r.conclusion === "success";
  const newestSuccessFirst = input.runs
    .slice()
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .find(successBy) ?? null;

  // -- scheduler dimension (run history only; content-agnostic) --------------
  let consecutiveScheduledFailures = 0;
  for (const r of scheduled) {
    if (r.status !== "completed") continue;
    if (r.conclusion === "success") break;
    consecutiveScheduledFailures += 1;
  }
  let scheduler: SchedulerState;
  if (!scheduled.length) scheduler = "unknown";
  else if (consecutiveScheduledFailures >= 3) scheduler = "failed";
  else if (consecutiveScheduledFailures >= 1) scheduler = "degraded";
  else if (
    (Date.parse(nowIso) - Date.parse(scheduled[0].createdAt)) / 3_600_000 > TOPIC_SLO_STALL_HOURS &&
    scheduled[0].status !== "in_progress"
  ) scheduler = "stale";
  else scheduler = "healthy";

  // -- availability dimension (production content; deadline-enforced) --------
  const hourUtc = new Date(nowIso).getUTCHours();
  const pastDeadline = hourUtc >= Number(TOPIC_SLO_DEADLINE_UTC.slice(0, 2)); // deadline 03:00 local UTC day
  let availability: AvailabilityState;
  let availabilityNote: string | null = null;
  if (!input.productionDbReadable) {
    availability = "unknown";
    availabilityNote = "Production topic store unreadable from this runtime - availability unverifiable; CI never substitutes.";
  } else if (input.tomorrowReady && input.latestRunVerified === false) {
    availability = "invalid";
    availabilityNote = "Tomorrow's row exists but the latest run's freshness verification failed.";
  } else if (input.tomorrowReady) {
    availability = "ready";
  } else if (pastDeadline) {
    availability = "missed-deadline";
    availabilityNote = `S1 BREACH: tomorrow's topic absent after ${TOPIC_SLO_DEADLINE_UTC} UTC.`;
  } else {
    availability = "pending-before-deadline";
    availabilityNote = `Tomorrow's topic not yet stored; deadline ${TOPIC_SLO_DEADLINE_UTC} UTC has not passed.`;
  }

  // -- deterministic overall --------------------------------------------------
  const SEVERITY_STATES: HealthState[] = ["healthy", "unknown", "degraded", "stale", "blocked", "failed"];
  const sev = Math.max(SCHEDULER_SEVERITY[scheduler], AVAILABILITY_SEVERITY[availability]);
  const status: HealthState = SEVERITY_STATES[sev] ?? "unknown";

  // An existence proof, not a "latest manual run" proof: #45 manual → #52
  // scheduled → #53 manual still proves a scheduled run followed a manual
  // one. The newest-manual formulation erased that historical fact.
  const successfulManuals = input.runs
    .filter((r) => r.event === "workflow_dispatch" && successBy(r))
    .map((r) => Date.parse(r.createdAt))
    .filter(Number.isFinite);
  const ghScheduledAfterManual = successfulManuals.some((manualAt) =>
    scheduled.some((r) => successBy(r) && Date.parse(r.createdAt) > manualAt),
  );
  // Durable-first (item: proofs must not live inside an eight-run GitHub API
  // window). topic_run_log is queried over its WHOLE table by the server
  // loader; when that aggregate is available it is authoritative — old runs
  // falling outside a Actions page cannot erase a proven historical fact,
  // and a readable DB that says "no qualifying pair" is not overruled by a
  // coincidental GitHub window. durableProofs = null → GitHub fallback.
  const durable = input.durableProofs ?? null;
  const manualSuccess = durable ? durable.manualSuccess : successfulManuals.length > 0;
  const scheduledSuccessAfterManual = durable ? durable.scheduledSuccessAfterManual : ghScheduledAfterManual;

  // -- production proofs: six independent facts, no telemetry coincidences --
  // Content idempotence = same target date, same non-null SHA-256 content
  // fingerprint, both attempts successful AND freshness-verified. NOTHING
  // else: coupling identity to generatorResult produced false negatives
  // ("generated" vs "verified" is an operational fact, not a content fact).
  const verifiedSuccesses = telemetry.filter(
    (r) => r.result === "success" && r.targetDate && r.freshnessOk === true && r.topicFingerprint,
  );
  const sameDateContentIdempotence = verifiedSuccesses.some((r1) =>
    verifiedSuccesses.some(
      (r2) =>
        r1 !== r2 &&
        r1.targetDate === r2.targetDate &&
        r1.topicFingerprint === r2.topicFingerprint,
    ),
  );
  const tomorrowIso = addDaysUtc(todayIsoUtc(nowIso), 1);
  // On-time needs VERIFIED content completed before the actual deadline.
  const onTimeBeforeDeadline =
    input.tomorrowReady &&
    telemetry.some(
      (r) => r.targetDate === tomorrowIso && r.completedBeforeDeadline === true && r.freshnessOk === true,
    );
  const aiEvidence = input.aiEvidence ?? null;
  // AI proof requires END-TO-END identity through ONE telemetry row: an AI
  // row with non-empty sources whose EXACT fingerprint that single row also
  // reports as ai-generated, successful and freshness-verified. Two separate
  // `some()` checks could be satisfied by DIFFERENT rows (an AI row plus a
  // fallback run's fingerprint match) — the single predicate closes that.
  const aiGeneratedProductionSuccess =
    aiEvidence?.aiRowPresent === true &&
    aiEvidence?.sourcesNonEmpty === true &&
    aiEvidence?.rowFingerprint != null &&
    aiEvidence?.exactVerifiedAiTelemetry === true;

  const scheduling = assessScheduling(telemetry);
  const providerSummary = summariseProviderAttempts(telemetry);

  const notes = [availabilityNote, schedulerNote(scheduler, consecutiveScheduledFailures, scheduled, nowIso)].filter(Boolean);
  return {
    scheduler: {
      state: scheduler,
      consecutiveScheduledFailures,
      lastScheduledRunAt: scheduled[0]?.createdAt ?? null,
      lastScheduledRunConclusion: scheduled[0] ? (scheduled[0].status === "completed" ? scheduled[0].conclusion ?? null : "running") : null,
    },
    availability: { state: availability, deadlineUtc: TOPIC_SLO_DEADLINE_UTC, note: availabilityNote },
    scheduling,
    status,
    lastSuccessfulRun: newestSuccessFirst ? { at: newestSuccessFirst.createdAt, event: newestSuccessFirst.event } : null,
    proofs: {
      databaseReachable: input.productionDbReadable,
      manualSuccess,
      scheduledSuccessAfterManual,
      sameDateContentIdempotence,
      onTimeBeforeDeadline,
      aiGeneratedProductionSuccess,
    },
    providerSummary,
    note: notes.length ? notes.join(" ") : null,
  };
}

function schedulerNote(state: SchedulerState, failures: number, scheduled: TopicScheduledRun[], nowIso: string): string | null {
  if (state === "unknown") return "No scheduled topic-generation runs on record - the production scheduler has never executed.";
  if (state === "failed") return `${failures} consecutive scheduled failures.`;
  if (state === "degraded") return `${failures} consecutive scheduled failure(s).`;
  if (state === "stale") return `Last scheduled run is ${Math.round((Date.parse(nowIso) - Date.parse(scheduled[0].createdAt)) / 3_600_000)}h old - the scheduler is not firing.`;
  return null;
}
