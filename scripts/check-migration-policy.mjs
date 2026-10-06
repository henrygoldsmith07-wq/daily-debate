#!/usr/bin/env node
// Migration policy lint (CI): every migration must be additive within one
// release. DROP / RENAME / ALTER TYPE are rejected unless the file carries
// `-- destructive-ok: <reason>`. See scripts/lib/migration-policy.mjs.
//
// Migrations that predate this lint are grandfathered in BASELINE below —
// a frozen, reviewed list with the reason each one was accepted. The list
// must never GROW: a new destructive migration has to carry its own marker,
// and a stale baseline entry (file deleted) is itself an error.
//
// Usage: node scripts/check-migration-policy.mjs
// Exit 0 = all migrations pass the policy; exit 1 = violations (printed).

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkMigrationSet } from "./lib/migration-policy.mjs";

/**
 * Grandfathered destructive migrations (pre-lint). Each entry documents WHY
 * the drop was accepted. All of them follow the same pattern: the dropped
 * object is replaced by a widened version in the SAME migration, so old code
 * never sees a schema missing a constraint it still writes to.
 * @type {Map<string, string>}
 */
const BASELINE = new Map([
  ["011_ai_call_log_providers.sql", "replaces ai_call_log_provider_check with the widened allowlist in the same file"],
  ["015_argument_routing_telemetry.sql", "replaces ai_call_log_provider_check with the widened allowlist in the same file"],
  ["016_topic_run_telemetry.sql", "replaces topic_run_log_generator_result_check with the widened enum in the same file"],
  ["019_generation_reason.sql", "replaces daily_topics_generation_reason_check with the widened reason set in the same file"],
  ["020_pvp_matchmaking_convergence.sql", "replaces the per-player active-match trigger function with the converged implementation in the same file"],
  ["021_learning_loop_events.sql", "replaces product_events_name_check with the widened allowlist in the same file"],
  ["022_product_event_reason_privacy.sql", "replaces product_events_reason_check with the bounded reason set in the same file"],
  ["028_atomic_solo_turns.sql", "replaces solo_debate_turns_response_mode_check with the widened mode set in the same file"],
  ["029_durable_solo_submissions.sql", "replaces solo_debate_turns_staged_mode_check with the widened mode set in the same file"],
  ["030_solo_state_machine_closure.sql", "replaces advance_solo_debate_turn with the state-machine-closure version in the same file"],
  ["031_recovery_and_compact_results.sql", "replaces solo_debates_performance_score_check with the widened bounds in the same file"],
  ["032_atomic_solo_start.sql", "replaces finalize_solo_debate with the atomic RPC in the same file"],
  ["035_opponent_personas_formats.sql", "replaces solo_debates_format_check with the widened format allowlist in the same file"],
]);

const migrationsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "database",
  "migrations",
);

const files = (await readdir(migrationsDir))
  .filter((name) => name.endsWith(".sql"))
  .sort();

// A stale baseline entry means someone deleted or renamed a grandfathered
// migration — the list must be maintained, not left to rot silently.
const staleBaseline = [...BASELINE.keys()].filter((name) => !files.includes(name));
if (staleBaseline.length) {
  process.stderr.write(`[migration-policy] stale baseline entries (file gone): ${staleBaseline.join(", ")}\n`);
  process.exit(1);
}

const contents = await Promise.all(
  files.map(async (name) => ({ name, content: await readFile(path.join(migrationsDir, name), "utf8") })),
);

const rawViolations = checkMigrationSet(contents);
// Baseline entries are grandfathered; anything else is a violation.
const violations = rawViolations.filter((violation) => !BASELINE.has(violation.name));

if (violations.length === 0) {
  console.log(
    `[migration-policy] ${contents.length} migrations checked — all additive or explicitly marked destructive-ok (${BASELINE.size} baseline entries).`,
  );
  process.exit(0);
}

process.stderr.write(`[migration-policy] ${violations.length} violation(s):\n`);
for (const violation of violations) {
  process.stderr.write(`\n  ${violation.name}\n    rule:  ${violation.rule}\n    line:  ${violation.line}\n    hint:  ${violation.hint}\n`);
}
process.stderr.write(
  "\nOne release = additive only: an old build must keep working against the new schema while the previous deployment is still live.\n",
);
process.exit(1);
