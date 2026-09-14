#!/usr/bin/env node
// Safe repair for historical corpus-closure drift (pre-013 data): items that
// reached the required rating count but were never flipped to 'rated', and
// items whose persisted rating_count disagrees with the actual rows.
//
//   node scripts/repair-corpus-closure.mjs               # dry run (default)
//   node scripts/repair-corpus-closure.mjs --apply       # repair + log
//
// Guarantees: dry-run by default; reports affected ids and counts; never
// deletes or edits ratings; only changes status where the actual threshold is
// met; re-running is a no-op once repaired.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createExecutor } from "./lib/sql-executor.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  process.stderr.write("DATABASE_URL is required.\n");
  process.exit(2);
}
const APPLY = process.argv.includes("--apply");

function thresholdFromSource() {
  try {
    const src = fs.readFileSync(path.join(projectRoot, "src", "lib", "corpus.ts"), "utf8");
    const m = src.match(/export const MIN_RATERS_PER_ITEM\s*=\s*(\d+)/);
    if (m) return Number(m[1]);
  } catch {
    /* fall through to flag */
  }
  return null;
}
const idx = process.argv.indexOf("--min-raters");
const minRaters = idx !== -1 ? Number(process.argv[idx + 1]) : thresholdFromSource();
if (!Number.isInteger(minRaters) || minRaters < 1) {
  process.stderr.write("Could not resolve the rating threshold; pass --min-raters N.\n");
  process.exit(2);
}

const query = await createExecutor(databaseUrl);
const at = new Date().toISOString();

// 1) Sync the persisted counter to reality (never touches ratings).
const drift = await query(
  `SELECT ci.id, ci.rating_count AS stored, count(cr.id)::int AS actual
     FROM corpus_items ci LEFT JOIN corpus_ratings cr ON cr.corpus_id = ci.id
    GROUP BY ci.id HAVING ci.rating_count <> count(cr.id)::int`,
);
// 2) Items open at/over the threshold: closure candidates.
const closable = await query(
  `SELECT ci.id, count(cr.id)::int AS ratings
     FROM corpus_items ci LEFT JOIN corpus_ratings cr ON cr.corpus_id = ci.id
    WHERE ci.status = 'open' GROUP BY ci.id HAVING count(cr.id) >= $1`,
  [minRaters],
);

const log = (msg) => process.stdout.write(`[repair-corpus ${at} ${APPLY ? "APPLY" : "DRY-RUN"}] ${msg}\n`);
log(`threshold=${minRaters}; counter-drift=${drift.length}; open-at-threshold=${closable.length}`);
for (const row of drift.slice(0, 50)) log(`  drift: item ${row.id} stored=${row.stored} actual=${row.actual}`);
for (const row of closable.slice(0, 50)) log(`  closable: item ${row.id} ratings=${row.ratings}`);

if (!APPLY) {
  if (drift.length || closable.length) {
    log("no changes made (dry run). Re-invoke with --apply to repair.");
    process.exit(0);
  }
  log("nothing to repair.");
  process.exit(0);
}

let synced = 0;
let closed = 0;
for (const row of drift) {
  await query("UPDATE corpus_items SET rating_count = $2 WHERE id = $1 AND rating_count <> $2", [row.id, row.actual]);
  synced += 1;
}
for (const row of closable) {
  // Guarded update: only flips while still open AND only at rows whose
  // actual count still meets the threshold (idempotent, race-safe).
  const res = await query(
    `UPDATE corpus_items ci SET status = 'rated'
      WHERE ci.id = $1 AND ci.status = 'open'
        AND (SELECT count(*) FROM corpus_ratings cr WHERE cr.corpus_id = ci.id) >= $2
      RETURNING ci.id`,
    [row.id, minRaters],
  );
  if (res.length) closed += 1;
}
log(`done: rating_count synced on ${synced} item(s), status open->rated on ${closed} item(s). Ratings untouched.`);
