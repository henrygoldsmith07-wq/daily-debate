import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { applyTestMigrations } from "../../../tests/helpers/applyTestMigrations";

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const d = databaseUrl ? describe : describe.skip;

let pool: pg.Pool;
const emails = ["friend-a@test.local", "friend-b@test.local", "friend-c@test.local"];
const ids = new Map<string, string>();

async function ensureUser(email: string): Promise<string> {
  const existing = await pool.query<{ id: string }>("SELECT id FROM app_users WHERE email = $1", [email]);
  if (existing.rows[0]) return existing.rows[0].id;
  const inserted = await pool.query<{ id: string }>(
    `WITH new_user AS (
       INSERT INTO app_users (email, password_hash) VALUES ($1, 'test') RETURNING id
     )
     INSERT INTO profiles (id, username) SELECT id, $2 FROM new_user RETURNING id`,
    [email, email.split("@")[0]],
  );
  return inserted.rows[0].id;
}

async function topicId(): Promise<string> {
  const day = new Date().toISOString().slice(0, 10);
  await pool.query(
    `INSERT INTO daily_topics (topic_date, title, prompt)
     VALUES ($1, 'Friend challenge test topic', 'Atomic invite lifecycle')
     ON CONFLICT (topic_date) DO NOTHING`,
    [day],
  );
  const row = await pool.query<{ id: string }>("SELECT id FROM daily_topics WHERE topic_date = $1", [day]);
  return row.rows[0].id;
}

async function clearOwnedState() {
  const userIds = [...ids.values()];
  if (!userIds.length) return;
  await pool.query(
    "DELETE FROM challenge_invites WHERE challenger_id = ANY($1::uuid[]) OR opponent_id = ANY($1::uuid[])",
    [userIds],
  );
  await pool.query("DELETE FROM pvp_queue WHERE user_id = ANY($1::uuid[])", [userIds]);
  await pool.query(
    "DELETE FROM pvp_turns WHERE match_id IN (SELECT id FROM pvp_matches WHERE player_a = ANY($1::uuid[]) OR player_b = ANY($1::uuid[]))",
    [userIds],
  );
  await pool.query(
    "DELETE FROM pvp_matches WHERE player_a = ANY($1::uuid[]) OR player_b = ANY($1::uuid[])",
    [userIds],
  );
}

d("atomic friend challenges (migrations 023-024)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
    await applyTestMigrations(pool);
    for (const email of emails) ids.set(email, await ensureUser(email));
  });

  beforeEach(clearOwnedState);

  afterAll(async () => {
    await clearOwnedState();
    for (const email of emails) await pool.query("DELETE FROM app_users WHERE email = $1", [email]);
    await pool.end();
  });

  it("converges concurrent identical creates on one secure open invite", async () => {
    const a = ids.get(emails[0])!;
    const topic = await topicId();
    const clientA = await pool.connect();
    const clientB = await pool.connect();
    try {
      const [first, second] = await Promise.all([
        clientA.query("SELECT * FROM create_friend_challenge($1, $2, 'for', 7)", [a, topic]),
        clientB.query("SELECT * FROM create_friend_challenge($1, $2, 'for', 7)", [a, topic]),
      ]);
      expect(first.rows).toHaveLength(1);
      expect(second.rows).toHaveLength(1);
      expect(first.rows[0].code).toBe(second.rows[0].code);
      expect(first.rows[0].code).toMatch(/^[2-9a-hj-km-np-z]{12}$/);
      expect([first.rows[0].result, second.rows[0].result].sort()).toEqual(["created", "reused"]);

      const open = await pool.query(
        "SELECT * FROM challenge_invites WHERE challenger_id = $1 AND status = 'open'",
        [a],
      );
      expect(open.rows).toHaveLength(1);
    } finally {
      clientA.release();
      clientB.release();
    }
  });

  it("atomically replaces an open invite when the requested side changes", async () => {
    const a = ids.get(emails[0])!;
    const topic = await topicId();
    const first = await pool.query("SELECT * FROM create_friend_challenge($1, $2, 'for', 7)", [a, topic]);
    const second = await pool.query("SELECT * FROM create_friend_challenge($1, $2, 'against', 7)", [a, topic]);
    expect(second.rows[0].code).not.toBe(first.rows[0].code);
    const rows = await pool.query(
      "SELECT code, status, challenger_side FROM challenge_invites WHERE challenger_id = $1 ORDER BY created_at",
      [a],
    );
    expect(rows.rows.filter((r) => r.status === "open")).toHaveLength(1);
    expect(rows.rows.find((r) => r.code === first.rows[0].code)?.status).toBe("cancelled");
    expect(rows.rows.find((r) => r.code === second.rows[0].code)?.challenger_side).toBe("against");
  });

  it("lets exactly one concurrent recipient accept and links invite to the match in one transaction", async () => {
    const [a, b, c] = emails.map((email) => ids.get(email)!);
    const topic = await topicId();
    const created = await pool.query("SELECT * FROM create_friend_challenge($1, $2, 'for', 7)", [a, topic]);
    const code = created.rows[0].code;
    const clientB = await pool.connect();
    const clientC = await pool.connect();
    try {
      const [acceptB, acceptC] = await Promise.all([
        clientB.query("SELECT * FROM accept_friend_challenge($1, $2, 5)", [code, b]),
        clientC.query("SELECT * FROM accept_friend_challenge($1, $2, 5)", [code, c]),
      ]);
      const outcomes = [acceptB.rows[0], acceptC.rows[0]];
      expect(outcomes.filter((row) => row.result === "accepted")).toHaveLength(1);
      expect(outcomes.filter((row) => row.result === "closed")).toHaveLength(1);

      const invite = await pool.query(
        "SELECT status, opponent_id, match_id FROM challenge_invites WHERE code = $1",
        [code],
      );
      expect(invite.rows[0].status).toBe("accepted");
      expect(invite.rows[0].match_id).toBeTruthy();
      expect([b, c]).toContain(invite.rows[0].opponent_id);

      const match = await pool.query("SELECT * FROM pvp_matches WHERE id = $1", [invite.rows[0].match_id]);
      expect(match.rows).toHaveLength(1);
      expect(match.rows[0].player_a).toBe(a);
      expect(match.rows[0].player_b).toBe(invite.rows[0].opponent_id);
    } finally {
      clientB.release();
      clientC.release();
    }
  });

  it("keeps the invite open when either participant already has an active match", async () => {
    const [a, b, c] = emails.map((email) => ids.get(email)!);
    const topic = await topicId();
    const created = await pool.query("SELECT * FROM create_friend_challenge($1, $2, 'for', 7)", [a, topic]);
    await pool.query(
      `INSERT INTO pvp_matches (topic_id, player_a, player_b, player_a_side, round_limit, current_turn_player, turn_started_at)
       VALUES ($1, $2, $3, 'for', 5, $2, now())`,
      [topic, b, c],
    );

    const accepted = await pool.query("SELECT * FROM accept_friend_challenge($1, $2, 5)", [created.rows[0].code, b]);
    expect(accepted.rows[0].result).toBe("active_match");
    const invite = await pool.query("SELECT status, opponent_id, match_id FROM challenge_invites WHERE code = $1", [created.rows[0].code]);
    expect(invite.rows[0]).toMatchObject({ status: "open", opponent_id: null, match_id: null });
  });

  it("returns the existing match when the same recipient retries after a lost response", async () => {
    const [a, b] = emails.slice(0, 2).map((email) => ids.get(email)!);
    const topic = await topicId();
    const created = await pool.query("SELECT * FROM create_friend_challenge($1, $2, 'for', 7)", [a, topic]);
    const first = await pool.query("SELECT * FROM accept_friend_challenge($1, $2, 5)", [created.rows[0].code, b]);
    expect(first.rows[0].result).toBe("accepted");

    const retry = await pool.query("SELECT * FROM accept_friend_challenge($1, $2, 5)", [created.rows[0].code, b]);
    expect(retry.rows[0].result).toBe("accepted_existing");
    expect(retry.rows[0].created_match_id).toBe(first.rows[0].created_match_id);

    const matches = await pool.query(
      "SELECT id FROM pvp_matches WHERE player_a = $1 AND player_b = $2 AND status = 'active'",
      [a, b],
    );
    expect(matches.rows).toHaveLength(1);
  });
});
