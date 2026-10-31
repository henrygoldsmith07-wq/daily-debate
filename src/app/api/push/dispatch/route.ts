import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { dispatchPushes } from "@/lib/webPushServer";

/**
 * Scheduled sender (.github/workflows/push-dispatch.yml, hourly). Protected by
 * PUSH_DISPATCH_SECRET as a bearer token; without the secret configured the
 * route does not exist. Each run sends at most one push per learner, inside
 * their own early-evening window (webPush.ts decides).
 */

function authorized(request: Request): boolean {
  const secret = process.env.PUSH_DISPATCH_SECRET?.trim();
  if (!secret || secret.length < 32) return false;
  const header = request.headers.get("authorization") ?? "";
  const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7).trim() : "");
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const summary = await dispatchPushes();
    return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("push dispatch failed:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "dispatch failed" }, { status: 500 });
  }
}
