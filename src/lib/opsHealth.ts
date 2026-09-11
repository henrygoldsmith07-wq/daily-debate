// Operational health — explicit states for critical background systems.
//
// Every section reports one of: healthy / degraded / blocked / stale /
// failed (plus "unknown" only where the data source is unreachable from the
// runtime, e.g. CI status without a GitHub token). Missing or stale
// validation is NEVER represented as green: unknown inputs produce unknown,
// never healthy. Pure assessment functions live here (unit-tested); I/O
// lives in opsHealthServer.ts and the admin API route.

export type HealthState = "healthy" | "degraded" | "blocked" | "stale" | "failed" | "unknown";

/** Severity order for the overall rollup (unknown never rolls up). */
const SEVERITY: Record<Exclude<HealthState, "unknown">, number> = {
  healthy: 0,
  degraded: 1,
  stale: 2,
  blocked: 3,
  failed: 4,
};

export function rollupOverall(states: HealthState[]): Exclude<HealthState, "unknown"> {
  let worst: Exclude<HealthState, "unknown"> = "healthy";
  for (const s of states) {
    if (s === "unknown") continue;
    if (SEVERITY[s] > SEVERITY[worst]) worst = s;
  }
  return worst;
}

function dayDiffUtc(laterIso: string, earlierIso: string): number {
  return Math.floor(
    (Date.parse(`${laterIso.slice(0, 10)}T00:00:00Z`) - Date.parse(`${earlierIso.slice(0, 10)}T00:00:00Z`)) / 86_400_000,
  );
}

export function todayIsoUtc(nowIso: string): string {
  return new Date(nowIso).toISOString().slice(0, 10);
}

function addDaysUtc(dayIso: string, days: number): string {
  const d = new Date(`${dayIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

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

// --- Judge validation -------------------------------------------------------

export interface JudgeArtifactInput {
  at: string;
  limit: number | null;
  allPass: boolean | null;
  models: string[];
  stale?: unknown;
}

export interface JudgeHealth {
  status: HealthState;
  lastRunAt: string | null;
  fixtures: number | null;
  fullPack: boolean | null;
  models: string[];
  allPass: boolean | null;
  ageDays: number | null;
  note: string | null;
}

export const JUDGE_FRESH_DAYS = 14;
export const JUDGE_STALE_DAYS = 30;
export const JUDGE_FULL_PACK = 24;

export function assessJudgeHealth(artifact: JudgeArtifactInput | null, nowIso: string): JudgeHealth {
  if (!artifact) {
    return {
      status: "blocked",
      lastRunAt: null,
      fixtures: null,
      fullPack: null,
      models: [],
      allPass: null,
      ageDays: null,
      note: "No live benchmark artifact on record — judge validation has never completed here.",
    };
  }
  const ageDays = Math.max(
    0,
    Math.floor((Date.parse(nowIso) - Date.parse(artifact.at)) / 86_400_000),
  );
  const fullPack = artifact.limit !== null && artifact.limit >= JUDGE_FULL_PACK;
  const base = {
    lastRunAt: artifact.at,
    fixtures: artifact.limit,
    fullPack,
    models: artifact.models,
    allPass: artifact.allPass,
    ageDays,
  };
  if (artifact.allPass === false) {
    return { ...base, status: "failed", note: "The last live run FAILED its gates — the failure is preserved, not hidden." };
  }
  if (ageDays > JUDGE_STALE_DAYS) {
    return { ...base, status: "stale", note: `Last live validation is ${ageDays} days old — treat judge claims as expired.` };
  }
  if (ageDays > JUDGE_FRESH_DAYS) {
    return { ...base, status: "degraded", note: `Last live validation is ${ageDays} days old — refresh due within ${JUDGE_STALE_DAYS} days.` };
  }
  if (!fullPack) {
    return { ...base, status: "degraded", note: "Last run covered a partial fixture pack — not full validation." };
  }
  return { ...base, status: "healthy", note: null };
}

// --- Database / migrations ---------------------------------------------------

export interface DatabaseHealth {
  status: HealthState;
  reachable: boolean;
  latencyMs: number | null;
  migrationsApplied: number | null;
  requiredTablesOk: boolean | null;
  missingTables: string[];
  note: string | null;
}

export function assessDatabaseHealth(input: {
  reachable: boolean;
  latencyMs?: number | null;
  migrationsApplied?: number | null;
  missingTables?: string[];
}): DatabaseHealth {
  if (!input.reachable) {
    return {
      status: "blocked",
      reachable: false,
      latencyMs: null,
      migrationsApplied: null,
      requiredTablesOk: null,
      missingTables: [],
      note: "Database unreachable — every DB-backed surface is down, not just slow.",
    };
  }
  const missingTables = input.missingTables ?? [];
  if (missingTables.length) {
    return {
      status: "failed",
      reachable: true,
      latencyMs: input.latencyMs ?? null,
      migrationsApplied: input.migrationsApplied ?? null,
      requiredTablesOk: false,
      missingTables,
      note: `Required tables missing (${missingTables.join(", ")}) — run migrations before trusting any stored data.`,
    };
  }
  if ((input.latencyMs ?? 0) > 5000) {
    return {
      status: "degraded",
      reachable: true,
      latencyMs: input.latencyMs ?? null,
      migrationsApplied: input.migrationsApplied ?? null,
      requiredTablesOk: true,
      missingTables: [],
      note: `Database reachable but slow (SELECT 1 took ${input.latencyMs}ms).`,
    };
  }
  return {
    status: "healthy",
    reachable: true,
    latencyMs: input.latencyMs ?? null,
    migrationsApplied: input.migrationsApplied ?? null,
    requiredTablesOk: true,
    missingTables: [],
    note: null,
  };
}

// --- CI / E2E (GitHub Actions; unknown without a token) ----------------------

export interface WorkflowStatusInput {
  name: string;
  status: "completed" | "in_progress" | "queued" | null;
  conclusion: string | null;
}

export interface AppHealth {
  status: HealthState;
  workflows: Array<WorkflowStatusInput & { state: HealthState }>;
  ciUrl: string;
  note: string | null;
}

export function assessWorkflowState(w: WorkflowStatusInput): HealthState {
  if (w.status === "in_progress" || w.status === "queued") return "degraded";
  if (w.status !== "completed") return "unknown";
  if (w.conclusion === "success") return "healthy";
  if (w.conclusion === "failure" || w.conclusion === "timed_out") return "failed";
  return "unknown";
}

export function assessAppHealth(
  workflows: WorkflowStatusInput[] | null,
  ciUrl: string,
): AppHealth {
  if (!workflows) {
    return {
      status: "unknown",
      workflows: [],
      ciUrl,
      note: "CI status is unknown from this runtime (no token) — see Actions; never read as green.",
    };
  }
  const assessed = workflows.map((w) => ({ ...w, state: assessWorkflowState(w) }));
  return {
    status: rollupOverall(assessed.map((w) => w.state)),
    workflows: assessed,
    ciUrl,
    note: assessed.some((w) => w.state === "unknown")
      ? "At least one workflow has no completed run on record."
      : null,
  };
}

// --- Report -------------------------------------------------------------------

export interface OpsHealthReport {
  generatedAt: string;
  topic: TopicHealth;
  judge: JudgeHealth;
  database: DatabaseHealth;
  app: AppHealth;
  overall: Exclude<HealthState, "unknown">;
  unknowns: string[];
  notes: string[];
}

export function buildOpsHealthReport(parts: {
  generatedAt: string;
  topic: TopicHealth;
  judge: JudgeHealth;
  database: DatabaseHealth;
  app: AppHealth;
}): OpsHealthReport {
  const unknowns: string[] = [];
  if (parts.app.status === "unknown") unknowns.push("app/ci");
  const notes = [
    parts.topic.note,
    parts.judge.note,
    parts.database.note,
    parts.app.note,
  ].filter((n): n is string => !!n);
  return {
    ...parts,
    overall: rollupOverall([parts.topic.status, parts.judge.status, parts.database.status, parts.app.status]),
    unknowns,
    notes,
  };
}
