import { NextResponse } from "next/server";
import { loadOpsHealth } from "@/lib/opsHealthServer";
import { derivePublicHealthState } from "@/lib/healthProbe";
import type { OpsHealthReport } from "@/lib/opsHealth";
import { checkRateLimit } from "@/lib/rateLimit";

/**
 * The all-unknown report used when loadOpsHealth itself fails. Built through
 * the SAME derivePublicHealthState reduction as the success path, so the two
 * response schemas can never drift — a new report field flows into both
 * branches (or fails the contract test) automatically.
 */
function unknownReport(): OpsHealthReport {
  return {
    generatedAt: new Date().toISOString(),
    topic: {},
    topicSlo: {
      scheduler: { state: "unknown", consecutiveScheduledFailures: 0, lastScheduledRunAt: null, lastScheduledRunConclusion: null },
      availability: { state: "unknown", deadlineUtc: "03:00", note: null },
      scheduling: { latestDelayMs: null, medianDelayMs: null, p95DelayMs: null, missedStarts: 0, thresholdMs: 0, note: null },
      status: "unknown",
      lastSuccessfulRun: null,
      proofs: {
        databaseReachable: false,
        manualSuccess: false,
        scheduledSuccessAfterManual: false,
        sameDateContentIdempotence: false,
        onTimeBeforeDeadline: false,
        aiGeneratedProductionSuccess: false,
      },
      note: null,
    },
    judge: {},
    database: { status: "blocked", reachable: false, latencyMs: null, migrationsApplied: null, requiredTablesOk: null, missingTables: [], topicRunLogFidelity: "unknown", migrationReadiness: { migration016TelemetryReady: null, migration017RouteLifecycleReady: null, migration018TopicFingerprintReady: null, migration019GenerationReasonReady: null, migration022ProductEventReasonReady: null, migration023FriendChallengeReady: null, migration024HumanValidationReady: null, latestApplicationSchemaReady: null, note: null }, note: null },
    app: {},
    coach: { status: "unknown", headline: "", facts: [], note: null, startsSampled: 0, degradedStarts: 0, latestDegradedAt: null, reasonCounts: {} },
    human: { status: "unknown", headline: "", facts: [], note: null },
    training: { status: "unknown", headline: "", facts: [], note: null, measurement: "unknown", outcomes: [] },
  } as unknown as OpsHealthReport;
}

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
    // The error branch MUST expose the exact same schema as the success
    // branch (one stable public contract): every key of PublicHealthState,
    // degraded to unknown/false/null. Legacy proof keys (e.g.
    // `idempotenceRerun`) are a contract violation — the canonical six-proof
    // shape comes from the typed OpsHealthReport, never a hand-copied literal.
    const state = derivePublicHealthState(unknownReport(), new Date().toISOString());
    return NextResponse.json(state, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
