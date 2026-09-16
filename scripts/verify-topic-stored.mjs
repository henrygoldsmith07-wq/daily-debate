#!/usr/bin/env node
// Post-write freshness verification for the scheduled topic pipeline.
//
// A green "generation step" only means the script exited 0. This verifier
// re-reads the PRODUCTION database after the run and fails the workflow if
// the write did not actually leave a valid, complete, bounded tomorrow-topic:
//
//   1. exactly one daily_topics row exists for the target date;
//   2. the row is complete (title + prompt non-empty) and the date matches;
//   3. generation provenance is a valid stored source ('ai' | 'fallback');
//   4. every evidence card for that date references the topic row;
//   5. the evidence count stays within the pipeline cap (default 3).
//
//   DATABASE_URL=... node scripts/verify-topic-stored.mjs [--date YYYY-MM-DD] [--max-cards N]
//
// Default target date follows the generator's cycle-boundary rule (the day
// after the most recent 15:00 UTC boundary), NOT a raw tomorrow: during a
// delayed pre-midnight slot that slips past midnight, the generator still
// targets today, so the verifier's default must agree.

import { createExecutor } from "./lib/sql-executor.mjs";
import { resolveTargetDate } from "./generate-topics.mjs";

const args = process.argv.slice(2);
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  process.stderr.write("verify-topic-stored: DATABASE_URL is required.\n");
  process.exit(2);
}
const dateIdx = args.indexOf("--date");
const tomorrowUtc = resolveTargetDate(new Date());
const targetDate = dateIdx !== -1 ? String(args[dateIdx + 1] ?? "") : tomorrowUtc;
if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
  process.stderr.write(`verify-topic-stored: bad --date "${targetDate}" (expected YYYY-MM-DD).\n`);
  process.exit(2);
}
const maxIdx = args.indexOf("--max-cards");
const maxCards = maxIdx !== -1 ? Number(args[maxIdx + 1]) : 3;
if (!Number.isInteger(maxCards) || maxCards < 0) {
  process.stderr.write("verify-topic-stored: bad --max-cards.\n");
  process.exit(2);
}

const query = await createExecutor(databaseUrl);
const failures = [];
const checks = {};

const rows = await query(
  `SELECT id, topic_date::text AS topic_date, title, prompt, generation_source
     FROM daily_topics WHERE topic_date = $1::date`,
  [targetDate],
);

// 1+2: exactly one complete row for the target date.
checks.topicRows = rows.length;
if (rows.length !== 1) {
  failures.push(`expected exactly 1 topic row for ${targetDate}, found ${rows.length}`);
  checks.topic_row = { count: rows.length };
} else {
  const [row] = rows;
  checks.topic_row = { id: row.id, date: row.topic_date, title: String(row.title ?? "").slice(0, 80) };
  if (row.topic_date.slice(0, 10) !== targetDate) failures.push(`stored topic_date ${row.topic_date} != target ${targetDate}`);
  if (!String(row.title ?? "").trim()) failures.push("stored topic has an empty title");
  if (!String(row.prompt ?? "").trim()) failures.push("stored topic has an empty prompt");
  // 3: provenance is a valid stored source.
  if (row.generation_source !== "ai" && row.generation_source !== "fallback") {
    failures.push(`invalid generation provenance: ${JSON.stringify(row.generation_source)}`);
  }
  checks.provenance = row.generation_source;

  // 4+5: evidence references the correct topic and stays bounded.
  const ev = await query(
    `SELECT count(*)::int AS n
       FROM topic_evidence te
       JOIN daily_topics dt ON dt.id = te.topic_id
      WHERE dt.topic_date = $1::date`,
    [targetDate],
  );
  const n = ev[0]?.n ?? 0;
  checks.evidenceCards = n;
  if (n > maxCards) failures.push(`evidence cards ${n} exceed cap ${maxCards} (re-runs must replace, never accumulate)`);
  const orphans = await query(
    `SELECT count(*)::int AS n
       FROM topic_evidence te
      WHERE NOT EXISTS (SELECT 1 FROM daily_topics d WHERE d.id = te.topic_id)`,
  );
  if ((orphans[0]?.n ?? 0) > 0) failures.push(`${orphans[0].n} evidence rows reference a topic that no longer exists (FK broken)`);
}

const ok = failures.length === 0;
process.stdout.write(JSON.stringify({ ok, targetDate, maxCards, checks, failures }, null, 2) + "\n");
if (!ok) {
  process.stderr.write(`[verify-topic-stored] FAILED for ${targetDate}:\n  - ${failures.join("\n  - ")}\n`);
  process.exit(1);
}
process.stderr.write(`[verify-topic-stored] OK: ${targetDate} topic verified (provenance=${checks.provenance}, evidence=${checks.evidenceCards}/${maxCards})\n`);
