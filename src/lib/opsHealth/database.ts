// Database and migration readiness health.
//
// Checks connectivity and verifies that the columns, constraints and
// functions each required migration installs are actually present - a
// successful connect on a half-migrated database is not healthy.

import { todayIsoUtc, type HealthState } from "./core";

/**
 * topic_run_log fidelity for migration 016: "full" when run_created_at,
 * queue_delay_ms, generator_result and provider_health are all present,
 * "legacy" when telemetry still flows but those columns are missing,
 * "unknown" when the table itself could not be inspected. Legacy is
 * reported as degraded — visible, never a silent loss of capability.
 */
export type TopicRunLogFidelity = "full" | "legacy" | "unknown";

export interface DatabaseHealth {
  status: HealthState;
  reachable: boolean;
  latencyMs: number | null;
  migrationsApplied: number | null;
  requiredTablesOk: boolean | null;
  missingTables: string[];
  topicRunLogFidelity: TopicRunLogFidelity;
  /** Per-migration schema readiness: actual columns, not migration counts. */
  migrationReadiness: MigrationReadiness;
  note: string | null;
}

/** Explicit readiness per migration the running application depends on. */
export interface MigrationReadiness {
  /** 016: topic_run_log telemetry columns (run_created_at, queue_delay_ms, generator_result, provider_health). */
  migration016TelemetryReady: boolean | null;
  /** 017: route_lifecycle table with its required lifecycle columns. */
  migration017RouteLifecycleReady: boolean | null;
  /** 018: topic_fingerprint columns + provider_attempts ledger (topic pipeline hard requirement). */
  migration018TopicFingerprintReady: boolean | null;
  /** 019: generation_reason column + its value constraint (canonical provenance). */
  migration019GenerationReasonReady: boolean | null;
  /** 022: product-event reason privacy constraint is present. */
  migration022ProductEventReasonReady: boolean | null;
  /** 023: atomic friend-challenge functions + one-open-invite index are present. */
  migration023FriendChallengeReady: boolean | null;
  /** 024: human-validation integrity + system-judge claim table are present. */
  migration024HumanValidationReady: boolean | null;
  /** 025: durable repair-to-retest assignment/outcome state is present. */
  migration025RepairRetestReady: boolean | null;
  /** Latest application schema required by the running build. */
  latestApplicationSchemaReady: boolean | null;
  note: string | null;
}

/**
 * Canonical required-schema definitions for the readiness checks above.
 * A `constraint:`-prefixed entry matches a constraint name supplied by the
 * schema probe (constraints ride the same map, keyed by table), so column
 * AND value-constraint readiness are both derived from actual schema — never
 * from a migration count.
 */
export const MIGRATION_REQUIRED_COLUMNS: Record<"016" | "017" | "018" | "019" | "022" | "023" | "024" | "025", Array<{ table: string; columns: string[] }>> = {
  "016": [{ table: "topic_run_log", columns: ["run_created_at", "queue_delay_ms", "generator_result", "provider_health"] }],
  "017": [
    {
      table: "route_lifecycle",
      columns: [
        "route", "registration_version", "state", "evaluated_at", "sample_window", "sample_n",
        "gate_result", "human_result", "adopted_at", "suspended_at", "reason", "updated_at",
      ],
    },
  ],
  "018": [
    { table: "daily_topics", columns: ["topic_fingerprint"] },
    { table: "topic_evidence", columns: ["topic_fingerprint"] },
    { table: "topic_run_log", columns: ["topic_fingerprint", "provider_attempts"] },
  ],
  "019": [
    {
      table: "daily_topics",
      columns: ["generation_reason", "constraint:daily_topics_generation_reason_check"],
    },
  ],
  "022": [
    {
      table: "product_events",
      columns: ["constraint:product_events_reason_check"],
    },
  ],
  "023": [
    {
      table: "challenge_invites",
      columns: [
        "index:challenge_invites_one_open_per_challenger",
        "function:create_friend_challenge",
        "function:accept_friend_challenge",
      ],
    },
  ],
  "024": [
    {
      table: "challenge_invites",
      columns: ["function:create_friend_challenge_v2"],
    },
    {
      table: "corpus_system_judge_claims",
      columns: ["corpus_id", "claim_token", "claimed_at"],
    },
  ],
  "025": [
    {
      table: "repair_retests",
      columns: [
        "repair_result_id",
        "user_id",
        "repair_debate_id",
        "target_kind",
        "assigned_debate_id",
        "assigned_at",
        "completed_at",
        "observable",
        "demonstrated",
        "index:repair_retests_completion_idx",
        "index:repair_retests_assigned_debate_unique",
        "index:repair_retests_one_open_per_repair",
      ],
    },
  ],
};

/**
 * Pure per-migration readiness from an information_schema column listing.
 * unknown (null) when the schema itself is unreadable — never a guess.
 */
export function assessMigrationReadiness(
  present: Map<string, Set<string>> | null,
): MigrationReadiness {
  if (!present) {
    return {
      migration016TelemetryReady: null,
      migration017RouteLifecycleReady: null,
      migration018TopicFingerprintReady: null,
      migration019GenerationReasonReady: null,
      migration022ProductEventReasonReady: null,
      migration023FriendChallengeReady: null,
      migration024HumanValidationReady: null,
      migration025RepairRetestReady: null,
      latestApplicationSchemaReady: null,
      note: "Schema unreadable — migration readiness could not be verified.",
    };
  }
  const check = (key: "016" | "017" | "018" | "019" | "022" | "023" | "024" | "025"): boolean =>
    MIGRATION_REQUIRED_COLUMNS[key].every(({ table, columns }) => {
      const cols = present.get(table);
      return !!cols && columns.every((c) => cols.has(c));
    });
  const ready16 = check("016");
  const ready17 = check("017");
  const ready18 = check("018");
  const ready19 = check("019");
  const ready22 = check("022");
  const ready23 = check("023");
  const ready24 = check("024");
  const ready25 = check("025");
  const missing = [
    ...(ready16 ? [] : ["016_topic_run_telemetry.sql"]),
    ...(ready17 ? [] : ["017_route_lifecycle.sql"]),
    ...(ready18 ? [] : ["018_topic_fingerprint.sql"]),
    ...(ready19 ? [] : ["019_generation_reason.sql"]),
    ...(ready22 ? [] : ["022_product_event_reason_privacy.sql"]),
    ...(ready23 ? [] : ["023_atomic_friend_challenges.sql"]),
    ...(ready24 ? [] : ["024_human_validation_integrity.sql"]),
    ...(ready25 ? [] : ["025_repair_retest_state.sql"]),
  ];
  return {
    migration016TelemetryReady: ready16,
    migration017RouteLifecycleReady: ready17,
    migration018TopicFingerprintReady: ready18,
    migration019GenerationReasonReady: ready19,
    migration022ProductEventReasonReady: ready22,
    migration023FriendChallengeReady: ready23,
    migration024HumanValidationReady: ready24,
    migration025RepairRetestReady: ready25,
    latestApplicationSchemaReady: missing.length === 0,
    note: missing.length
      ? `Required application schema is incomplete (${missing.join(", ")}).`
      : null,
  };
}

export function assessDatabaseHealth(input: {
  reachable: boolean;
  latencyMs?: number | null;
  migrationsApplied?: number | null;
  missingTables?: string[];
  topicRunLogFidelity?: TopicRunLogFidelity;
  migrationReadiness?: MigrationReadiness;
}): DatabaseHealth {
  if (!input.reachable) {
    return {
      status: "blocked",
      reachable: false,
      latencyMs: null,
      migrationsApplied: null,
      requiredTablesOk: null,
      missingTables: [],
      topicRunLogFidelity: "unknown",
      migrationReadiness: input.migrationReadiness ?? assessMigrationReadiness(null),
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
      topicRunLogFidelity: input.topicRunLogFidelity ?? "unknown",
      migrationReadiness: input.migrationReadiness ?? assessMigrationReadiness(null),
      note: `Required tables missing (${missingTables.join(", ")}) — run migrations before trusting any stored data.`,
    };
  }
  const readiness = input.migrationReadiness ?? assessMigrationReadiness(null);
  if (input.topicRunLogFidelity === "legacy") {
    return {
      status: "degraded",
      reachable: true,
      latencyMs: input.latencyMs ?? null,
      migrationsApplied: input.migrationsApplied ?? null,
      requiredTablesOk: true,
      missingTables: [],
      topicRunLogFidelity: "legacy",
      migrationReadiness: readiness,
      note: "topic_run_log lacks migration 016 columns (run_created_at, queue_delay_ms, generator_result, provider_health) — apply 016_topic_run_telemetry.sql; telemetry writers keep working in compatibility mode.",
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
      topicRunLogFidelity: input.topicRunLogFidelity ?? "unknown",
      migrationReadiness: readiness,
      note: `Database reachable but slow (SELECT 1 took ${input.latencyMs}ms).`,
    };
  }
  // A database can be reachable with every table present and still lack the
  // 018 fingerprint schema the production pipeline requires — that is a real
  // degradation, surfaced here without collapsing the two dimensions.
  const schemaDegraded = readiness.latestApplicationSchemaReady === false;
  return {
    status: schemaDegraded ? "degraded" : "healthy",
    reachable: true,
    latencyMs: input.latencyMs ?? null,
    migrationsApplied: input.migrationsApplied ?? null,
    requiredTablesOk: true,
    missingTables: [],
    topicRunLogFidelity: input.topicRunLogFidelity ?? "unknown",
    migrationReadiness: readiness,
    note: readiness.note,
  };
}

// --- CI / E2E (GitHub Actions; unknown without a token) ----------------------
