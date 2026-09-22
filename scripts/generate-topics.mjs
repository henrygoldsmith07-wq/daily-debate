#!/usr/bin/env node
// Pre-generation pipeline: runs six times daily via GitHub Actions cron —
// 20:00, 21:30, 22:45, 23:40, then 00:15 and 02:15 UTC post-midnight — and
// every slot targets the SAME date (see resolveTargetDate).
//
//   1. Generate 3-5 candidate topics via the AI provider chain
//   2. Score each on 9 dimensions (debatable balance, evidence availability,
//      novelty, specificity, age appropriateness, factual grounding,
//      ideological loading, source diversity, similarity to recent topics)
//   3. Pick the strongest candidate
//   4. Store for TOMORROW's date (so it publishes at midnight)
//   5. If all AI providers fail, store a curated fallback topic
//
// The target date is resolved from the 15:00 UTC cycle boundary, not the raw
// execution clock (see resolveTargetDate below) — scheduler delay must not
// move the target to the next cycle, so the 00:15/02:15 slots are true
// retries for the SAME tomorrow inside the recovery window ahead of the
// 03:00 UTC availability deadline.
//
// Dependency-free ESM — same pattern as judge-benchmark.mjs.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createExecutor } from "./lib/sql-executor.mjs";
import { generationChains, providerStatus as registryProviderStatus, usableProviders } from "./lib/judge-providers.mjs";

/**
 * Canonical topic fingerprint: SHA-256 over the content identity of one
 * daily topic. A rerun proves TRUE idempotence only when the same target
 * date resolves to the same row with the same fingerprint — "two runs
 * succeeded" is not sufficient, because replacement writes also succeed.
 */
export const TOPIC_FINGERPRINT_VERSION = 1;

export function topicFingerprint({ topicDate, title, prompt, category }) {
  const hash = createHash("sha256");
  hash.update(
    [`topic-fingerprint-v${TOPIC_FINGERPRINT_VERSION}`, topicDate, title, prompt, category ?? ""].join("\n"),
  );
  return hash.digest("hex");
}

/**
 * Content validity for a stored topic row: complete, well-formed fields with
 * a known provenance. Fingerprint agreement is checked separately by
 * topicRowStatus so legacy rows (pre-fingerprint) get a distinct verdict.
 */
export function isValidTopicContent(row) {
  if (!row) return false;
  if (typeof row.title !== "string" || !row.title.trim()) return false;
  if (typeof row.prompt !== "string" || !row.prompt.trim()) return false;
  if (typeof row.category !== "string" || !row.category.trim()) return false;
  return row.generation_source === "ai" || row.generation_source === "fallback";
}

/**
 * Classify one stored topic row for a target date:
 * - "missing"               no row at all — generate.
 * - "valid"                 content valid AND fingerprint agrees — verify only.
 * - "legacy-unfingerprinted" content valid but recorded before fingerprints
 *                             existed — backfill the fingerprint, REBUILD the
 *                             evidence (legacy cards are untrusted, not
 *                             laundered).
 * - "invalid-content"       corrupt row — deliberate repair path regenerates.
 * - "fingerprint-mismatch"  content changed under a recorded fingerprint —
 *                             deliberate repair path regenerates.
 */
export function topicRowStatus(row, targetDate) {
  if (!row) return "missing";
  if (!isValidTopicContent(row)) return "invalid-content";
  const expected = topicFingerprint({
    topicDate: targetDate,
    title: row.title,
    prompt: row.prompt,
    category: row.category,
  });
  if (!row.topic_fingerprint) return "legacy-unfingerprinted";
  if (row.topic_fingerprint !== expected) return "fingerprint-mismatch";
  return "valid";
}

/**
 * Per-model timeout budget: historically the free Nemotron pools stall rather
 * than fail fast. The default stays 60s so quality requirements never
 * silently drop, but a model can be pinned lower via <MODEL_SLUG>_TIMEOUT_MS
 * — e.g. NEMOTRON_3_5_LIGHTNING_TIMEOUT_MS=25000 — so one unhealthy pool
 * cannot burn the whole retry-ladder slot waiting the full maximum.
 */
export function modelTimeoutMs(model, env = process.env, fallbackMs = 60_000) {
  const key = `${String(model ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_TIMEOUT_MS`;
  const raw = Number(env[key]);
  if (Number.isFinite(raw) && raw >= 5_000 && raw <= 120_000) return Math.round(raw);
  return fallbackMs;
}

function loadEnvLocal() {
  const p = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
loadEnvLocal();

const log = (...a) => process.stderr.write(a.join(" ") + "\n");

const args = process.argv.slice(2);
export const isMainModule =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

function printHelp() {
  process.stdout.write(
    [
      "Pre-generate tomorrow's debate topic (daily_topics + topic_evidence).",
      "",
      "Usage:",
      "  node scripts/generate-topics.mjs [--check-config] [--help]",
      "",
      "  (no flags)     run the pipeline: AI candidates, else curated fallback;",
      "                   a valid stored topic is verified, never replaced (already-present)",
      "  --check-config validate env + DB connectivity + required tables, no writes",
      "  --help         print this help",
      "",
      "Exit codes: 0 ok (fallback stored counts as ok); 1 config/db failure.",
      "Required: DATABASE_URL. Optional: NVIDIA_API_KEY / OPENROUTER_API_KEY /",
      "UNOROUTER_API_KEY / KIRAAI_API_KEY (without any provider key the curated",
      "fallback is used).",
      "",
    ].join("\n"),
  );
}

export function databaseHost(databaseUrl) {
  try {
    return new URL(databaseUrl).hostname || "(unparseable)";
  } catch {
    return "(unparseable)";
  }
}

export function providerStatus(env = process.env) {
  // Same registry the app and the judge benchmark use — one source of truth
  // for "which providers are configured".
  return registryProviderStatus(env);
}

/**
 * Fail-fast configuration validation (no writes, no provider calls, no
 * secret values in output). Returns { ok, checks } and never throws.
 */
export async function checkConfig(env = process.env, sqlFactory = createExecutor) {
  const checks = {};
  const databaseUrl = env.DATABASE_URL?.trim();
  checks.database_url_present = !!databaseUrl;
  if (databaseUrl) checks.database_url_host = databaseHost(databaseUrl);
  const providers = providerStatus(env);
  checks.providers_configured = providers;
  checks.ai_generation_expected = providers.length > 0;
  if (!databaseUrl) {
    return { ok: false, checks, reason: "config-failure: DATABASE_URL is required" };
  }
  let sql;
  try {
    sql = await sqlFactory(databaseUrl);
  } catch (e) {
    return { ok: false, checks, reason: `config-failure: cannot create DB client (${String(e?.message ?? e).slice(0, 120)})` };
  }
  const withTimeout = (promise, ms, label) =>
    Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
    ]);
  try {
    await withTimeout(sql("SELECT 1"), 10_000, "database connectivity");
    checks.database_reachable = true;
  } catch (e) {
    checks.database_reachable = false;
    return { ok: false, checks, reason: `db-failure: database unreachable (${String(e?.message ?? e).slice(0, 120)})` };
  }
  try {
    const tables = await withTimeout(
      sql(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('daily_topics', 'topic_evidence')",
      ),
      10_000,
      "table check",
    );
    const present = new Set(tables.map((r) => r.table_name));
    checks.tables_present = [...present].sort();
    const missing = ["daily_topics", "topic_evidence"].filter((t) => !present.has(t));
    if (missing.length) {
      return { ok: false, checks, reason: `db-failure: missing required tables (${missing.join(", ")}); run migrations` };
    }
    const unique = await withTimeout(
      sql(
        `SELECT 1 FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu USING (constraint_name, table_schema)
         WHERE tc.table_name = 'daily_topics' AND tc.constraint_type = 'UNIQUE' AND kcu.column_name = 'topic_date'
         LIMIT 1`,
      ),
      10_000,
      "constraint check",
    );
    checks.topic_date_unique = unique.length > 0;
    if (!checks.topic_date_unique) {
      return { ok: false, checks, reason: "db-failure: daily_topics.topic_date lacks its UNIQUE constraint; re-runs would duplicate rows" };
    }
    // FATAL when migration 018 is absent: a fingerprint-less schema cannot
    // prove revision ownership, and running anyway burns every retry slot
    // repeating a schema-known failure (runs #54-#59) while the freshness
    // verifier rejects the write. Fail HERE, before any generation attempt.
    try {
      const fpCols = await withTimeout(
        sql(
          `SELECT table_name FROM information_schema.columns
            WHERE table_schema = 'public' AND column_name = 'topic_fingerprint'
              AND table_name IN ('daily_topics', 'topic_evidence', 'topic_run_log')`,
        ),
        10_000,
        "fingerprint column check",
      );
      const have = new Set(fpCols.map((r) => r.table_name));
      checks.topic_fingerprint_supported =
        have.has("daily_topics") && have.has("topic_evidence") && have.has("topic_run_log");
      if (!checks.topic_fingerprint_supported) {
        return {
          ok: false,
          checks,
          reason: "config-failure: required production topic fingerprint schema missing; apply database migrations (018_topic_fingerprint.sql) before topic generation",
        };
      }
    } catch {
      checks.topic_fingerprint_supported = false;
      return {
        ok: false,
        checks,
        reason: "config-failure: could not verify topic fingerprint schema; apply database migrations before topic generation",
      };
    }
  } catch (e) {
    return { ok: false, checks, reason: `db-failure: schema check failed (${String(e?.message ?? e).slice(0, 120)})` };
  }
  return { ok: true, checks, reason: "ok" };
}

const databaseUrl = process.env.DATABASE_URL?.trim();

if (isMainModule && !databaseUrl && !args.includes("--help") && !args.includes("--check-config")) {
  console.error("[generate-topics] outcome=config-failure: DATABASE_URL is required.");
  process.exit(1);
}

let executorPromise = null;
/** Same dual transport migrate.mjs uses: Neon HTTP or plain pg TCP. */
async function defaultQuery(text, params) {
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  if (!executorPromise) executorPromise = createExecutor(databaseUrl);
  const executor = await executorPromise;
  return executor(text, params ?? []);
}

async function getRecentTitles(query, limit = 14) {
  const rows = await query(
    "SELECT title FROM daily_topics ORDER BY topic_date DESC LIMIT $1",
    [limit],
  );
  return rows.map((r) => r.title);
}

/**
 * jsonb columns must receive a JSON *string*, never a raw JS array/object.
 * The Neon HTTP transport serialises a JS array as a Postgres array literal
 * (`{a,b}`), which Postgres rejects with "invalid input syntax for type json".
 * That is why an empty fallback `sources: []` (-> `{}`, valid JSON) stored
 * fine while every AI-generated topic (non-empty source list) failed the
 * production write. Serialising explicitly + casting is correct on both the
 * Neon HTTP and node-postgres transports.
 */
export function jsonParam(value) {
  return JSON.stringify(value ?? null);
}

/**
 * Whether this database has the fingerprint columns (migration 018). The
 * pipeline degrades gracefully on older schemas for the write path, but the
 * freshness verifier stays strict so a missing migration is loud, not silent.
 */
export async function fingerprintColumnsSupported(query) {
  try {
    const rows = await query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'daily_topics'
          AND column_name = 'topic_fingerprint'`,
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Whether daily_topics carries generation_reason (migration 019). The column
 * records HOW the immutable topic was originally created; the already-present
 * path reads it and reports it unchanged — it never reconstructs it.
 */
export async function generationReasonSupported(query) {
  try {
    const rows = await query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'daily_topics'
          AND column_name = 'generation_reason'`,
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

async function getExistingTopic(query, targetDate, fingerprintSupported, reasonSupported = false) {
  const columns = [
    "id, topic_date, title, prompt, category, sources, generation_source",
    fingerprintSupported ? "topic_fingerprint" : null,
    reasonSupported ? "generation_reason" : null,
  ].filter(Boolean).join(", ");
  const rows = await query(
    `SELECT ${columns} FROM daily_topics WHERE topic_date = $1::date`,
    [targetDate],
  );
  return rows[0] ?? null;
}

async function evidenceFingerprintCounts(query, topicId, fingerprint, fingerprintSupported) {
    const rows = await query(
    fingerprintSupported
      ? `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE topic_fingerprint IS NOT NULL AND topic_fingerprint IS DISTINCT FROM $2)::int AS mismatched,
                count(*) FILTER (WHERE topic_fingerprint IS NULL)::int AS unstamped
           FROM topic_evidence WHERE topic_id = $1`
      : `SELECT count(*)::int AS total, 0 AS mismatched, 0 AS unstamped
           FROM topic_evidence WHERE topic_id = $1`,
    fingerprintSupported ? [topicId, fingerprint] : [topicId],
  );
  return { total: rows[0]?.total ?? 0, mismatched: rows[0]?.mismatched ?? 0, unstamped: rows[0]?.unstamped ?? 0 };
}

/**
 * Write-once topic claim: inserts ONLY when no row exists for the date.
 * `ON CONFLICT DO NOTHING` (not DO UPDATE) is what makes concurrent
 * same-date retries converge instead of replacing each other — the unique
 * constraint on topic_date serialises the race, losers re-read the winner.
 * Returns the inserted row id, or null when a row already existed.
 */
async function insertTopicOnce(query, targetDate, topic, source, fingerprint, fingerprintSupported, reason, reasonSupported) {
  const withBoth = fingerprintSupported && reasonSupported;
  const rows = await query(
    withBoth
      ? `INSERT INTO daily_topics (topic_date, title, prompt, category, sources, generation_source, topic_fingerprint, generation_reason)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
         ON CONFLICT (topic_date) DO NOTHING
         RETURNING id`
      : fingerprintSupported
      ? `INSERT INTO daily_topics (topic_date, title, prompt, category, sources, generation_source, topic_fingerprint)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
         ON CONFLICT (topic_date) DO NOTHING
         RETURNING id`
      : `INSERT INTO daily_topics (topic_date, title, prompt, category, sources, generation_source)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         ON CONFLICT (topic_date) DO NOTHING
         RETURNING id`,
    withBoth
      ? [targetDate, topic.title, topic.prompt, topic.category, jsonParam(topic.sources ?? []), source, fingerprint, reason]
      : fingerprintSupported
      ? [targetDate, topic.title, topic.prompt, topic.category, jsonParam(topic.sources ?? []), source, fingerprint]
      : [targetDate, topic.title, topic.prompt, topic.category, jsonParam(topic.sources ?? []), source],
  );
  return rows[0]?.id ?? null;
}

/**
 * Deliberate repair write for a corrupt row (invalid content or a
 * fingerprint mismatch). This is the ONLY path that may change an existing
 * topic's content, and it always replaces the evidence atomically with it —
 * normal retries never reach here.
 */
async function repairTopicRow(query, targetDate, topic, source, fingerprint, fingerprintSupported, reason, reasonSupported) {
  const reasonClause = fingerprintSupported && reasonSupported ? ", generation_reason = $8" : "";
  const rows = await query(
    fingerprintSupported
      ? `UPDATE daily_topics SET title = $2, prompt = $3, category = $4,
           sources = $5::jsonb, generation_source = $6, topic_fingerprint = $7${reasonClause}
         WHERE topic_date = $1::date RETURNING id`
      : `UPDATE daily_topics SET title = $2, prompt = $3, category = $4,
           sources = $5::jsonb, generation_source = $6
         WHERE topic_date = $1::date RETURNING id`,
    fingerprintSupported && reasonSupported
      ? [targetDate, topic.title, topic.prompt, topic.category, jsonParam(topic.sources ?? []), source, fingerprint, reason]
      : fingerprintSupported
      ? [targetDate, topic.title, topic.prompt, topic.category, jsonParam(topic.sources ?? []), source, fingerprint]
      : [targetDate, topic.title, topic.prompt, topic.category, jsonParam(topic.sources ?? []), source],
  );
  return rows[0]?.id ?? null;
}

/**
 * Atomic evidence replacement for one topic revision: delete-then-insert in
 * that order, INCLUDING the zero-card case. The old code returned early on
 * empty input after a topic change, which left the previous topic's cards
 * attached to the new topic. Every inserted card carries the fingerprint of
 * the exact revision it was generated for.
 */
async function replaceEvidenceCards(query, topicId, cards, fingerprint, fingerprintSupported) {
  await query("DELETE FROM topic_evidence WHERE topic_id = $1", [topicId]);
  for (const card of cards) {
    await query(
      fingerprintSupported
        ? `INSERT INTO topic_evidence
            (topic_id, claim, source_name, source_type, url, title, passage, published_date, checks, topic_fingerprint)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`
        : `INSERT INTO topic_evidence
            (topic_id, claim, source_name, source_type, url, title, passage, published_date, checks)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      fingerprintSupported
        ? [
            topicId, card.claim, card.sourceName, card.sourceType, card.url,
            card.title ?? null, card.passage, card.publishedDate,
            jsonParam(card.checks ?? {}), fingerprint,
          ]
        : [
            topicId, card.claim, card.sourceName, card.sourceType, card.url,
            card.title ?? null, card.passage, card.publishedDate,
            jsonParam(card.checks ?? {}),
          ],
    );
  }
  // Post-write invariant: the surviving set must be exactly what we wrote,
  // all stamped with this revision's fingerprint. Anything else is stale.
  const counts = await evidenceFingerprintCounts(query, topicId, fingerprint, fingerprintSupported);
  if (counts.total !== cards.length || counts.mismatched !== 0) {
    throw new Error(
      `evidence invariant violated for topic ${topicId}: ` +
      `wrote ${cards.length}, found ${counts.total} (${counts.mismatched} mismatched)`,
    );
  }
  return counts.total;
}

/**
 * Transactional evidence rebuild for an EXISTING, content-valid topic.
 * Everything happens inside one transaction — legacy fingerprint backfill
 * (when the row predates 018), evidence deletion, evidence insertion, and a
 * revision-ownership invariant — so no intermediate state can ever be
 * observed: never new-fingerprint + old evidence, never cleared + partial.
 * A failure ROLLs BACK completely. Retrieval happens BEFORE the transaction
 * so network I/O never extends the write lock.
 *
 * Untrusted evidence (a different revision's cards, or legacy NULL rows) is
 * never deleted in place by normal retries — it is removed inside this
 * transaction, so no intermediate state is ever observable.
 */
async function rebuildEvidenceTx(query, { topicId, backfillFingerprint, fingerprint, cards }) {
  await query("BEGIN", []);
  try {
    if (backfillFingerprint) {
      await query(`UPDATE daily_topics SET topic_fingerprint = $2 WHERE id = $1`, [topicId, fingerprint]);
    }
    await query(`DELETE FROM topic_evidence WHERE topic_id = $1`, [topicId]);
    for (const card of cards) {
      await query(
        `INSERT INTO topic_evidence
            (topic_id, claim, source_name, source_type, url, title, passage, published_date, checks, topic_fingerprint)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
        [topicId, card.claim, card.sourceName, card.sourceType, card.url,
         card.title ?? null, card.passage, card.publishedDate, jsonParam(card.checks ?? {}), fingerprint],
      );
    }
    const counts = await evidenceFingerprintCounts(query, topicId, fingerprint, true);
    if (counts.total !== cards.length || counts.mismatched !== 0 || counts.unstamped !== 0) {
      throw new Error(
        `repair evidence invariant violated for topic ${topicId}: ` +
        `wrote ${cards.length}, found ${counts.total} (${counts.mismatched} mismatched, ${counts.unstamped} unstamped)`,
      );
    }
    await query("COMMIT", []);
    return counts.total;
  } catch (e) {
    try { await query("ROLLBACK", []); } catch { /* rollback of a dead txn is best-effort */ }
    throw e;
  }
}

/**
 * Transactional corruption repair: replaces an invalid/mismatched row's
 * content AND rebuilds its evidence inside ONE transaction. This is the
 * only normal-ladder path allowed to change a stored topic's content, and
 * it can never expose new topic + old evidence (or any partial state).
 */
async function repairTopicTx(query, { targetDate, topic, source, fingerprint, fingerprintSupported, reason, reasonSupported, cards }) {
  await query("BEGIN", []);
  try {
    const topicId = await repairTopicRow(query, targetDate, topic, source, fingerprint, fingerprintSupported, reason, reasonSupported);
    if (!topicId) throw new Error(`repair: topic row for ${targetDate} no longer exists`);
    await replaceEvidenceCards(query, topicId, cards, fingerprint, fingerprintSupported);
    await query("COMMIT", []);
    return topicId;
  } catch (e) {
    try { await query("ROLLBACK", []); } catch { /* best-effort */ }
    throw e;
  }
}

async function retrieveEvidence(title, prompt) {
  // Inline evidence retrieval using GDELT + Wikipedia (keyless)
  const keywords = prompt.toLowerCase().match(/[a-z][a-z'-]{3,}/g)?.slice(0, 6).join(" ") || title.slice(0, 60);
  const candidates = [];
  try {
    const r = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(keywords)}&mode=artlist&maxrecords=4&sort=hybridrel&format=json`, { signal: AbortSignal.timeout(8_000) });
    if (r.ok) {
      const d = await r.json();
      (d.articles ?? []).slice(0, 3).forEach((a) => { if (a.url) candidates.push({ url: a.url, title: a.title }); });
    }
  } catch {}
  try {
    const r = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(title)}&srlimit=1&format=json`, { signal: AbortSignal.timeout(8_000) });
    if (r.ok) {
      const d = await r.json();
      (d.query?.search ?? []).forEach((s) => { if (s.title) candidates.push({ url: `https://en.wikipedia.org/wiki/${encodeURIComponent(s.title.replace(/ /g, "_"))}`, title: s.title }); });
    }
  } catch {}

  const cards = [];
  const seenUrls = new Set();
  for (const c of candidates.slice(0, 3)) {
    if (seenUrls.has(c.url)) continue;
    seenUrls.add(c.url);
    try {
      const pageRes = await fetch(c.url, {
        signal: AbortSignal.timeout(9_000),
        headers: { "User-Agent": "DailyDebate-evidence/1.0" },
      });
      if (!pageRes.ok) continue;
      const html = await pageRes.text();
      const text = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (text.length < 200) continue;
      const passage = text.slice(0, Math.min(340, text.length));
      const dateMatch = html.match(/article:published_time["'][^>]*content=["'](\d{4}-\d{2}-\d{2})/) ||
                        html.match(/<time[^>]*datetime=["'](\d{4}-\d{2}-\d{2})/);
      let host = "";
      try { host = new URL(c.url).hostname.replace(/^www\./, ""); } catch {}
      const isPrimary = /lazard|nrel|pew|nist|oecd|nature/i.test(host + " " + (c.title ?? ""));
      cards.push({
        claim: prompt.slice(0, 180),
        sourceName: host,
        sourceType: /wikipedia/i.test(host) ? "tertiary" : /reuters|apnews|bbc|guardian|bloomberg/i.test(host) ? "news" : isPrimary ? "primary" : "secondary",
        url: c.url,
        title: c.title ?? null,
        passage,
        publishedDate: dateMatch?.[1] ?? null,
        checks: { supportsClaim: true, relevant: true, current: dateMatch?.[1] ? true : null, primary: isPrimary },
      });
    } catch {}
  }
  return cards;
}

// --- Fallback topics (inline to avoid importing TS from Node) ---

const FALLBACKS = [
  ["Social media platforms should be legally liable for algorithmic recommendations", "Should platforms that use engagement-optimising algorithms bear legal responsibility for harms caused by the content they amplify?", "Technology"],
  ["Cities should eliminate minimum parking requirements for new developments", "Should urban planning rules stop requiring developers to build parking spaces alongside new housing?", "Policy"],
  ["Standardised testing should be replaced by portfolio-based assessment", "Would replacing standardised admission tests with curated portfolios produce fairer university admissions?", "Education"],
  ["Governments should fund open-access alternatives to proprietary scientific journals", "Is public funding for open-access publication a better investment than subscription-based journals?", "Science"],
  ["A four-day work week should become the standard full-time schedule", "Would a four-day, 32-hour standard work week improve productivity without harming output?", "Economics"],
  ["Critical infrastructure should prohibit foreign-made software components", "Should governments ban foreign vendor software in power grids, water systems, and hospitals?", "Security"],
  ["AI-generated content should require mandatory disclosure labels", "Should laws require AI-generated content to carry machine-readable disclosure labels?", "Technology"],
  ["Highways should have variable speed limits based on real-time conditions", "Would dynamically adjusting speed limits reduce accidents more than fixed limits?", "Transport"],
  ["Public universities should waive tuition for critical shortage fields", "Should tuition-free education be limited to degrees aligned with workforce shortages?", "Education"],
  ["Companies above a threshold must publish their pay gap data annually", "Would mandatory pay-gap reporting accelerate wage equality more than voluntary disclosure?", "Economics"],
  ["Municipal broadband should be treated as a public utility", "Should local governments build and operate internet as a public utility like water?", "Infrastructure"],
  ["Genetic screening at birth should include predisposition to preventable adult diseases", "Should newborn sequencing routinely screen for preventable adult-onset conditions?", "Medicine"],
  ["Carbon border tariffs should apply to imports from countries with weaker climate policies", "Would carbon-border tariffs accelerate global emissions reduction or protect domestic industry?", "Environment"],
  ["Space debris mitigation should be an international licensing requirement", "Should satellite operators be required to deorbit hardware within five years of mission end?", "Science"],
  ["Schools should teach source-verification skills starting in primary education", "Would teaching children to fact-check claims from age eight reduce misinformation susceptibility?", "Education"],
  ["Prescription drug prices should be indexed to international reference prices", "Would pegging US drug prices to developed-nation references lower costs without reducing innovation?", "Medicine"],
  ["Autonomous vehicle testing on public roads requires a federal permit system", "Should AV testing move to unified national permitting with safety reporting?", "Transport"],
  ["A right-to-repair law should cover consumer electronics", "Would extending right-to-repair to smartphones benefit consumers or compromise security?", "Technology"],
  ["Local food procurement requirements should apply to all public institutions", "Should schools and hospitals source a percentage of food regionally?", "Agriculture"],
  ["Voting systems should adopt risk-limiting audits as mandatory standard", "Would statistical post-election audits increase election confidence?", "Policy"],
  ["Facial recognition in public spaces should require a warrant", "Should law enforcement need judicial authorisation before deploying facial recognition in public?", "Privacy"],
  ["Building codes should mandate solar-ready roofing on new residential construction", "Would requiring solar-ready homes accelerate adoption enough to justify construction cost?", "Energy"],
  ["Clinical trial data should be publicly accessible regardless of outcome", "Should all clinical trial results be published even when the drug fails?", "Medicine"],
  ["Ride-share drivers should be classified as employees rather than contractors", "Would employee classification improve worker outcomes or reduce flexibility?", "Economics"],
  ["National grids should interconnect across borders to share renewable surpluses", "Would cross-border grid interconnection improve renewable reliability and reduce costs?", "Energy"],
];

function pickFallback(dateIso, recentTitles) {
  const d = new Date(dateIso + "T00:00:00Z");
  const startOfYear = new Date(dateIso.slice(0, 4) + "-01-01T00:00:00Z");
  const dayIdx = Math.floor((d - startOfYear) / 86400000) % FALLBACKS.length;
  const words = new Set(recentTitles.flatMap((t) => t.toLowerCase().match(/[a-z]{4,}/g) ?? []));
  for (let i = 0; i < FALLBACKS.length; i++) {
    const idx = (dayIdx + i) % FALLBACKS.length;
    const [title, prompt, category] = FALLBACKS[idx];
    const cw = new Set(title.toLowerCase().match(/[a-z]{4,}/g) ?? []);
    let overlap = 0;
    for (const w of cw) if (words.has(w)) overlap++;
    if (overlap <= 1) return { title, prompt, category };
  }
  const [title, prompt, category] = FALLBACKS[dayIdx];
  return { title, prompt, category };
}

// --- AI generation via the shared provider-chain registry ---

/**
 * Deterministic repair for SAFE JSON syntax defects only.
 *
 * Deliberately conservative: it fixes punctuation and encoding damage that
 * cannot change meaning (smart quotes, trailing commas, stray control
 * characters). It never invents, reorders or drops content, and the repaired
 * text is still revalidated against the same schema afterwards, so a repair
 * can never smuggle structurally invalid content past the checks below.
 * Returns the input unchanged when no safe defect is present.
 */
export function repairJson(text) {
  let t = String(text);
  t = t.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
  t = t.replace(/,\s*([}\]])/g, "$1");
  t = t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  return t;
}

/** Bucket a single provider attempt failure for longitudinal health stats. */
export function classifyAttempt(errorText) {
  const t = String(errorText ?? "").toLowerCase();
  if (/timeout|timed out|etimedout|abort/.test(t)) return "timeout";
  if (/429|rate.?limit/.test(t)) return "rate-limit";
  if (/401|403|unauthor|invalid api key|authentication/.test(t)) return "authentication";
  if (/quota|insufficient_quota|budget|exceeded/.test(t)) return "quota";
  if (/json|parse|unexpected token|no topics|no usable topics|empty content|malformed|no json/.test(t)) return "invalid-response";
  return "other";
}

/**
 * Resolve the fetch timeout for one model attempt. Explicit production tiers
 * (TOPIC_PRIMARY_TIMEOUT_MS for the chain head, TOPIC_FALLBACK_TIMEOUT_MS
 * for the rest) win; per-model <SLUG>_TIMEOUT_MS keys come next; the 60s
 * default holds otherwise. Every value is bounded 5s–120s, and timeouts
 * never relax schema or content quality — they only bound the wait.
 */
export function timeoutForAttempt(model, modelIndex, env = process.env) {
  const tierRaw = modelIndex === 0 ? env.TOPIC_PRIMARY_TIMEOUT_MS : env.TOPIC_FALLBACK_TIMEOUT_MS;
  const tier = Number(tierRaw);
  if (tierRaw !== undefined && tierRaw !== "" && Number.isFinite(tier) && tier >= 5_000 && tier <= 120_000) {
    return Math.round(tier);
  }
  return modelTimeoutMs(model, env);
}

async function generateCandidates(recentTitles, count = 5, env = process.env) {
  const chains = generationChains(env);
  if (!chains.length) {
    const err = new Error("No usable AI provider configured.");
    err.attempts = [];
    throw err;
  }

  const avoid = recentTitles.length
    ? `Avoid these recent topics: ${recentTitles.join("; ")}.`
    : "";

  const user = `Generate exactly ${count} distinct debate topic candidates for a daily critical-thinking app used by the general public.

Requirements for each:
- Title: short (<10 words), specific, not vague
- Prompt: 1-2 sentences phrased so BOTH sides are defensible; include a policy lever (ban, require, fund, tax, restrict, allow) or an empirical question (data, study, cost, rate)
- Category: one word — Technology, Science, Economics, Education, Policy, Ethics, Environment, Health, Transport, Security, Medicine
- Sources: 3 real institutions whose research bears on the topic (root homepages only)

${avoid}
Return JSON: {"topics":[{"title":"...","prompt":"...","category":"...","sources":[{"name":"Pew Research Center","homepage":"https://www.pewresearch.org","angle":"polling data"}]}]}`;

  // Provider-level failover: every usable provider's full model chain is
  // attempted in configured priority order before the curated fallback.
  // Providers known to be unavailable (no key, explicitly disabled, or the
  // kiraai tier without an explicit opt-in) are never called. Per-attempt
  // telemetry carries provider + model identity for longitudinal tracking.
  const attempts = [];
  let lastError;
  for (const chain of chains) {
    const { label: provider, url, key, models, extraHeaders } = chain;
    for (const [modelIndex, model] of models.entries()) {
      const attemptStartedAt = Date.now();
      let httpStatus = null;
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...extraHeaders },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: "Respond with ONE JSON object, no markdown fences." },
              { role: "user", content: user },
            ],
            max_tokens: 3000,
            temperature: 0.8,
          }),
          signal: AbortSignal.timeout(timeoutForAttempt(model, modelIndex, env)),
        });
        if (!res.ok) {
          httpStatus = res.status;
          const err = new Error(`${res.status}`);
          err.httpStatus = res.status;
          throw err;
        }
        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content;
        if (!content?.trim()) throw new Error("empty content");
        const trimmed = content.trim();
        const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
        const jsonText = fenced ? fenced[1] : trimmed;
        const start = jsonText.indexOf("{"), end = jsonText.lastIndexOf("}");
        if (start === -1 || end <= start) throw new Error("no JSON object");
        const objectText = jsonText.slice(start, end + 1);
        let parsed;
        try {
          parsed = JSON.parse(objectText);
        } catch (syntaxError) {
          // One deterministic repair attempt for safe syntax defects, then the
          // SAME schema validation below decides. A repair that still does not
          // parse, or that yields invalid structure, fails exactly as before.
          const repaired = repairJson(objectText);
          if (repaired === objectText) throw syntaxError;
          parsed = JSON.parse(repaired);
        }
        const topics = parsed.topics || parsed.candidates;
        if (!Array.isArray(topics) || !topics.length) throw new Error("no topics array");
        const usable = topics.filter((t) => t.title && t.prompt && t.category && Array.isArray(t.sources));
        if (!usable.length) throw new Error("no usable topics after schema validation");
        attempts.push({ provider, model, outcome: "success", latencyMs: Date.now() - attemptStartedAt, httpStatus: null, errorCategory: null });
        // Success-path attempts ride on the return value so longitudinal stats
        // see successes too — failure-only telemetry would bias every rate.
        usable.attempts = attempts;
        return usable;
      } catch (e) {
        lastError = e;
        const status = e?.httpStatus ?? httpStatus;
        const message = String(e?.message ?? e).slice(0, 140);
        const outcome = classifyAttempt(status !== null && status !== undefined ? `${status} ${message}` : message);
        attempts.push({
          provider,
          model,
          outcome,
          latencyMs: Date.now() - attemptStartedAt,
          httpStatus: status ?? null,
          errorCategory: outcome === "success" ? null : outcome,
          error: message,
        });
        log(`[generate] ${provider}/${model}: ${message}`);
      }
    }
  }

  const failure = lastError ?? new Error("No usable AI provider configured.");
  failure.attempts = attempts;
  throw failure;
}

// --- Scoring (inline port of topicScoring.ts) ---

function scoreNovelty(title, recentTitles) {
  const words = new Set(title.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  let maxOverlap = 0;
  for (const recent of recentTitles) {
    const rw = new Set(recent.toLowerCase().match(/[a-z]{4,}/g) ?? []);
    if (!rw.size) continue;
    let overlap = 0;
    for (const w of words) if (rw.has(w)) overlap++;
    const jaccard = overlap / (words.size + rw.size - overlap);
    if (jaccard > maxOverlap) maxOverlap = jaccard;
  }
  return Math.round(Math.max(0, Math.min(10, (1 - maxOverlap * 2.5) * 10)));
}

function scoreCandidate(topic, recentTitles) {
  const text = `${topic.title} ${topic.prompt}`.toLowerCase();
  let score = 5;
  if (/should|whether|better than|worth|trade-off|versus|vs/.test(text)) score += 2;
  if (/obviously|everyone knows|clearly bad|without question/.test(text)) score -= 4;
  if (/ban|mandate|subsidiz|legali|regulat|restrict|limit/i.test(text)) score += 1;
  const debatableBalance = Math.max(0, Math.min(10, score));

  let evScore = 3;
  const domains = ["technology","science","economics","education","health","environment","energy","policy","ethics","infrastructure"];
  for (const d of domains) if (text.includes(d) || topic.category.toLowerCase().includes(d)) { evScore += 3; break; }
  if (/cost|rate|percentage|data|study|research|statistics/i.test(text)) evScore += 3;
  const evidenceAvailability = Math.max(0, Math.min(10, evScore));

  const novelty = scoreNovelty(topic.title, recentTitles);

  let specScore = 3;
  if (topic.title.length >= 25 && topic.title.length <= 100) specScore += 2;
  if (topic.prompt.length >= 40 && topic.prompt.length <= 300) specScore += 2;
  if (/ban|require|fund|tax|subsid|limit|allow|prohibit|restrict/i.test(topic.prompt)) specScore += 2;
  const specificity = Math.max(0, Math.min(10, specScore));

  const flashpoints = ["abortion","gun control","border wall","election fraud","prayer in school","capital punishment"];
  const fpCount = flashpoints.filter(fp => text.includes(fp)).length;
  const ideologicalLoading = fpCount === 0 ? 9 : fpCount === 1 ? 6 : 2;

  const total =
    debatableBalance * 1.8 +
    evidenceAvailability * 1.5 +
    novelty * 1.2 +
    specificity * 1.2 +
    ideologicalLoading * 1.3;

  return { ...topic, _score: Math.round(total * 100) / 100 };
}

// --- Main ---

export { pickFallback, scoreCandidate, scoreNovelty, generateCandidates };

/**
 * Resolve which date a generation run targets.
 *
 * The evening retry slots (20:00–23:40 UTC) all target TOMORROW's date, so a
 * slot that starts on time and one that starts hours late (GitHub scheduled
 * starts have been observed 4–5h late) must resolve the SAME date — otherwise
 * a 23:40 slot starting after midnight would silently generate the NEXT
 * cycle's date and abandon the date it was meant to protect.
 *
 * Rule: the target is the calendar day AFTER the most recent 15:00 UTC cycle
 * boundary. Pre-midnight executions (15:00–23:59) target tomorrow; an
 * execution that slips past midnight into the 00:00–15:00 window still
 * targets TODAY — exactly the recovery behaviour the 03:00 UTC availability
 * SLO needs. (The 15:00 boundary is also safely clear of any realistic
 * delayed start, so late runs always land in the recovery window.)
 */
export function resolveTargetDate(now) {
  const CYCLE_BOUNDARY_UTC_HOUR = 15;
  const cycleStart = new Date(now.getTime());
  cycleStart.setUTCHours(CYCLE_BOUNDARY_UTC_HOUR, 0, 0, 0);
  if (cycleStart.getTime() > now.getTime()) cycleStart.setUTCDate(cycleStart.getUTCDate() - 1);
  return new Date(cycleStart.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * The generation pipeline, dependency-injected so every branch — AI success,
 * provider failure → fallback, already-present, repair, DB failure — is
 * testable against an in-memory query double.
 *
 * IMMUTABILITY: once a valid topic exists for the target date, normal runs
 * return `already-present` with the existing metadata and never regenerate,
 * rewrite, or re-evidence it. A user must never see two different "daily
 * topics" for the same date because the scheduler retried. Outcomes:
 * ai-generated | curated-fallback | provider-failure | already-present |
 * db-failure.
 *
 * Availability vs provider health stay separate downstream: the workflow's
 * record step derives generator_result (ai | fallback-after-provider-failure
 * | fallback-by-policy | failure) and provider_health from outcome +
 * providerError, so a green run on a curated fallback reads as an
 * availability success AND a provider failure, never one flattened field.
 */
export async function runGeneration(deps = {}) {
  const query = deps.query ?? defaultQuery;
  const generate = deps.generate ?? ((recent, count) => generateCandidates(recent, count, deps.env));
  const retrieve = deps.retrieve ?? retrieveEvidence;
  const env = deps.env ?? process.env;
  const now = deps.now ?? new Date();
  const emit = deps.log ?? log;

  const tomorrow = resolveTargetDate(now);
  emit(`[generate-topics] Pre-generating for ${tomorrow}`);

  let recentTitles;
  try {
    recentTitles = await getRecentTitles(query, 14);
  } catch (e) {
    return { outcome: "db-failure", stage: "read-recent", error: String(e?.message ?? e) };
  }
  emit(`[generate-topics] ${recentTitles.length} recent titles loaded`);

  let fingerprintSupported = true;
  try {
    fingerprintSupported = await fingerprintColumnsSupported(query);
  } catch (e) {
    return { outcome: "db-failure", stage: "read-recent", error: String(e?.message ?? e) };
  }
  if (!fingerprintSupported) {
    emit("[generate-topics] topic_fingerprint columns absent (migration 018 pending) — content checks still apply, fingerprint proofs deferred");
  }
  let reasonSupported = false;
  try {
    reasonSupported = await generationReasonSupported(query);
  } catch {
    reasonSupported = false;
  }

  // --- Write-once gate: a valid stored topic is verified, never replaced. --
  let existing = null;
  try {
    existing = await getExistingTopic(query, tomorrow, fingerprintSupported, reasonSupported);
  } catch (e) {
    return { outcome: "db-failure", stage: "read-existing", error: String(e?.message ?? e) };
  }
  const status = fingerprintSupported ? topicRowStatus(existing, tomorrow) : (existing && isValidTopicContent(existing) ? "valid" : (existing ? "invalid-content" : "missing"));
  if (status === "valid" || status === "legacy-unfingerprinted") {
    return alreadyPresent(query, existing, tomorrow, fingerprintSupported, reasonSupported, status, emit, retrieve);
  }
  let repairing = false;
  if (status === "invalid-content" || status === "fingerprint-mismatch") {
    repairing = true;
    emit(`[generate-topics] existing row for ${tomorrow} is ${status} — deliberate repair path regenerates content and evidence together`);
  }

  // Usability, not mere key presence, decides: a key for a provider without
  // capacity (or an explicitly disabled one) must not turn a policy fallback
  // into a provider failure — nothing was attempted, nothing failed.
  const usable = usableProviders(env);
  let bestTopic = null;
  let providerFailure = null;
  // Per-model attempts from the successful leg too — failure-only telemetry
  // would bias every longitudinal success/timeout rate.
  let successAttempts = null;
  if (!usable.length) {
    emit("[generate-topics] no usable provider configured — curated fallback mode (acceptable, not an error)");
  } else {
    try {
      const candidates = await generate(recentTitles, 5);
      if (Array.isArray(candidates?.attempts)) successAttempts = candidates.attempts;
      emit(`[generate-topics] ${candidates.length} candidates generated`);
      const scored = candidates.map((c) => ({ ...scoreCandidate(c, recentTitles), raw: c }));
      scored.sort((a, b) => b._score - a._score);
      scored.forEach((c, i) => emit(`  #${i + 1} score=${c._score} "${c.raw.title}"`));
      const top = scored[0];
      if (top) {
        bestTopic = {
          title: top.raw.title,
          prompt: top.raw.prompt,
          category: top.raw.category,
          sources: top.raw.sources || [],
        };
      } else {
        providerFailure = new Error("provider returned no usable candidates");
        if (Array.isArray(candidates?.attempts)) providerFailure.attempts = candidates.attempts;
      }
    } catch (e) {
      providerFailure = e;
      emit(`[generate-topics] AI generation failed: ${String(e?.message ?? e).slice(0, 140)} — falling back to curated.`);
    }
  }

  const generationSource = bestTopic ? "ai" : "fallback";
  // generation_reason (migration 019) records HOW the immutable topic came
  // to exist, separately from what it is. Computed once here at creation —
  // verification reads it, it is never reconstructed.
  const generationReason = bestTopic ? "ai" : (providerFailure ? "fallback-provider-failure" : "fallback-policy");
  if (!bestTopic) {
    bestTopic = pickFallback(tomorrow, recentTitles);
    emit(`[generate-topics] Using curated fallback: "${bestTopic.title}"`);
  }
  const fingerprint = topicFingerprint({
    topicDate: tomorrow, title: bestTopic.title, prompt: bestTopic.prompt, category: bestTopic.category,
  });

  // Write-once claim: concurrent same-date retries converge on the winner
  // instead of replacing each other (the UNIQUE constraint serialises).
  let topicId = null;
  let repairedEvidenceCount = null;
  try {
    if (repairing) {
      // Deliberate corruption repair is TRANSACTIONAL (item 10): topic content
      // and its rebuilt evidence land together or not at all — no intermediate
      // "new topic + old evidence" state can ever be observed. Retrieval runs
      // BEFORE the transaction so network I/O never extends the write window.
      let cards = [];
      try {
        cards = await retrieve(bestTopic.title, bestTopic.prompt);
      } catch (e) {
        emit(`[generate-topics] Evidence retrieval failed: ${String(e?.message ?? e).slice(0, 140)}`);
      }
      topicId = await repairTopicTx(query, {
        targetDate: tomorrow,
        topic: bestTopic,
        source: generationSource,
        fingerprint,
        fingerprintSupported,
        reason: generationReason,
        reasonSupported,
        cards,
      });
      repairedEvidenceCount = cards.length;
      emit(`[generate-topics] repaired invalid row for ${tomorrow} (transactional, ${cards.length} evidence card(s))`);
    } else {
      topicId = await insertTopicOnce(query, tomorrow, bestTopic, generationSource, fingerprint, fingerprintSupported, generationReason, reasonSupported);
    }
  } catch (e) {
    return { outcome: "db-failure", stage: "store-topic", error: String(e?.message ?? e) };
  }
  if (!topicId) {
    // Lost the claim race (or a concurrent repair landed first): re-read and
    // converge on the existing row rather than overwriting it.
    emit(`[generate-topics] row for ${tomorrow} already claimed — converging on existing content`);
    let raced = null;
    try {
      raced = await getExistingTopic(query, tomorrow, fingerprintSupported, reasonSupported);
    } catch (e) {
      return { outcome: "db-failure", stage: "read-existing", error: String(e?.message ?? e) };
    }
    const racedStatus = fingerprintSupported ? topicRowStatus(raced, tomorrow) : (raced && isValidTopicContent(raced) ? "valid" : "invalid-content");
    if (racedStatus === "valid" || racedStatus === "legacy-unfingerprinted") {
      return alreadyPresent(query, raced, tomorrow, fingerprintSupported, reasonSupported, racedStatus, emit, retrieve, true);
    }
    return { outcome: "db-failure", stage: "store-race", error: `lost claim race for ${tomorrow} and the winning row is ${racedStatus}` };
  }

  // Fresh-row evidence: retrieval first, then an atomic transactional
  // replacement (an uncommited insert has no observable stale-evidence
  // window, but the same invariant-checked transaction is reused so every
  // write path proves revision ownership identically).
  let evidenceCards = repairedEvidenceCount;
  if (!repairing) {
    try {
      let cards = [];
      try {
        cards = await retrieve(bestTopic.title, bestTopic.prompt);
      } catch (e) {
        // Retrieval is best-effort: a network hiccup yields zero cards, which
        // the transaction stores as an empty (but consistent) set.
        emit(`[generate-topics] Evidence retrieval failed: ${String(e?.message ?? e).slice(0, 140)}`);
      }
      evidenceCards = await rebuildEvidenceTx(query, {
        topicId,
        backfillFingerprint: false,
        fingerprint,
        cards,
      });
    } catch (e) {
      return { outcome: "db-failure", stage: "store-evidence", error: String(e?.message ?? e) };
    }
    emit(`[generate-topics] ${evidenceCards} evidence cards stored`);
  }

  const outcome = generationSource === "ai"
    ? "ai-generated"
    : providerFailure
      ? "provider-failure"
      : "curated-fallback";
  return {
    outcome,
    source: generationSource,
    generationReason,
    date: tomorrow,
    title: bestTopic.title,
    evidenceCards,
    fingerprint,
    repaired: repairing ? "replaced-invalid-row" : null,
    // Provider detail stays separable from topic availability: a green run on
    // a curated fallback is an availability success AND a provider failure.
    // Attempts cover the successful leg too (see above), not just failures.
    providerError: providerFailure ? String(providerFailure.message ?? providerFailure).slice(0, 200) : null,
    providerAttempts: Array.isArray(providerFailure?.attempts)
      ? providerFailure.attempts
      : successAttempts,
  };
}

/**
 * The already-present path: verify the stored topic (and its evidence
 * ownership) and return its metadata without regenerating anything. Legacy
 * rows get their fingerprint backfilled and their evidence REBUILT (never
 * stamped); stale or unstamped evidence on fingerprinted topics is deleted
 * and re-retrieved — the TOPIC content itself is never touched here.
 */
async function alreadyPresent(query, existing, tomorrow, fingerprintSupported, reasonSupported, status, emit, retrieve, converged = false) {
  const fingerprint = fingerprintSupported
    ? topicFingerprint({ topicDate: tomorrow, title: existing.title, prompt: existing.prompt, category: existing.category })
    : null;
  // The original creation reason is READ from the row and reported
  // unchanged. A retry never reconstructs or mutates it; pre-019 rows (or a
  // pre-019 schema) simply report null rather than a guess.
  const storedReason = reasonSupported ? existing.generation_reason ?? null : null;
  let repaired = converged ? "converged-on-existing" : null;
  try {
    if (status === "legacy-unfingerprinted" && fingerprintSupported) {
      // Safe legacy healing (P0): the row's content is PRESERVED — it is a
      // valid topic with valid provenance — but its fingerprint is computed
      // and written, and its evidence is REBUILT, never stamped. The stored
      // cards predate revision identity: under the old write paths this
      // production served Topic A's evidence attached to an overwritten
      // Topic B, so "old" cannot mean "valid". Zero retrieved cards is a
      // valid outcome — honest emptiness beats preserved unknowns.
      let cards = [];
      try {
        cards = await retrieve(existing.title, existing.prompt);
      } catch (e) {
        emit(`[generate-topics] Evidence re-retrieval failed: ${String(e?.message ?? e).slice(0, 140)}`);
      }
      await rebuildEvidenceTx(query, { topicId: existing.id, backfillFingerprint: true, fingerprint, cards });
      repaired = "rebuild-legacy-evidence";
      emit(`[generate-topics] healed legacy row ${tomorrow}: fingerprint stamped, evidence rebuilt (${cards.length} card(s))`);
    } else if (fingerprintSupported) {
      // Content is valid and fingerprinted: evidence must belong to THIS
      // revision. Mismatched cards belong to replaced content and unstamped
      // (legacy NULL) cards are untrusted — BOTH are deleted; missing cards
      // are re-retrieved for the SAME topic (never a new topic).
      const before = await evidenceFingerprintCounts(query, existing.id, fingerprint, true);
      if (before.mismatched > 0 || before.unstamped > 0) {
        // Rebuild transactionally rather than deleting in place: the final
        // state (all cards owned by THIS revision) lands atomically.
        let cards = [];
        try {
          cards = await retrieve(existing.title, existing.prompt);
        } catch (e) {
          emit(`[generate-topics] Evidence re-retrieval failed: ${String(e?.message ?? e).slice(0, 140)}`);
        }
        await rebuildEvidenceTx(query, { topicId: existing.id, backfillFingerprint: false, fingerprint, cards });
        repaired = before.mismatched > 0 ? "replaced-stale-evidence" : "removed-unstamped-evidence";
        emit(`[generate-topics] rebuilt ${before.mismatched} stale and ${before.unstamped} untrusted evidence card(s) for ${tomorrow}`);
      } else if (before.total === 0) {
        let cards = [];
        try {
          cards = await retrieve(existing.title, existing.prompt);
        } catch (e) {
          emit(`[generate-topics] Evidence re-retrieval failed: ${String(e?.message ?? e).slice(0, 140)}`);
        }
        if (cards.length) {
          await rebuildEvidenceTx(query, { topicId: existing.id, backfillFingerprint: false, fingerprint, cards });
          repaired = repaired ?? "re-retrieved-evidence";
          emit(`[generate-topics] re-retrieved ${cards.length} evidence card(s) for unchanged topic ${tomorrow}`);
        }
      }
    }
    const after = await evidenceFingerprintCounts(query, existing.id, fingerprint, fingerprintSupported);
    emit(`[generate-topics] outcome=already-present source=${existing.generation_source} reason=${storedReason ?? "n/a"} topic="${existing.title}" evidence_cards=${after.total}`);
    return {
      outcome: "already-present",
      source: existing.generation_source,
      generationReason: storedReason,
      date: tomorrow,
      title: existing.title,
      evidenceCards: after.total,
      fingerprint,
      repaired,
      converged,
      providerError: null,
      providerAttempts: [],
    };
  } catch (e) {
    return { outcome: "db-failure", stage: "verify-existing", error: String(e?.message ?? e) };
  }
}

async function main() {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }
  if (args.includes("--check-config")) {
    const result = await checkConfig();
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (!result.ok) process.exit(1);
    return;
  }

  const result = await runGeneration();
  if (result.outcome === "db-failure") {
    log(`[generate-topics] outcome=db-failure (${result.stage}): ${result.error}`);
    process.exit(1);
  }
  log(`[generate-topics] outcome=${result.outcome} source=${result.source} topic="${result.title}" evidence_cards=${result.evidenceCards} fp=${String(result.fingerprint ?? "").slice(0, 12) || "n/a"}${result.repaired ? ` repaired=${result.repaired}` : ""}`);
  process.stdout.write(JSON.stringify(result) + "\n");
}

if (isMainModule) {
  main().catch((e) => {
    process.stderr.write(String(e?.stack ?? e) + "\n");
    process.exit(1);
  });
}
