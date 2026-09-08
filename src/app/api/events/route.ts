import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { PRODUCT_EVENT_NAMES, type ProductEventContext } from "@/lib/productEvents";

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
  if (typeof name !== "string" || !(PRODUCT_EVENT_NAMES as readonly string[]).includes(name)) {
    return NextResponse.json({ error: "Unknown event." }, { status: 400 });
  }
  const eventName = name as (typeof PRODUCT_EVENT_NAMES)[number];

  const context: ProductEventContext = {};
  if (body?.format === "sprint" || body?.format === "full") context.format = body.format;
  if (body?.side === "for" || body?.side === "against") context.side = body.side;
  if (typeof body?.reason === "string") context.reason = body.reason.slice(0, 64);
  if (typeof body?.round === "number" && Number.isInteger(body.round)) context.round = body.round;

  const { recordProductEvent } = await import("@/lib/productEvents");
  await recordProductEvent(eventName, context);

  return NextResponse.json({ ok: true });
}
