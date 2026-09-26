import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { createClient } from "@/lib/backend/server";
import { isClientProductEventName } from "@/lib/clientProductEvents";
import {
  isProductEventReason,
  recordProductEventForUser,
  type ProductEventContext,
} from "@/lib/productEvents";

/**
 * Client-side product event sink. Same privacy rules as the server-side
 * recorder: allowlisted names, bounded context fields, no free text, and a
 * silent no-op for guests. Fire-and-forget from the client.
 */
export async function POST(request: Request) {
  const limited = await checkRateLimit(request, { name: "product-events", limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  const name = body?.name;
  if (!isClientProductEventName(name)) {
    return NextResponse.json({ error: "Unknown event." }, { status: 400 });
  }
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ ok: true });

  const context: ProductEventContext = {};
  if (body?.format === "sprint" || body?.format === "full") context.format = body.format;
  if (body?.side === "for" || body?.side === "against") context.side = body.side;
  if (body?.reason !== undefined && body?.reason !== null) {
    if (!isProductEventReason(body.reason)) {
      return NextResponse.json({ error: "Unknown event reason." }, { status: 400 });
    }
    context.reason = body.reason;
  }
  if (typeof body?.round === "number" && Number.isInteger(body.round)) context.round = body.round;
  // Session identifier: bounded to UUID-shaped values only.
  if (
    typeof body?.debateId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.debateId)
  ) {
    const { data: ownedDebate } = await db
      .from("solo_debates")
      .select("id")
      .eq("id", body.debateId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!ownedDebate) {
      return NextResponse.json({ error: "Unknown debate." }, { status: 400 });
    }
    context.debateId = body.debateId;
  }

  await recordProductEventForUser(user.id, name, context);

  return NextResponse.json({ ok: true });
}
