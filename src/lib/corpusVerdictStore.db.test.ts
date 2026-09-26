import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { applyTestMigrations } from "../../tests/helpers/applyTestMigrations";
import {
  claimCorpusSystemJudge,
  persistCorpusSystemVerdict,
  releaseCorpusSystemJudgeClaim,
  writeCorpusAdjudication,
} from "./corpusVerdictStore";

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const d = databaseUrl && process.env.DATABASE_URL?.trim() ? describe : describe.skip;

let pool: pg.Pool;
let contributorId: string;
const itemIds: string[] = [];

async function makeItem(sideMapping: Record<string, unknown> = {}): Promise<string> {
  const row = await pool.query<{ id: string }>(
    `INSERT INTO corpus_items (
       transcript, topic, source_type, contributor_id, length_bucket, ability_band,
       status, rating_count, side_mapping
     ) VALUES (
       'Side A (round 1): Alpha.\nSide B (round 1): Beta.\nSide A (round 2): Gamma.\nSide B (round 2): Delta.',
       'Verdict store test', 'solo', $1, 'medium', 'intermediate', 'rated', 3, $2::jsonb
     ) RETURNING id`,
    [contributorId, JSON.stringify(sideMapping)],
  );
  itemIds.push(row.rows[0].id);
  return row.rows[0].id;
}

d("corpus verdict store (real Postgres)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl, max: 6 });
    await applyTestMigrations(pool);
    const user = await pool.query<{ id: string }>(
      `WITH u AS (
         INSERT INTO app_users (email, password_hash)
         VALUES ('verdict-store@test.local', 'test')
         ON CONFLICT (email) DO UPDATE SET email = excluded.email
         RETURNING id
       )
       INSERT INTO profiles (id, username)
       SELECT id, 'verdict-store' FROM u
       ON CONFLICT (id) DO UPDATE SET username = excluded.username
       RETURNING id`,
    );
    contributorId = user.rows[0].id;
  });

  afterAll(async () => {
    if (itemIds.length) await pool.query("DELETE FROM corpus_items WHERE id = ANY($1::uuid[])", [itemIds]);
    await pool.query("DELETE FROM app_users WHERE email = 'verdict-store@test.local'");
    await pool.end();
  });

  it("adjudication atomically preserves system verdict provenance and clears stale markers", async () => {
    const item = await makeItem({
      source: "import",
      system_verdict: { winner: "a", confidence: 0.7 },
      adjudication_stale: true,
      adjudication_stale_at: "old",
      adjudication_stale_actor: "old-admin",
    });

    expect(
      await writeCorpusAdjudication({
        corpusId: item,
        winner: "b",
        basis: "moderator override",
        actor: "admin@test.local",
        at: "2026-09-26T18:30:00Z",
        minimumRatings: 3,
      }),
    ).toBe(true);

    const row = await pool.query<{ status: string; side_mapping: Record<string, unknown> }>(
      "SELECT status, side_mapping FROM corpus_items WHERE id = $1",
      [item],
    );
    expect(row.rows[0].status).toBe("adjudicated");
    expect(row.rows[0].side_mapping).toMatchObject({
      source: "import",
      system_verdict: { winner: "a", confidence: 0.7 },
      consensus_winner: "b",
      basis: "moderator override",
      adjudicated_by: "admin@test.local",
    });
    expect(row.rows[0].side_mapping).not.toHaveProperty("adjudication_stale");
  });

  it("allows only one concurrent live-system claim for an item", async () => {
    const item = await makeItem({ source: "import" });
    const [a, b] = await Promise.all([claimCorpusSystemJudge(item), claimCorpusSystemJudge(item)]);
    const claims = [a, b].filter((value): value is { token: string } => value !== null);
    expect(claims).toHaveLength(1);
    await releaseCorpusSystemJudgeClaim(item, claims[0].token);
  });

  it("persists a claimed system verdict once without erasing adjudication metadata", async () => {
    const item = await makeItem({
      source: "import",
      consensus_winner: "b",
      basis: "moderator override",
    });
    await pool.query("UPDATE corpus_items SET status = 'adjudicated' WHERE id = $1", [item]);
    const claim = await claimCorpusSystemJudge(item);
    expect(claim).not.toBeNull();

    expect(
      await persistCorpusSystemVerdict(item, claim!.token, {
        winner: "b",
        confidence: 0.82,
        swap_check: { stable: true },
      }),
    ).toBe(true);
    expect(
      await persistCorpusSystemVerdict(item, claim!.token, { winner: "a" }),
    ).toBe(false);
    expect(await claimCorpusSystemJudge(item)).toBeNull();

    const row = await pool.query<{ side_mapping: Record<string, unknown> }>(
      "SELECT side_mapping FROM corpus_items WHERE id = $1",
      [item],
    );
    expect(row.rows[0].side_mapping).toMatchObject({
      source: "import",
      consensus_winner: "b",
      basis: "moderator override",
      system_verdict: { winner: "b", confidence: 0.82, swap_check: { stable: true } },
    });
  });
});
