import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { applyTestMigrations } from "../../../tests/helpers/applyTestMigrations";
import { tableQuery } from "./query";

/**
 * REAL-POSTGRES tests for the query builder's write-once surface (items 4,
 * 25, 32): insertIgnore must generate `INSERT ... ON CONFLICT (topic_date)
 * DO NOTHING RETURNING *`, a conflict must return zero rows WITHOUT an
 * error (so the caller re-reads the winner), a plain insert must still fail
 * loudly with 23505, and concurrent writers must converge on exactly one
 * row. Skipped without TEST_DATABASE_URL + DATABASE_URL (CI e2e provisions
 * both; the builder executes through backend/sql's executor).
 */

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const d = databaseUrl && process.env.DATABASE_URL?.trim() ? describe : describe.skip;

const DATE = "2099-07-01";

let pool: pg.Pool;

const rowA = {
  topic_date: DATE,
  title: "Writer A canonical topic",
  prompt: "Writer A prompt — the winner of the write-once claim?",
  category: "Policy",
  sources: [],
  generation_source: "fallback",
  generation_reason: "request-time-fallback",
  topic_fingerprint: "a".repeat(64),
};
const rowB = {
  ...rowA,
  title: "Writer B canonical topic",
  topic_fingerprint: "b".repeat(64),
};

async function cleanup() {
  await pool.query("DELETE FROM topic_evidence WHERE topic_id IN (SELECT id FROM daily_topics WHERE topic_date = $1::date)", [DATE]);
  await pool.query("DELETE FROM daily_topics WHERE topic_date = $1::date", [DATE]);
}

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL?.trim(), max: 4 });
  await applyTestMigrations(pool);
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await pool.end();
});

beforeEach(async () => {
  await cleanup();
});

d("insertIgnore (ON CONFLICT DO NOTHING) against real Postgres", () => {
  it("returns the inserted row on first claim and zero rows (no error) on conflict", async () => {
    const first = await tableQuery("daily_topics").insertIgnore(rowA, { onConflict: "topic_date" }).select("*").maybeSingle();
    expect(first.error).toBeNull();
    expect(first.data).not.toBeNull();
    expect((first.data as { title: string }).title).toBe("Writer A canonical topic");

    const second = await tableQuery("daily_topics").insertIgnore(rowB, { onConflict: "topic_date" }).select("*").maybeSingle();
    expect(second.error).toBeNull(); // a unique conflict is NOT an error for insertIgnore
    expect(second.data).toBeNull(); // zero rows -> caller re-reads the winner

    const { rows } = await pool.query("SELECT title, topic_fingerprint FROM daily_topics WHERE topic_date = $1::date", [DATE]);
    expect(rows).toHaveLength(1); // exactly one row
    expect(rows[0].title).toBe("Writer A canonical topic"); // content never overwritten
    expect(rows[0].topic_fingerprint).toBe("a".repeat(64));
  });

  it("plain .insert() still fails loudly with 23505 (conflict visibility stays honest)", async () => {
    await tableQuery("daily_topics").insertIgnore(rowA, { onConflict: "topic_date" }).select("*").maybeSingle();
    const clash = await tableQuery("daily_topics").insert(rowB).select("*").maybeSingle();
    expect(clash.data).toBeNull();
    expect(clash.error?.code).toBe("23505"); // different surface, different contract
  });

  it("concurrent writers converge on exactly one canonical row (item 32)", async () => {
    const [r1, r2] = await Promise.all([
      tableQuery("daily_topics").insertIgnore(rowA, { onConflict: "topic_date" }).select("*").maybeSingle(),
      tableQuery("daily_topics").insertIgnore(rowB, { onConflict: "topic_date" }).select("*").maybeSingle(),
    ]);
    const winners = [r1, r2].filter((r) => r.error === null && r.data !== null);
    expect(winners).toHaveLength(1); // exactly one claim succeeded

    // Every caller re-reads THE stored row: same id, same content, no divergence.
    const read1 = await tableQuery("daily_topics").select("*").eq("topic_date", DATE).maybeSingle();
    const read2 = await tableQuery("daily_topics").select("*").eq("topic_date", DATE).maybeSingle();
    expect(read1.data).not.toBeNull();
    expect(read2.data).not.toBeNull();
    expect((read1.data as { id: string }).id).toBe((read2.data as { id: string }).id);
    const storedTitle = (read1.data as { title: string }).title;
    expect(["Writer A canonical topic", "Writer B canonical topic"]).toContain(storedTitle);
    const winnerData = winners[0].data as { title: string };
    expect(storedTitle).toBe(winnerData.title); // the loser re-read the winner's content

    const { rows } = await pool.query("SELECT count(*)::int AS n FROM daily_topics WHERE topic_date = $1::date", [DATE]);
    expect(rows[0].n).toBe(1);
  });

  it("insertIgnore requires explicit conflict columns", async () => {
    expect(() => tableQuery("daily_topics").insertIgnore(rowA, {})).toThrow(/conflict columns/i);
  });
});
