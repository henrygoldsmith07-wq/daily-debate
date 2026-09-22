import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createExecutor } from "../../scripts/lib/sql-executor.mjs";
import { checkConfig, topicFingerprint, jsonParam } from "../../scripts/generate-topics.mjs";

/**
 * LIVE NEON TRANSPORT contract (item 25): CI proves TCP Postgres behaviour
 * on every PR, but production speaks Neon HTTP, where each query() call is
 * its OWN session — "BEGIN"/"COMMIT" as separate statements would silently
 * not be a transaction. This suite re-runs the same guarantees against a
 * real Neon URL so the two transports are never assumed identical:
 *
 *   - JSONB serialization      (sources stays [], never {})
 *   - insert-ignore semantics  (ON CONFLICT DO NOTHING: row / zero rows)
 *   - transaction abstraction  (commit AND rollback actually atomic)
 *   - schema checks            (checkConfig probes over the HTTP surface)
 *   - fingerprint verification (recomputed SHA-256 identity matches)
 *   - evidence rebuild         (delete-then-insert inside the transaction)
 *
 * OPTIONAL: skipped unless NEON_TEST_DATABASE_URL is set, and it must point
 * at a SCRATCH Neon branch (the suite applies migrations and writes only
 * 2099-dated rows, cleaning up after itself). Never point it at production.
 * Runs via .github/workflows/neon-live.yml (manual/weekly), never on PRs.
 */

const neonUrl = process.env.NEON_TEST_DATABASE_URL?.trim();
const d =
  neonUrl && /neon\.(tech|build|new)/i.test(neonUrl) ? describe : describe.skip;

const MIGRATIONS_DIR = fileURLToPath(new URL("../../database/migrations", import.meta.url));

type QueryFn = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
interface Exec {
  (text: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  transaction: (fn: (tx: QueryFn) => Promise<unknown>) => Promise<unknown>;
}

let exec: Exec;

const DATE = "2099-08-01";
const CONTENT = {
  title: "Live transport canonical topic",
  prompt: "A live-transport prompt with enough complete words to be valid?",
  category: "Policy",
};
const FP = topicFingerprint({ topicDate: DATE, ...CONTENT });

async function cleanup() {
  await exec("DELETE FROM topic_evidence WHERE topic_id IN (SELECT id FROM daily_topics WHERE topic_date = $1::date)", [DATE]);
  await exec("DELETE FROM daily_topics WHERE topic_date = $1::date", [DATE]);
}

/** The canonical write-once SQL exactly as generate-topics issues it. */
async function insertOnce(q: QueryFn) {
  const rows = await q(
    `INSERT INTO daily_topics (topic_date, title, prompt, category, sources, generation_source, generation_reason, topic_fingerprint)
     VALUES ($1::date, $2, $3, $4, $5::jsonb, 'fallback', 'request-time-fallback', $6)
     ON CONFLICT (topic_date) DO NOTHING
     RETURNING id`,
    [DATE, CONTENT.title, CONTENT.prompt, CONTENT.category, jsonParam([]), FP],
  );
  return (rows[0] ?? undefined) as { id: string } | undefined;
}

beforeAll(async () => {
  exec = (await createExecutor(neonUrl as string)) as Exec;
  // Scratch branch may be empty: apply every migration over the HTTP surface.
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    await exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  await cleanup();
});

afterAll(async () => {
  await cleanup();
});

d("live Neon transport contract", () => {
  it("routes a Neon URL through the HTTP query surface and the config gate passes", async () => {
    const result = await checkConfig({ ...process.env, DATABASE_URL: neonUrl });
    expect(
      result.ok,
      `checkConfig failed on live Neon: ${result.reason}`,
    ).toBe(true);
    const checks = result.checks as unknown as Record<string, unknown>;
    expect(checks.database_reachable).toBe(true);
    expect(checks.topic_fingerprint_supported).toBe(true);
    expect(checks.generation_reason_supported).toBe(true);
    expect(checks.topic_date_unique).toBe(true);
  });

  it("JSONB round-trips sources as an array, never an object", async () => {
    await cleanup();
    expect(await readCount()).toBe(0);
    await exec(
      `INSERT INTO daily_topics (topic_date, title, prompt, category, sources, generation_source, generation_reason, topic_fingerprint)
       VALUES ($1::date, $2, $3, $4, $5::jsonb, 'ai', 'ai', $6)`,
      [DATE, CONTENT.title, CONTENT.prompt, CONTENT.category, jsonParam([]), FP],
    );
    const rows = await exec("SELECT sources FROM daily_topics WHERE topic_date = $1::date", [DATE]);
    const sources = rows[0].sources;
    expect(Array.isArray(sources)).toBe(true); // '{}' (an object) would FAIL here
    expect(sources).toEqual([]);
  });

  it("insert-ignore: first claim inserts, conflict returns zero rows without an error", async () => {
    await cleanup();
    const first = await insertOnce(exec);
    expect(first?.id).toBeTruthy();
    const second = await insertOnce(exec); // conflict -> DO NOTHING
    expect(second).toBeUndefined(); // no throw, no row: caller re-reads the winner
    const rows = await exec("SELECT title, topic_fingerprint FROM daily_topics WHERE topic_date = $1::date", [DATE]);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe(CONTENT.title); // never overwritten
    expect(rows[0].topic_fingerprint).toBe(FP);
  });

  it("transaction COMMIT makes topic + rebuilt evidence visible atomically", async () => {
    await cleanup();
    await exec.transaction(async (tx) => {
      const rows = await tx(
        `INSERT INTO daily_topics (topic_date, title, prompt, category, sources, generation_source, generation_reason, topic_fingerprint)
         VALUES ($1::date, $2, $3, $4, $5::jsonb, 'ai', 'ai', $6) RETURNING id`,
        [DATE, CONTENT.title, CONTENT.prompt, CONTENT.category, jsonParam([]), FP],
      );
      const topicId = (rows[0] as { id: string }).id;
      await tx("DELETE FROM topic_evidence WHERE topic_id = $1", [topicId]);
      for (const i of [1, 2]) {
        await tx(
          `INSERT INTO topic_evidence (topic_id, claim, source_name, source_type, url, passage, topic_fingerprint)
           VALUES ($1, $2, 'nrel', 'primary', $3, 'passage', $4)`,
          [topicId, `live claim ${i}`, `https://nrel.gov/live/${i}`, FP],
        );
      }
    });
    // Separate HTTP session (NOT the transaction session) sees everything.
    const evidence = await exec(
      "SELECT count(*)::int AS n FROM topic_evidence te JOIN daily_topics d ON d.id = te.topic_id WHERE d.topic_date = $1::date",
      [DATE],
    );
    expect(evidence[0].n).toBe(2);
  });

  it("transaction ROLLBACK after evidence delete restores the original topic and cards", async () => {
    await cleanup();
    await exec(
      `INSERT INTO daily_topics (topic_date, title, prompt, category, sources, generation_source, generation_reason, topic_fingerprint)
       VALUES ($1::date, $2, $3, $4, $5::jsonb, 'fallback', 'fallback-policy', $6)`,
      [DATE, CONTENT.title, CONTENT.prompt, CONTENT.category, jsonParam([]), FP],
    );
    const topicId = String((await exec("SELECT id FROM daily_topics WHERE topic_date = $1::date", [DATE]))[0].id);
    await exec(
      `INSERT INTO topic_evidence (topic_id, claim, source_name, source_type, url, passage, topic_fingerprint)
       VALUES ($1, 'original live claim', 'nrel', 'primary', 'https://nrel.gov/live', 'passage', $2)`,
      [topicId, FP],
    );

    const boom = new Error("poisoned live repair");
    await expect(
      exec.transaction(async (tx) => {
        await tx("UPDATE daily_topics SET title = 'repaired title' WHERE topic_date = $1::date", [DATE]);
        await tx("DELETE FROM topic_evidence WHERE topic_id = $1", [topicId]);
        throw boom; // failure AFTER the evidence delete
      }),
    ).rejects.toThrow("poisoned live repair");

    const row = (await exec("SELECT title FROM daily_topics WHERE topic_date = $1::date", [DATE]))[0];
    expect(row.title).toBe(CONTENT.title); // topic update rolled back
    const cards = await exec("SELECT claim FROM topic_evidence WHERE topic_id = $1", [topicId]);
    expect(cards).toHaveLength(1); // delete rolled back with it
    expect(cards[0].claim).toBe("original live claim");
  });

  it("fingerprint verification: recomputed SHA-256 identity matches the stored row", async () => {
    await cleanup();
    await exec(
      `INSERT INTO daily_topics (topic_date, title, prompt, category, sources, generation_source, generation_reason, topic_fingerprint)
       VALUES ($1::date, $2, $3, $4, $5::jsonb, 'ai', 'ai', $6)`,
      [DATE, CONTENT.title, CONTENT.prompt, CONTENT.category, jsonParam([]), FP],
    );
    const row = (
      await exec(
        "SELECT title, prompt, category, topic_fingerprint FROM daily_topics WHERE topic_date = $1::date",
        [DATE],
      )
    )[0];
    const recomputed = topicFingerprint({
      topicDate: DATE,
      title: String(row.title),
      prompt: String(row.prompt),
      category: String(row.category),
    });
    expect(row.topic_fingerprint).toBe(FP);
    expect(recomputed).toBe(row.topic_fingerprint); // identity holds on this transport
  });
});

async function readCount(): Promise<number> {
  const rows = await exec("SELECT count(*)::int AS n FROM daily_topics WHERE topic_date = $1::date", [DATE]);
  return rows[0].n as number;
}
