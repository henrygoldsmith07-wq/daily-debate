import { NextResponse } from "next/server";
import { createServiceClient } from "./supabase/server";

// Distributed fixed-window limiter. State lives in Supabase (rate_limits
// table from 002_rate_limits.sql) so every serverless instance shares
// counters. On missing table / local dev without Supabase creds, it falls
// back to the previous process-local Map so tests and `next dev` still work.

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimitOptions {
  name: string;
  limit: number;
  windowMs: number;
}

// ---- Fallback (process-local) used when Supabase is unavailable -----------

interface Bucket {
  count: number;
  resetAt: number;
}
const buckets = new Map<string, Bucket>();
function pruneIfNeeded(now: number) {
  if (buckets.size < 5000) return;
  for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k);
}
function localRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  pruneIfNeeded(now);
  const existing = buckets.get(key);
  if (!existing || now >= existing.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }
  if (existing.count >= limit) {
    return { ok: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
  }
  existing.count += 1;
  return { ok: true, remaining: limit - existing.count, retryAfterSeconds: 0 };
}
export function __localRateLimitForTests(key: string, limit: number, windowMs: number) {
  // Exposed for unit tests without needing Supabase.
  return localRateLimit(key, limit, windowMs);
}
export function __clearBucketsForTests() {
  buckets.clear();
}

// ---- Public API ----------------------------------------------------------

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

async function dbRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult | null> {
  // Returns null on unavailability so caller can fall back to local.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  const supabase = createServiceClient();
  const now = Date.now();
  const windowEnd = new Date(now + windowMs).toISOString();

  // Read existing window
  const { data: existing, error: readError } = await supabase
    .from("rate_limits")
    .select("count, reset_at")
    .eq("key", key)
    .maybeSingle();

  if (readError) return null; // table missing? fall back

  if (!existing || new Date(existing.reset_at).getTime() <= now) {
    // New window
    const { error: upsertError } = await supabase.from("rate_limits").upsert({ key, count: 1, reset_at: windowEnd }, { onConflict: "key" });
    if (upsertError) return null;
    return { ok: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  const count = existing.count as number;
  const resetMs = new Date(existing.reset_at as string).getTime();
  if (count >= limit) {
    return { ok: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((resetMs - now) / 1000)) };
  }

  const { error: incError } = await supabase.from("rate_limits").update({ count: count + 1 }).eq("key", key);
  if (incError) return null;
  return { ok: true, remaining: limit - (count + 1), retryAfterSeconds: 0 };
}

// Keep sync signature used previously for convenience: callers already `await` the outer handler,
// so make this async and handle internally. The route `if (limited) return limited` still works.
// For clarity, export a new name too.
export async function checkRateLimit(request: Request, options: RateLimitOptions): Promise<NextResponse | null> {
  const ip = getClientIp(request);
  const key = `${options.name}:${ip}`;

  let result: RateLimitResult | null = null;
  try {
    result = await dbRateLimit(key, options.limit, options.windowMs);
  } catch {
    result = null;
  }
  if (!result) result = localRateLimit(key, options.limit, options.windowMs);

  if (result.ok) return null;
  return NextResponse.json(
    { error: "Too many requests. Please wait a moment and try again." },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds), "Cache-Control": "no-store" } },
  );
}

// Backwards compat: some callers import `rateLimit` directly.
// Expose the local variant under that name so tests that did `rateLimit(key, n, w)` keep working
// and don't accidentally hit the DB.
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  return localRateLimit(key, limit, windowMs);
}
