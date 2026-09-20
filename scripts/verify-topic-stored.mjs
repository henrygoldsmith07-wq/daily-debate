#!/usr/bin/env node
// Post-write freshness verification for the scheduled topic pipeline.
//
// A green "generation step" only means the script exited 0. This verifier
// re-reads the PRODUCTION database after the run and fails the workflow if
// the stored tomorrow-topic is not a valid, complete, bounded, revision-clean
// record:
//
//   1. exactly one daily_topics row exists for the target date;
//   2. the row is complete (title + prompt + category non-empty) and the date
//      matches, with valid generation provenance ('ai' | 'fallback');
//   3. the canonical topic fingerprint recomputes and matches the recorded
//      fingerprint (missing column or mismatch fails loudly — a missing
//      migration must never read as green);
//   4. the evidence count stays within the pipeline cap (default 3);
//   5. EVERY evidence card for that topic carries the CURRENT revision's
//      fingerprint — mismatched or unstamped cards are stale evidence from
//      replaced content and fail the run;
//   6. no orphan evidence rows exist anywhere (FK integrity).
//
//   DATABASE_URL=... node scripts/verify-topic-stored.mjs [--date YYYY-MM-DD] [--max-cards N]
//
// Default target date follows the generator's cycle-boundary rule (the day
// after the most recent 15:00 UTC boundary), NOT a raw tomorrow: during a
// delayed pre-midnight slot that slips past midnight, the generator still
// targets today, so the verifier's default must agree.

import { createExecutor } from "./lib/sql-executor.mjs";
import { resolveTargetDate, topicFingerprint } from "./generate-topics.mjs";

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
  `SELECT id, topic_date::text AS topic_date, title, prompt, category,
          generation_source, topic_fingerprint
     FROM daily_topics WHERE topic_date = $1::date`,
  [targetDate],
).catch((e) => {
  // A missing topic_fingerprint column means migration 018 is not applied:
  // fail loudly rather than silently skipping revision checks.
  if (/topic_fingerprint/i.test(String(e?.message ?? e))) {
    failures.push("topic_fingerprint column missing — apply migration 018_topic_fingerprint.sql before trusting revision checks");
    return "fingerprint-column-missing";
  }
  throw e;
});

if (rows !== "fingerprint-column-missing") {
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
    if (!String(row.category ?? "").trim()) failures.push("stored topic has an empty category");
    // 2b: provenance is a valid stored source.
    if (row.generation_source !== "ai" && row.generation_source !== "fallback") {
      failures.push(`invalid generation provenance: ${JSON.stringify(row.generation_source)}`);
    }
    checks.provenance = row.generation_source;

    // 3: the canonical fingerprint recomputes and matches the record.
    const expected = topicFingerprint({
      topicDate: targetDate,
      title: row.title,
      prompt: row.prompt,
      category: row.category,
    });
    checks.fingerprint = row.topic_fingerprint ?? null;
    checks.fingerprintValid = row.topic_fingerprint === expected;
    if (!row.topic_fingerprint) {
      failures.push("stored topic has no fingerprint — legacy row awaiting backfill, not yet proven immutable");
    } else if (row.topic_fingerprint !== expected) {
      failures.push("stored topic fingerprint does not match its content — the row changed under its recorded identity");
    }

    // 4+5: evidence is bounded AND belongs to THIS exact revision.
    // Compared against the RECOMPUTED fingerprint, so a tampered row cannot
    // validate its own stale cards.
    const ev = await query(
      `SELECT count(*)::int AS n,
              count(*) FILTER (WHERE topic_fingerprint IS NOT NULL AND topic_fingerprint IS DISTINCT FROM $2)::int AS mismatched,
              count(*) FILTER (WHERE topic_fingerprint IS NULL)::int AS unstamped
         FROM topic_evidence te
         JOIN daily_topics dt ON dt.id = te.topic_id
        WHERE dt.topic_date = $1::date`,
      [targetDate, expected],
    ).catch((e) => {
      if (/topic_fingerprint/i.test(String(e?.message ?? e))) {
        failures.push("topic_evidence.topic_fingerprint column missing — apply migration 018_topic_fingerprint.sql");
        return null;
      }
      throw e;
    });
    if (ev) {
      const n = ev[0]?.n ?? 0;
      const mismatched = ev[0]?.mismatched ?? 0;
      const unstamped = ev[0]?.unstamped ?? 0;
      checks.evidenceCards = n;
      checks.staleEvidence = mismatched + unstamped;
      if (n > maxCards) failures.push(`evidence cards ${n} exceed cap ${maxCards} (re-runs must verify, never accumulate)`);
      if (mismatched > 0) failures.push(`${mismatched} evidence card(s) carry a different revision fingerprint — stale evidence from replaced content`);
      if (unstamped > 0) failures.push(`${unstamped} evidence card(s) lack a revision fingerprint — ownership unproven`);
    }

    // 6: no orphan evidence anywhere.
    const orphans = await query(
      `SELECT count(*)::int AS n
         FROM topic_evidence te
        WHERE NOT EXISTS (SELECT 1 FROM daily_topics d WHERE d.id = te.topic_id)`,
    );
    if ((orphans[0]?.n ?? 0) > 0) failures.push(`${orphans[0].n} evidence rows reference a topic that no longer exists (FK broken)`);
  }
}

const ok = failures.length === 0;
process.stdout.write(JSON.stringify({ ok, targetDate, maxCards, checks, failures }, null, 2) + "\n");
if (!ok) {
  process.stderr.write(`[verify-topic-stored] FAILED for ${targetDate}:\n  - ${failures.join("\n  - ")}\n`);
  process.exit(1);
}
process.stderr.write(`[verify-topic-stored] OK: ${targetDate} topic verified (provenance=${checks.provenance}, fingerprint=${String(checks.fingerprint ?? "").slice(0, 12)}, evidence=${checks.evidenceCards}/${maxCards})\n`);
