import { NextResponse } from "next/server";
import { isDatabaseConfigured } from "./backend/env";
import { createServiceClient } from "./backend/server";

// Distributed fixed-window limiter. State lives in the app-owned Postgres
// rate_limits table so every serverless instance shares counters. Without a
// configured database it falls back to a process-local Map for guest mode and
// unit tests.

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

// ---- Fallback (process-local) used when Postgres is unavailable -----------

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
  // Exposed for unit tests without needing Postgres.
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
  if (!isDatabaseConfigured()) return null;

  const db = createServiceClient();
  const now = Date.now();

  const { data: rows, error } = await db.rpc("increment_rate_limit", {
    p_key: key,
    p_window_ms: windowMs,
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (error || !row) return null;

  const count = Number(row.new_count);
  const resetMs = new Date(row.new_reset_at).getTime();
  if (count > limit) {
    return { ok: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((resetMs - now) / 1000)) };
  }
  return { ok: true, remaining: limit - count, retryAfterSeconds: 0 };
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
