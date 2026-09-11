import { NextResponse } from "next/server";
import { createClient } from "@/lib/backend/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { isCorpusAdmin } from "@/lib/corpus";
import { loadOpsHealth } from "@/lib/opsHealthServer";

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

  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user || !isCorpusAdmin(user.email, process.env.CORPUS_ADMIN_EMAILS)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const report = await loadOpsHealth();
  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
}
