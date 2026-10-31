import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { markOpened } from "@/lib/webPushServer";

/**
 * Called by the service worker when a push notification is clicked. The
 * delivery id is an unguessable uuid that only ever travelled inside the
 * encrypted push payload, so it needs no session (a click may open a browser
 * whose session has expired).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const limited = await checkRateLimit(request, { name: "push-opened", limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const body = await request.json().catch(() => null);
  const id = body?.id;
  if (typeof id !== "string" || !UUID_RE.test(id)) return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  try {
    await markOpened(id);
  } catch {
    // Attribution is best effort; the click still opens the app.
  }
  return NextResponse.json({ ok: true });
}
