import { NextResponse } from "next/server";
import { createClient } from "@/lib/backend/server";
import { checkRateLimitKey } from "@/lib/rateLimit";
import { parsePushSubscription } from "@/lib/webPush";
import { deleteSubscription, pushAvailable, saveSubscription } from "@/lib/webPushServer";

/**
 * Opt in to (POST) or out of (DELETE) push reminders for this browser.
 * POST body: PushSubscription.toJSON(). DELETE body: { endpoint } or nothing
 * (removes every browser for this account).
 */

async function currentUserId(): Promise<string | null> {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  return user?.id ?? null;
}

export async function POST(request: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!pushAvailable()) return NextResponse.json({ error: "Push reminders are not available." }, { status: 503 });

  const limit = await checkRateLimitKey(userId, { name: "push-subscribe", limit: 10, windowMs: 60 * 60_000 });
  if (!limit.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const sub = parsePushSubscription(await request.json().catch(() => null));
  if (!sub) return NextResponse.json({ error: "Invalid push subscription." }, { status: 400 });
  await saveSubscription(userId, sub);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const endpoint = typeof body?.endpoint === "string" && body.endpoint.length <= 1000 ? body.endpoint : null;
  const removed = await deleteSubscription(userId, endpoint);
  return NextResponse.json({ ok: true, removed });
}
