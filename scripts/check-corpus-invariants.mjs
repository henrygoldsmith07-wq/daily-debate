#!/usr/bin/env node
// Corpus consistency invariants — fails (exit 1) when the human-corpus data
// reaches a state the application claims is impossible. CI runs this against
// the ephemeral Postgres after migrations + E2E seed, so a closure bug, a
// dropped constraint or a malformed audit trail breaks the build instead of
// quietly poisoning judge-vs-human evaluation later.
//
//   DATABASE_URL=... node scripts/check-corpus-invariants.mjs [--target-raters N]
//
// The rating collection target is parsed from src/lib/corpus.ts
// (RATING_COLLECTION_TARGET) so the check can never drift from the app; --target-raters
// overrides for ad-hoc probes.

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

const query = await createExecutor(databaseUrl);
const violations = [];

async function check(name, sql, params = []) {
  const rows = await query(sql, params);
  if (rows.length) {
    const ids = rows.slice(0, 10).map((r) => JSON.stringify(r)).join(", ");
    violations.push(`${name}: ${rows.length} violation(s)${rows.length > 10 ? " (first 10 shown)" : ""} -> ${ids}`);
  }
  return rows;
}

// 1. open items at/over the closure threshold — closure did not happen.
await check(
  "open-at-threshold",
  `SELECT ci.id, count(cr.id)::int AS ratings
     FROM corpus_items ci LEFT JOIN corpus_ratings cr ON cr.corpus_id = ci.id
    WHERE ci.status = 'open' GROUP BY ci.id HAVING count(cr.id) >= $1`,
  [targetRaters],
);

// 2. rated/adjudicated items below the target — closed without enough evidence.
await check(
  "rated-below-threshold",
  `SELECT ci.id, count(cr.id)::int AS ratings
     FROM corpus_items ci LEFT JOIN corpus_ratings cr ON cr.corpus_id = ci.id
    WHERE ci.status IN ('rated', 'adjudicated') GROUP BY ci.id HAVING count(cr.id) < $1`,
  [targetRaters],
);

// 3. persisted counter out of sync with actual rows (closure arithmetic).
await check(
  "rating-count-drift",
  `SELECT ci.id, ci.rating_count, count(cr.id)::int AS actual
     FROM corpus_items ci LEFT JOIN corpus_ratings cr ON cr.corpus_id = ci.id
    GROUP BY ci.id HAVING ci.rating_count <> count(cr.id)::int`,
);

// 4. append-once enforced? duplicates must not exist at all.
await check(
  "duplicate-rating",
  `SELECT corpus_id, rater_id, count(*)::int AS n FROM corpus_ratings
    GROUP BY corpus_id, rater_id HAVING count(*) > 1`,
);

// 5. blinded corpus must not contain contributor self-ratings.
await check(
  "contributor-self-rating",
  `SELECT cr.id, cr.corpus_id, cr.rater_id
     FROM corpus_ratings cr JOIN corpus_items ci ON ci.id = cr.corpus_id
    WHERE cr.rater_id = ci.contributor_id`,
);

// 6/7. enum integrity (columns may be nullable but never malformed).
await check(
  "malformed-presented-first",
  `SELECT id FROM corpus_ratings WHERE presented_first IS NULL OR presented_first NOT IN ('a','b')`,
);
await check(
  "invalid-winner",
  `SELECT id FROM corpus_ratings WHERE winner IS NULL OR winner NOT IN ('a','b','tie')`,
);

// 8. correction audit events must be complete, self-contained objects.
await check(
  "malformed-corrections",
  `SELECT cr.id, ordinality AS event_index
     FROM corpus_ratings cr, jsonb_array_elements(cr.corrections) WITH ORDINALITY AS e(elem, ordinality)
    WHERE jsonb_typeof(cr.corrections) <> 'array'
       OR jsonb_typeof(e.elem) <> 'object'
       OR coalesce(e.elem->>'at','') = ''
       OR coalesce(e.elem->>'actor','') = ''
       OR coalesce(e.elem->>'reason','') = ''
       OR jsonb_typeof(e.elem->'before') <> 'object'
       OR jsonb_typeof(e.elem->'after') <> 'object'
       OR jsonb_typeof(e.elem->'before'->'scoresA') <> 'object'
       OR jsonb_typeof(e.elem->'after'->'scoresA') <> 'object'`,
);

// 9. audit chain: every event's `before` equals the previous event's `after`
// (compared in JS because it pairs array elements).
const withCorrections = await query(
  `SELECT id, corrections FROM corpus_ratings WHERE jsonb_array_length(corrections) > 1`,
);
for (const row of withCorrections) {
  const trail = Array.isArray(row.corrections) ? row.corrections : JSON.parse(String(row.corrections));
  for (let i = 1; i < trail.length; i++) {
    if (JSON.stringify(trail[i].before) !== JSON.stringify(trail[i - 1].after)) {
      violations.push(`corrections-chain-broken: rating ${row.id} event ${i} before != event ${i - 1} after`);
      break;
    }
  }
}

if (violations.length) {
  process.stderr.write(`[corpus-invariants] FAILED (collection target = ${targetRaters}):\n  - ${violations.join("\n  - ")}\n`);
  process.exit(1);
}
process.stdout.write(`[corpus-invariants] OK (collection target = ${targetRaters}, 9 checks)\n`);
