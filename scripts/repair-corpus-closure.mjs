#!/usr/bin/env node
// Safe repair for historical corpus-closure drift (pre-013 data): items that
// reached the required rating count but were never flipped to 'rated', and
// items whose persisted rating_count disagrees with the actual rows.
//
//   node scripts/repair-corpus-closure.mjs               # dry run (default)
//   node scripts/repair-corpus-closure.mjs --apply       # repair + log
//
// Race safety: every candidate is re-decided inside its own transaction,
// under the item row lock, with the count taken AFTER the lock (see
// scripts/lib/corpus-repair.mjs). Counts from the pre-lock scan are never
// written. Guarantees: dry-run default; reports affected ids; never deletes
// or edits ratings; only flips open -> rated when the fresh count meets the
// threshold; reopens historical rated rows below the new collection target;
// idempotent; transaction-capable DATABASE_URL required (plain
// postgres:// TCP - Neon HTTP endpoints cannot run transactions and are
// refused rather than silently degraded).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { isNeonHttpUrl } from "./lib/sql-executor.mjs";
import { findCandidates, repairItemWithLock } from "./lib/corpus-repair.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  process.stderr.write("DATABASE_URL is required.\n");
  process.exit(2);
}
if (isNeonHttpUrl(databaseUrl)) {
  process.stderr.write(
    "repair-corpus-closure requires a transaction-capable postgres:// (TCP, pooled is fine) DATABASE_URL;\n" +
    "the Neon HTTP endpoint cannot hold a row lock across statements and is refused by design.\n",
  );
  process.exit(2);
}
const APPLY = process.argv.includes("--apply");

function thresholdFromSource() {
  try {
    const src = fs.readFileSync(path.join(projectRoot, "src", "lib", "corpus.ts"), "utf8");
    const m = src.match(/export const RATING_COLLECTION_TARGET\s*=\s*(\d+)/);
    if (m) return Number(m[1]);
  } catch {
    /* fall through to flag */
  }
  return null;
}
const idx = process.argv.indexOf("--target-raters");
const targetRaters = idx !== -1 ? Number(process.argv[idx + 1]) : thresholdFromSource();
if (!Number.isInteger(targetRaters) || targetRaters < 1) {
  process.stderr.write("Could not resolve the rating collection target; pass --target-raters N.\n");
  process.exit(2);
}

const log = (msg) => process.stdout.write(`[repair-corpus ${new Date().toISOString()} ${APPLY ? "APPLY" : "DRY-RUN"}] ${msg}\n`);

const admin = new pg.Client({ connectionString: databaseUrl });
const reader = new pg.Client({ connectionString: databaseUrl });
await admin.connect();
await reader.connect();
try {
  // Scan is a hint list only: it widens to items one below threshold so a
  // racing final rating is still re-checked under the lock. Stale scan
  // numbers are NEVER used for writes.
  const candidates = await repairCandidates(reader, admin, targetRaters, APPLY, log);
  log(`done: ${candidates.length} candidate(s) examined, ${candidates.filter((c) => c.changed).length} item(s) repaired.`);
} finally {
  await admin.end();
  await reader.end();
}

async function repairCandidates(reader, admin, targetRaters, apply, log) {
  const query = async (text, params) => (await reader.query(text, params)).rows;
  const found = await findCandidates(query, targetRaters);
  log(`candidate scan: ${found.length} item(s) (decisions re-taken under lock)`);
  const results = [];
  for (const candidate of found) {
    const res = await repairItemWithLock(admin, candidate.id, targetRaters, { apply });
    if (res.skipped) {
      log(`  ${res.id}: ${res.skipped} (raced away) - untouched`);
      continue;
    }
    if (res.wouldChange) {
      log(
        `  ${res.id}: stored=${res.before.stored} actual=${res.actual} status ${res.before.status} -> ${res.after.status}` +
        `${res.before.status === "rated" && res.actual < targetRaters ? " (rated-below-target: reopened for remaining ratings)" : ""}` +
        `${apply ? "" : " [would change; dry run]"}`,
      );
    }
    results.push(res);
  }
  return results;
}
