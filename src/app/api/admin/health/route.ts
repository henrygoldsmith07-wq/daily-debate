import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { loadOpsHealth } from "@/lib/opsHealthServer";
import { getRequestAuthContext } from "@/lib/requestAuth";

/**
 * Internal admin report: operational health for the app pipeline, the daily
 * topic pipeline, judge validation, and CI. Gated by CORPUS_ADMIN_EMAILS
 * like every other admin surface. States are explicit
 * (healthy/degraded/blocked/stale/failed/unknown) — missing data never
 * reads as green.
 */
export async function GET(request: Request) {
  const limited = await checkRateLimit(request, { name: "ops-health", limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  const auth = await getRequestAuthContext();
  if (!auth.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const report = await loadOpsHealth();
  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
}
