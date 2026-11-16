import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { applyTestMigrations } from "../../tests/helpers/applyTestMigrations";
import { dispatchPushes, markOpened } from "./webPushServer";

// Push dispatch (migration 045) against real Postgres: the daily cap, the
// learner's own evening window, removal of gone subscriptions, and open
// attribution. Skipped without TEST_DATABASE_URL + DATABASE_URL (CI e2e
// provisions both; DATABASE_URL is the URL the app's SQL client uses).

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const d = databaseUrl && process.env.DATABASE_URL?.trim() ? describe : describe.skip;

// 18:30 in London on 2026-10-30 (UTC+0): inside the 17-21 window.
const EVENING = new Date("2026-10-30T18:30:00Z");
const emails = ["push-a@test.local", "push-b@test.local"];
const ids = new Map<string, string>();
let pool: pg.Pool;

async function ensureUser(email: string): Promise<string> {
  const existing = await pool.query<{ id: string }>("SELECT id FROM app_users WHERE email = $1", [email]);
  if (existing.rows.length) return existing.rows[0].id;
  const inserted = await pool.query<{ id: string }>(
    `WITH new_user AS (INSERT INTO app_users (email, password_hash) VALUES ($1, 'test') RETURNING id)
     INSERT INTO profiles (id, username) SELECT id, $2 FROM new_user RETURNING id`,
    [email, email.split("@")[0]],
  );
  return inserted.rows[0].id;
}

const userA = () => ids.get(emails[0])!;
const userB = () => ids.get(emails[1])!;

async function subscribe(userId: string, endpoint: string) {
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ($1, $2, 'key', 'auth')`,
    [userId, endpoint],
  );
}

d("push dispatch (migration 045)", () => {
  const env = { ...process.env };

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
    await applyTestMigrations(pool);
    for (const email of emails) ids.set(email, await ensureUser(email));
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "test-public";
    process.env.VAPID_PRIVATE_KEY = "test-private";
    process.env.VAPID_SUBJECT = "mailto:test@example.com";
  });

  beforeEach(async () => {
    const own = [...ids.values()];
    await pool.query("DELETE FROM push_deliveries WHERE user_id = ANY($1::uuid[])", [own]);
    await pool.query("DELETE FROM push_subscriptions WHERE user_id = ANY($1::uuid[])", [own]);
    // A clean slate for everyone else's subscriptions is not ours to take;
    // the assertions below only count this suite's users.
    await pool.query(
      `UPDATE profiles SET timezone = 'Europe/London', last_activity_date = '2026-10-29', current_streak = 3 WHERE id = ANY($1::uuid[])`,
      [own],
    );
  });

  afterAll(async () => {
    const own = [...ids.values()];
    await pool.query("DELETE FROM push_deliveries WHERE user_id = ANY($1::uuid[])", [own]);
    await pool.query("DELETE FROM push_subscriptions WHERE user_id = ANY($1::uuid[])", [own]);
    await pool.end();
    process.env = env;
  });

  async function deliveries(userId: string) {
    return (await pool.query<{ id: string; kind: string; opened_at: Date | null }>(
      "SELECT id, kind, opened_at FROM push_deliveries WHERE user_id = $1",
      [userId],
    )).rows;
  }

  it("sends one streak-saver, then respects the daily cap", async () => {
    await subscribe(userA(), "https://fcm.googleapis.com/fcm/send/push-a");
    const payloads: string[] = [];
    await dispatchPushes(EVENING, async (_sub, payload) => {
      payloads.push(payload);
    });
    const ownPayloads = payloads.filter((p) => JSON.parse(p).title === "Keep your 3-day streak");
    expect(ownPayloads).toHaveLength(1);
    const sent = await deliveries(userA());
    expect(sent).toHaveLength(1);
    expect(sent[0].kind).toBe("streak");
    expect(JSON.parse(ownPayloads[0]).id).toBe(sent[0].id);

    // An hour later the hourly job runs again: nothing new for this learner.
    await dispatchPushes(new Date("2026-10-30T19:30:00Z"), async () => {});
    expect(await deliveries(userA())).toHaveLength(1);

    expect(await markOpened(sent[0].id)).toBe(true);
    expect(await markOpened(sent[0].id)).toBe(false);
    expect((await deliveries(userA()))[0].opened_at).not.toBeNull();
  });

  it("sends nothing outside the learner's evening window or after they practised", async () => {
    await subscribe(userA(), "https://fcm.googleapis.com/fcm/send/push-a2");
    await dispatchPushes(new Date("2026-10-30T12:00:00Z"), async () => {});
    expect(await deliveries(userA())).toHaveLength(0);

    await pool.query("UPDATE profiles SET last_activity_date = '2026-10-30' WHERE id = $1", [userA()]);
    await dispatchPushes(EVENING, async () => {});
    expect(await deliveries(userA())).toHaveLength(0);
  });

  it("removes a subscription the push service says is gone, and keeps no delivery for it", async () => {
    await subscribe(userB(), "https://fcm.googleapis.com/fcm/send/push-b-gone");
    await dispatchPushes(EVENING, async (sub) => {
      if (sub.endpoint.endsWith("push-b-gone")) throw Object.assign(new Error("gone"), { statusCode: 410 });
    });
    const left = await pool.query("SELECT 1 FROM push_subscriptions WHERE user_id = $1", [userB()]);
    expect(left.rows).toHaveLength(0);
    expect(await deliveries(userB())).toHaveLength(0);
  });

  it("cascades with the account", async () => {
    const temp = await ensureUser("push-temp@test.local");
    await subscribe(temp, "https://fcm.googleapis.com/fcm/send/push-temp");
    await pool.query("INSERT INTO push_deliveries (user_id, kind) VALUES ($1, 'streak')", [temp]);
    await pool.query("DELETE FROM app_users WHERE id = $1", [temp]);
    expect((await pool.query("SELECT 1 FROM push_subscriptions WHERE user_id = $1", [temp])).rows).toHaveLength(0);
    expect((await pool.query("SELECT 1 FROM push_deliveries WHERE user_id = $1", [temp])).rows).toHaveLength(0);
  });
});
