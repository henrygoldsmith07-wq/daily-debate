import "server-only";

import webpush from "web-push";
import { isDatabaseConfigured } from "./backend/env";
import { queryRows } from "./backend/sql";
import { unresolvedRepairRetestAnchors } from "./repairRetestServer";
import { decidePush, pushMessage, type PushKind, type PushSubscriptionInput } from "./webPush";

// Web Push I/O (migration 045). Decisions and copy live in webPush.ts.

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** VAPID keys from the environment; null means push is off (every caller degrades to nothing). */
export function pushConfig(env: Record<string, string | undefined> = process.env): PushConfig | null {
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  if (!subject.startsWith("mailto:") && !subject.startsWith("https://")) return null;
  return { publicKey, privateKey, subject };
}

export function pushAvailable(): boolean {
  return isDatabaseConfigured() && pushConfig() !== null;
}

export async function saveSubscription(userId: string, sub: PushSubscriptionInput): Promise<void> {
  // An endpoint belongs to one browser profile. If another account signed in
  // on that browser subscribes, the endpoint moves to that account.
  await queryRows(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE
       SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, failure_count = 0`,
    [userId, sub.endpoint, sub.p256dh, sub.auth],
  );
}

export async function deleteSubscription(userId: string, endpoint: string | null): Promise<number> {
  const rows = endpoint
    ? await queryRows<{ id: string }>(`DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2 RETURNING id`, [userId, endpoint])
    : await queryRows<{ id: string }>(`DELETE FROM push_subscriptions WHERE user_id = $1 RETURNING id`, [userId]);
  return rows.length;
}

export async function hasSubscription(userId: string): Promise<boolean> {
  const rows = await queryRows<{ n: number }>(`SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id = $1`, [userId]);
  return (rows[0]?.n ?? 0) > 0;
}

/** Mark a delivery opened. The id is an unguessable uuid carried only inside the encrypted push. */
export async function markOpened(deliveryId: string): Promise<boolean> {
  const rows = await queryRows<{ id: string }>(
    `UPDATE push_deliveries SET opened_at = now() WHERE id = $1 AND opened_at IS NULL RETURNING id`,
    [deliveryId],
  );
  return rows.length > 0;
}

interface Candidate {
  user_id: string;
  timezone: string | null;
  last_activity_date: string | Date | null;
  current_streak: number | null;
  last_push_at: string | Date | null;
  last_retest_push_at: string | Date | null;
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface DispatchSummary {
  users: number;
  sent: number;
  skipped: number;
  removed: number;
  failed: number;
}

type Sender = (sub: SubscriptionRow, payload: string, config: PushConfig) => Promise<void>;

const defaultSender: Sender = async (sub, payload, config) => {
  await webpush.sendNotification(
    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    payload,
    { vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey }, TTL: 4 * 3600, urgency: "normal" },
  );
};

const iso = (value: string | Date | null): string | null =>
  value === null ? null : typeof value === "string" ? value : value.toISOString();
const dateKey = (value: string | Date | null): string | null =>
  value === null ? null : typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);

/**
 * One pass of the scheduled sender. Every learner with a subscription is
 * considered; at most one push each, by decidePush. A subscription the push
 * service reports gone (404/410) is deleted.
 */
export async function dispatchPushes(now: Date = new Date(), send: Sender = defaultSender): Promise<DispatchSummary> {
  const config = pushConfig();
  const summary: DispatchSummary = { users: 0, sent: 0, skipped: 0, removed: 0, failed: 0 };
  if (!config || !isDatabaseConfigured()) return summary;

  const candidates = await queryRows<Candidate>(
    `SELECT p.id AS user_id, p.timezone, p.last_activity_date, p.current_streak,
            (SELECT max(sent_at) FROM push_deliveries d WHERE d.user_id = p.id) AS last_push_at,
            (SELECT max(sent_at) FROM push_deliveries d WHERE d.user_id = p.id AND d.kind = 'retest') AS last_retest_push_at
       FROM profiles p
      WHERE EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = p.id)`,
  );
  summary.users = candidates.length;

  for (const c of candidates) {
    const base = {
      now,
      timeZone: c.timezone ?? "UTC",
      lastActivityDate: dateKey(c.last_activity_date),
      currentStreak: Number(c.current_streak ?? 0),
      lastPushAt: iso(c.last_push_at),
      lastRetestPushAt: iso(c.last_retest_push_at),
    };
    // The retest queue is only read when it could matter (no streak push due).
    let decision = decidePush({ ...base, pendingRetests: 0 });
    if (!decision.send && decision.reason === "nothing_due") {
      const pending = await unresolvedRepairRetestAnchors(c.user_id).then((a) => a.length).catch(() => 0);
      decision = decidePush({ ...base, pendingRetests: pending });
    }
    if (!decision.send) {
      summary.skipped += 1;
      continue;
    }

    const subs = await queryRows<SubscriptionRow>(
      `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5`,
      [c.user_id],
    );
    // Record first so the cap holds even if a later step fails; the id goes
    // into the payload so the click can be attributed.
    const [delivery] = await queryRows<{ id: string }>(
      `INSERT INTO push_deliveries (user_id, kind) VALUES ($1, $2) RETURNING id`,
      [c.user_id, decision.kind satisfies PushKind],
    );
    const message = pushMessage(decision);
    const payload = JSON.stringify({ ...message, id: delivery.id });

    let delivered = false;
    for (const sub of subs) {
      try {
        await send(sub, payload, config);
        delivered = true;
        await queryRows(`UPDATE push_subscriptions SET last_success_at = now(), failure_count = 0 WHERE id = $1`, [sub.id]);
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await queryRows(`DELETE FROM push_subscriptions WHERE id = $1`, [sub.id]);
          summary.removed += 1;
        } else {
          await queryRows(`UPDATE push_subscriptions SET failure_count = failure_count + 1 WHERE id = $1`, [sub.id]);
          summary.failed += 1;
        }
      }
    }
    if (delivered) summary.sent += 1;
    else await queryRows(`DELETE FROM push_deliveries WHERE id = $1`, [delivery.id]);
  }
  return summary;
}

export interface PushWeek {
  weekStart: string;
  sent: number;
  opened: number;
}

/** Weekly sent vs opened, newest first; null when unreadable (never shown as zero). */
export async function loadPushWeeks(weeks = 8): Promise<PushWeek[] | null> {
  if (!isDatabaseConfigured()) return null;
  try {
    const rows = await queryRows<{ week_start: string | Date; sent: number; opened: number }>(
      `SELECT date_trunc('week', sent_at)::date AS week_start,
              count(*)::int AS sent,
              count(opened_at)::int AS opened
         FROM push_deliveries
        WHERE sent_at >= now() - ($1::int * interval '7 days')
        GROUP BY 1
        ORDER BY 1 DESC`,
      [weeks],
    );
    return rows.map((row) => ({
      weekStart: typeof row.week_start === "string" ? row.week_start.slice(0, 10) : row.week_start.toISOString().slice(0, 10),
      sent: Number(row.sent),
      opened: Number(row.opened),
    }));
  } catch {
    return null;
  }
}
