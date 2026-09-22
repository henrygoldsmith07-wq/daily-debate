import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import pg from "pg";
import { topicFingerprint } from "../../scripts/generate-topics.mjs";

/**
 * REAL-POSTGRES tests for the strengthened freshness verifier: runs the
 * actual CLI (spawn, not mocks) against rows seeded for each case and
 * asserts the revision checks — fingerprint agreement, per-card revision
 * ownership, stale-card rejection, legacy strictness.
 *
 * This suite runs the evidence JOIN on a migrated schema, which is what
 * caught the ambiguous `topic_fingerprint` reference (both joined tables
 * carry the column): every case below executes that JOIN rather than
 * falling into the missing-column catch, proven by checks.evidenceCards.
 *
 * Skipped without TEST_DATABASE_URL + DATABASE_URL (CI e2e provisions both).
 */

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const d = databaseUrl && process.env.DATABASE_URL?.trim() ? describe : describe.skip;

const MIGRATIONS_DIR = fileURLToPath(new URL("../../database/migrations", import.meta.url));
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const VERIFY_SCRIPT = join(ROOT, "scripts", "verify-topic-stored.mjs");

let pool: pg.Pool;

const TOPIC = {
  title: "Cities should eliminate minimum parking requirements for new developments",
  prompt: "Should urban planning rules stop requiring developers to build parking spaces alongside new housing?",
  category: "Policy",
};

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL?.trim(), max: 4 });
  await pool.query("SELECT pg_advisory_lock(727293)");
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    await pool.query(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  await pool.query("SELECT pg_advisory_unlock(727293)");
});

afterAll(async () => {
  await pool.query("DELETE FROM topic_evidence WHERE topic_id IN (SELECT id FROM daily_topics WHERE topic_date >= '2026-10-01'::date)");
  await pool.query("DELETE FROM daily_topics WHERE topic_date >= '2026-10-01'::date");
  await pool.end();
});

beforeEach(async () => {
  await pool.query("DELETE FROM topic_evidence WHERE topic_id IN (SELECT id FROM daily_topics WHERE topic_date >= '2026-10-01'::date)");
  await pool.query("DELETE FROM daily_topics WHERE topic_date >= '2026-10-01'::date");
});

async function seedTopic(date: string, over: {
  title?: string; prompt?: string; category?: string; source?: string;
  fingerprint?: string | null; cards?: Array<{ fingerprint?: string | null }>;
} = {}) {
  const title = over.title ?? TOPIC.title;
  const prompt = over.prompt ?? TOPIC.prompt;
  const category = over.category ?? TOPIC.category;
  const fp = over.fingerprint === undefined
    ? topicFingerprint({ topicDate: date, title, prompt, category })
    : over.fingerprint;
  const { rows } = await pool.query(
    `INSERT INTO daily_topics (topic_date, title, prompt, category, sources, generation_source, generation_reason, topic_fingerprint)
     VALUES ($1, $2, $3, $4, '[]'::jsonb, $5, $6, $7) RETURNING id`,
    [date, title, prompt, category, over.source ?? "fallback", over.source === "ai" ? "ai" : "fallback-policy", fp],
  );
  const topicId = rows[0].id as string;
  for (const [i, card] of (over.cards ?? []).entries()) {
    await pool.query(
      `INSERT INTO topic_evidence (topic_id, claim, source_name, source_type, url, passage, topic_fingerprint)
       VALUES ($1, $2, 'NREL', 'primary', $3, 'passage', $4)`,
      [topicId, `claim ${i}`, `https://nrel.gov/${date}/${i}`, card.fingerprint === undefined ? fp : card.fingerprint],
    );
  }
  return { topicId, fingerprint: fp };
}

function runVerifier(date: string): {
  status: number;
  json: Record<string, unknown>;
  stderr: string;
} {
  try {
    const stdout = execFileSync(process.execPath, [VERIFY_SCRIPT, "--date", date], {
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL?.trim() ?? "" },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }) as unknown as string;
    return { status: 0, json: JSON.parse(stdout) as Record<string, unknown>, stderr: "" };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: unknown; stderr?: unknown };
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(String(err.stdout ?? "{}")) as Record<string, unknown>;
    } catch {
      json = {};
    }
    return {
      status: typeof err.status === "number" ? err.status : 1,
      json,
      // Captured so a failing assertion can distinguish "verifier rejected the
      // data" (failures JSON) from "verifier subprocess crashed" (empty JSON,
      // stack here) instead of hiding both behind `expected 1 to be +0`.
      stderr: String(err.stderr ?? ""),
    };
  }
}

d("freshness verifier (real Postgres)", () => {
  it("passes a valid fingerprinted topic with stamped evidence", async () => {
    const { fingerprint } = await seedTopic("2026-10-01", { cards: [{}, {}] });
    const { status, json, stderr } = runVerifier("2026-10-01");
    expect(
      status,
      `verifier exited ${status} — json: ${JSON.stringify(json)} stderr: ${stderr}`,
    ).toBe(0);
    expect(json.ok).toBe(true);
    const checks = json.checks as Record<string, unknown>;
    expect(checks.fingerprintValid).toBe(true);
    expect(checks.fingerprint).toBe(fingerprint);
    // The revision JOIN executed (not the missing-column fallback).
    expect(checks.evidenceCards).toBe(2);
    expect(checks.staleEvidence).toBe(0);
  });

  it("rejects stale evidence from a replaced revision", async () => {
    await seedTopic("2026-10-02", { cards: [{}, { fingerprint: "0".repeat(64) }] });
    const { status, json } = runVerifier("2026-10-02");
    expect(status).toBe(1);
    expect(json.ok).toBe(false);
    const failures = json.failures as string[];
    expect(failures.some((f) => /stale evidence/i.test(f))).toBe(true);
  });

  it("rejects a tampered title that breaks the recorded fingerprint", async () => {
    const { fingerprint } = await seedTopic("2026-10-03", { cards: [{}] });
    await pool.query("UPDATE daily_topics SET title = 'Tampered title' WHERE topic_date = '2026-10-03'::date");
    const { status, json } = runVerifier("2026-10-03");
    expect(status).toBe(1);
    expect(json.ok).toBe(false);
    const failures = json.failures as string[];
    expect(failures.some((f) => /fingerprint/i.test(f))).toBe(true);
    expect((json.checks as Record<string, unknown>).fingerprint).toBe(fingerprint);
  });

  it("rejects legacy rows without a fingerprint (backfill pending, not proven)", async () => {
    await seedTopic("2026-10-04", { fingerprint: null, cards: [{ fingerprint: null }] });
    const { status, json } = runVerifier("2026-10-04");
    expect(status).toBe(1);
    expect(json.ok).toBe(false);
  });

  it("passes a valid topic with zero evidence (bounded and consistent)", async () => {
    await seedTopic("2026-10-05", { cards: [] });
    const { status, json, stderr } = runVerifier("2026-10-05");
    expect(
      status,
      `verifier exited ${status} — json: ${JSON.stringify(json)} stderr: ${stderr}`,
    ).toBe(0);
    expect(json.ok).toBe(true);
    expect((json.checks as Record<string, unknown>).evidenceCards).toBe(0);
  });
});
