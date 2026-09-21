import { NextResponse } from "next/server";
import { loadOpsHealth } from "@/lib/opsHealthServer";
import { derivePublicHealthState } from "@/lib/healthProbe";
import { checkRateLimit } from "@/lib/rateLimit";

/**
 * Public, unauthenticated health probe — a deliberately NON-SENSITIVE
 * reduction of the ops-health report: booleans and coarse states only, no
 * titles, no dates, no counters. See src/lib/healthProbe.ts for the exact
 * contract and its unit tests.
 *
 * Purpose: the daily ops-alert digest (scripts/ops-alert-digest.mjs) reads
 * this over HTTP, so that workflow needs neither the DATABASE_URL secret nor
 * a GitHub PAT. The deployed app is an independent witness of production
 * state (its service-key DB view does not depend on the Actions secret).
 *
 * Second witness by design: if the app itself is down, the digest still sees
 * GitHub run history and treats the probe as unavailable — that difference
 * is diagnostic, exactly like the second-witness delay telemetry.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const limited = await checkRateLimit(request, { name: "public-health", limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  try {
    const nowIso = new Date().toISOString();
    const report = await loadOpsHealth(nowIso);
    const state = derivePublicHealthState(report, nowIso);
    return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // The probe must never leak internals and must never 500 with detail:
    // an explicit unknown state is honest and machine-readable.
    return NextResponse.json(
      {
        topicStatus: "unknown",
        scheduler: "unknown",
        availability: "unknown",
        databaseReachable: false,
        databaseRequiredTablesOk: null,
        proofs: {
          manualSuccess: false,
          scheduledSuccessAfterManual: false,
          idempotenceRerun: false,
          onTimeBeforeDeadline: false,
        },
        generatedAt: new Date().toISOString(),
        ageMs: 0,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
