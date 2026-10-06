import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { applyTestMigrations } from "../../../tests/helpers/applyTestMigrations";

/**
 * Account erasure (migration 037, `delete_app_account`): one transaction must
 * remove EVERYTHING attributable to the requesting user — including the
 * non-cascade foreign keys (pvp_matches, pvp_turns, corpus_items,
 * corpus_ratings, challenge_invites.opponent_id) — while leaving every other
 * account intact. Two-party records the user is half of (shared matches,
 * invites naming them, ratings on their contributed items) die with them by
 * construction; nothing else may.
 *
 * Runs only when TEST_DATABASE_URL points at a disposable Postgres (CI
 * provisions an ephemeral container); skipped otherwise.
 */

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const d = databaseUrl ? describe : describe.skip;

let pool: pg.Pool;

const suffix = randomUUID().slice(0, 8);
const emails = {
  victim: `erase-victim-${suffix}@test.local`,
  other: `erase-other-${suffix}@test.local`,
  rater: `erase-rater-${suffix}@test.local`,
};

async function createUser(email: string): Promise<string> {
  const inserted = await pool.query<{ id: string }>(
    `WITH new_user AS (
       INSERT INTO app_users (email, password_hash) VALUES ($1, 'test')
       RETURNING id
     )
     INSERT INTO profiles (id, username) SELECT id, $2 FROM new_user RETURNING id`,
    [email, email.split("@")[0]],
  );
  return inserted.rows[0].id;
}

beforeAll(async () => {
  if (!databaseUrl) return;
  pool = new pg.Pool({ connectionString: databaseUrl });
  await applyTestMigrations(pool);
});

afterAll(async () => {
  await pool?.end();
});

d("delete_app_account (migration 037)", () => {
  it("erases one account transactionally without corrupting two-party or third-party rows", async () => {
    const victim = await createUser(emails.victim);
    const other = await createUser(emails.other);
    const rater = await createUser(emails.rater);

    // Own topic row on a FIXED date: sibling db suites share today's
    // daily_topics row, and verifyTopicStored.db.test nukes every topic dated
    // >= 2026-10-01 in its beforeEach — referencing that row from a parallel
    // suite (via solo_debates.topic_id) fails with an FK violation. An old
    // date is outside its blast radius and outside every other suite's.
    const topicDate = "2025-06-15";
    await pool.query(
      `INSERT INTO daily_topics (topic_date, title, prompt)
       VALUES ($1, 'Erasure test topic', 'Should this row outlive the victim?')
       ON CONFLICT (topic_date) DO NOTHING`,
      [topicDate],
    );
    const topic = await pool.query<{ id: string }>("SELECT id FROM daily_topics WHERE topic_date = $1", [topicDate]);
    const topicId = topic.rows[0].id;

    // Victim's own solo debate (cascade path) and auth session.
    const solo = await pool.query<{ id: string }>(
      "INSERT INTO solo_debates (user_id, topic_id, side) VALUES ($1, $2, 'for') RETURNING id",
      [victim, topicId],
    );
    const soloId = solo.rows[0].id;
    await pool.query(
      "INSERT INTO solo_debate_turns (debate_id, round_number, ai_message) VALUES ($1, 1, 'opening')",
      [soloId],
    );
    await pool.query(
      "INSERT INTO app_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
      [victim, randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64)],
    );

    // Shared match: victim vs other (non-cascade FK — the risky path), plus an
    // unrelated match between other and rater that must survive untouched.
    const sharedMatch = await pool.query<{ id: string }>(
      `INSERT INTO pvp_matches (topic_id, player_a, player_b, player_a_side, status)
       VALUES ($1, $2, $3, 'for', 'active') RETURNING id`,
      [topicId, victim, other],
    );
    const sharedMatchId = sharedMatch.rows[0].id;
    await pool.query(
      "INSERT INTO pvp_turns (match_id, player_id, round_number, message) VALUES ($1, $2, 1, 'victim argues')",
      [sharedMatchId, victim],
    );
    const unrelatedMatch = await pool.query<{ id: string }>(
      `INSERT INTO pvp_matches (topic_id, player_a, player_b, player_a_side, status)
       VALUES ($1, $2, $3, 'against', 'completed') RETURNING id`,
      [topicId, other, rater],
    );
    const unrelatedMatchId = unrelatedMatch.rows[0].id;
    await pool.query(
      "INSERT INTO pvp_turns (match_id, player_id, round_number, message) VALUES ($1, $2, 1, 'unrelated')",
      [unrelatedMatchId, other],
    );

    // Invites: one names the victim as opponent (must go), one does not
    // involve them at all (must stay). challenge_invites allows only ONE open
    // invite per challenger (023), so the clean invite is filed by the third
    // account, not the same challenger as the victim's invite.
    const victimInvite = await pool.query<{ id: string }>(
      `INSERT INTO challenge_invites (code, challenger_id, topic_id, challenger_side, opponent_id, match_id, expires_at)
       VALUES ($1, $2, $3, 'for', $4, $5, now() + interval '1 day') RETURNING id`,
      [`vict${suffix}`.slice(0, 12), other, topicId, victim, sharedMatchId],
    );
    const cleanInvite = await pool.query<{ id: string }>(
      `INSERT INTO challenge_invites (code, challenger_id, topic_id, challenger_side, opponent_id, expires_at)
       VALUES ($1, $2, $3, 'for', $4, now() + interval '1 day') RETURNING id`,
      [`clean${suffix}`.slice(0, 12), rater, topicId, other],
    );

    // Corpus: victim's item (ratings from other + rater die WITH the item) and
    // other's item (victim's rating must vanish; rater's must stay).
    const victimItem = await pool.query<{ id: string }>(
      `INSERT INTO corpus_items (transcript, source_type, source_id, contributor_id, length_bucket, ability_band)
       VALUES ('victim transcript', 'solo', $1, $2, 'short', 'novice') RETURNING id`,
      [soloId, victim],
    );
    const victimItemId = victimItem.rows[0].id;
    const otherItem = await pool.query<{ id: string }>(
      `INSERT INTO corpus_items (transcript, source_type, contributor_id, length_bucket, ability_band)
       VALUES ('other transcript', 'pvp', $1, 'short', 'novice') RETURNING id`,
      [other],
    );
    const otherItemId = otherItem.rows[0].id;
    const rating = `INSERT INTO corpus_ratings (corpus_id, rater_id, scores_a, scores_b, winner)
                     VALUES ($1, $2, '{"claims": 1}'::jsonb, '{"claims": 1}'::jsonb, 'tie')`;
    await pool.query(rating, [victimItemId, other]);
    await pool.query(rating, [victimItemId, rater]);
    await pool.query(rating, [otherItemId, victim]);
    await pool.query(rating, [otherItemId, rater]);

    // Reports and events either side of the relationship.
    await pool.query(
      `INSERT INTO reports (target_user_id, filed_by, reason, note) VALUES ($1, $2, 'spam', 'reported by victim')`,
      [other, victim],
    );
    await pool.query(
      `INSERT INTO reports (target_user_id, filed_by, reason, note) VALUES ($1, $2, 'spam', 'reported by rater')`,
      [other, rater],
    );
    await pool.query(`INSERT INTO product_events (user_id, name) VALUES ($1, 'daily_viewed')`, [victim]);
    await pool.query(`INSERT INTO product_events (user_id, name) VALUES ($1, 'daily_viewed')`, [other]);
    const victimRateKey = `solo-turn-user:${victim}`;
    await pool.query(`INSERT INTO rate_limits (key, count, reset_at) VALUES ($1, 1, now())`, [victimRateKey]);

    // --- Act: one call, one transaction -----------------------------------
    const result = await pool.query<{ delete_app_account: Record<string, unknown> }>(
      "SELECT delete_app_account($1) AS delete_app_account",
      [victim],
    );
    const summary = result.rows[0].delete_app_account;
    expect(summary).toMatchObject({
      userDeleted: true,
      matchesDeleted: 1,
      invitesDeleted: 1,
      corpusRatingsDeleted: 1,
      corpusItemsDeleted: 1,
    });

    // --- Victim: everything attributable is gone --------------------------
    const gone = await pool.query<{ n: number }>(
      `SELECT (
         (SELECT count(*) FROM app_users WHERE id = $1) +
         (SELECT count(*) FROM profiles WHERE id = $1) +
         (SELECT count(*) FROM app_sessions WHERE user_id = $1) +
         (SELECT count(*) FROM solo_debates WHERE user_id = $1) +
         (SELECT count(*) FROM solo_debate_turns WHERE debate_id = $2) +
         (SELECT count(*) FROM product_events WHERE user_id = $1) +
         (SELECT count(*) FROM corpus_ratings WHERE rater_id = $1) +
         (SELECT count(*) FROM corpus_items WHERE contributor_id = $1) +
         (SELECT count(*) FROM reports WHERE filed_by = $1 OR target_user_id = $1) +
         (SELECT count(*) FROM rate_limits WHERE key LIKE '%' || $1::text || '%')
       )::int AS n`,
      [victim, soloId],
    );
    expect(gone.rows[0].n).toBe(0);

    const shared = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM pvp_matches WHERE id = $1", [
      sharedMatchId,
    ]);
    expect(shared.rows[0].n).toBe(0);
    const sharedTurns = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pvp_turns WHERE match_id = $1",
      [sharedMatchId],
    );
    expect(sharedTurns.rows[0].n).toBe(0);
    const victimInviteGone = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM challenge_invites WHERE id = $1",
      [victimInvite.rows[0].id],
    );
    expect(victimInviteGone.rows[0].n).toBe(0);
    // Ratings left ON the victim's item die with the item.
    const onVictimItem = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM corpus_ratings WHERE corpus_id = $1",
      [victimItemId],
    );
    expect(onVictimItem.rows[0].n).toBe(0);

    // --- Everyone else: intact --------------------------------------------
    const intact = await pool.query<{ n: number }>(
      `SELECT (
         (SELECT count(*) FROM app_users WHERE id IN ($1, $2)) +
         (SELECT count(*) FROM profiles WHERE id IN ($1, $2)) +
         (SELECT count(*) FROM pvp_matches WHERE id = $3) +
         (SELECT count(*) FROM pvp_turns WHERE match_id = $3) +
         (SELECT count(*) FROM challenge_invites WHERE id = $4) +
         (SELECT count(*) FROM corpus_items WHERE id = $5) +
         (SELECT count(*) FROM corpus_ratings WHERE corpus_id = $5 AND rater_id = $2) +
         (SELECT count(*) FROM reports WHERE filed_by = $2 AND target_user_id = $1) +
         (SELECT count(*) FROM product_events WHERE user_id = $1)
       )::int AS n`,
      [other, rater, unrelatedMatchId, cleanInvite.rows[0].id, otherItemId],
    );
    expect(intact.rows[0].n).toBe(10);

    // The victim's rating on someone else's item is gone; nothing else moved.
    const victimRatingGone = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM corpus_ratings WHERE corpus_id = $1 AND rater_id = $2",
      [otherItemId, victim],
    );
    expect(victimRatingGone.rows[0].n).toBe(0);
  });
});
