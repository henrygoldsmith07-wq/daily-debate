import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyFailureStage,
  decideOpsAlert,
  decideOpsNotification,
  lastNotificationMarker,
  latestFailedScheduledRun,
  normaliseTopicWorkflowRun,
  withNotificationMarker,
} from "./ops-alert.mjs";

const NOW = "2026-09-16T12:00:00Z";
const okProofs = { manualSuccess: true, scheduledSuccessAfterManual: true, idempotenceRerun: true, onTimeBeforeDeadline: true };

const healthy = (over = {}) => ({
  runs: [{ event: "schedule", status: "completed", conclusion: "success", createdAt: "2026-09-16T02:00:00Z" }],
  telemetry: [{ event: "schedule", at: "2026-09-16T02:00:00Z", result: "success", targetDate: "2026-09-17" }],
  availability: { state: "ready", note: null },
  dbReadable: true,
  proofs: okProofs,
  latestConfigCheck: { ok: true, reason: "ok" },
  nowIso: NOW,
  ...over,
});

test("workflow-run normalisation preserves the id required for failed-step diagnostics", () => {
  const run = normaliseTopicWorkflowRun({
    id: 123456,
    event: "schedule",
    status: "completed",
    conclusion: "failure",
    created_at: "2026-09-16T02:00:00Z",
  });
  assert.deepEqual(run, {
    id: 123456,
    event: "schedule",
    status: "completed",
    conclusion: "failure",
    createdAt: "2026-09-16T02:00:00Z",
  });
});

test("latest failed scheduled run keeps the newest run id for the jobs API", () => {
  const failed = latestFailedScheduledRun([
    { id: 11, event: "schedule", status: "completed", conclusion: "failure", createdAt: "2026-09-15T02:00:00Z" },
    { id: 22, event: "workflow_dispatch", status: "completed", conclusion: "failure", createdAt: "2026-09-17T02:00:00Z" },
    { id: 33, event: "schedule", status: "completed", conclusion: "failure", createdAt: "2026-09-16T02:00:00Z" },
  ]);
  assert.equal(failed.id, 33);
});

test("fully healthy inputs raise no alert", () => {
  assert.equal(decideOpsAlert(healthy()), null);
});

test("consecutive scheduled failures escalate to critical", () => {
  const d = decideOpsAlert(healthy({
    runs: [
      { event: "schedule", status: "completed", conclusion: "failure", createdAt: "2026-09-16T02:00:00Z" },
      { event: "schedule", status: "completed", conclusion: "failure", createdAt: "2026-09-15T02:00:00Z" },
    ],
  }));
  assert.equal(d.alert, true);
  assert.equal(d.severity, "critical");
  assert.ok(d.facts.some((f) => f.includes("2 consecutive scheduled failures")));
});

test("missed deadline and unreadable store are critical", () => {
  for (const avail of [{ state: "missed-deadline", note: "S1 BREACH" }, { state: "invalid", note: null }]) {
    const d = decideOpsAlert(healthy({ availability: avail }));
    assert.equal(d.severity, "critical", avail.state);
  }
  const unreadable = decideOpsAlert(healthy({ dbReadable: false, availability: { state: "unknown", note: null } }));
  assert.equal(unreadable.severity, "critical");
});

test("failed config gate is critical and names the reason", () => {
  const d = decideOpsAlert(healthy({
    latestConfigCheck: { ok: false, reason: "config-failure: DATABASE_URL is required" },
  }));
  assert.equal(d.severity, "critical");
  assert.ok(d.facts.some((f) => f.includes("DATABASE_URL")));
});

test("missing proofs and unknown availability warn without going critical", () => {
  const d = decideOpsAlert(healthy({
    proofs: { ...okProofs, manualSuccess: false, idempotenceRerun: false },
    availability: { state: "pending-before-deadline", note: null },
  }));
  assert.equal(d.alert, true);
  assert.equal(d.severity, "warning");
  assert.ok(d.facts.some((f) => f.includes("manualSuccess, idempotenceRerun")));
});

test("unavailable sources (null sections) warn instead of passing silently", () => {
  const d = decideOpsAlert(healthy({ availability: null, proofs: null, runs: [], telemetry: [] }));
  assert.equal(d.alert, true);
  assert.equal(d.severity, "warning");
  assert.ok(d.facts.length >= 3);
});

test("stale scheduler (36h stall) warns", () => {
  const d = decideOpsAlert(healthy({
    runs: [{ event: "schedule", status: "completed", conclusion: "success", createdAt: "2026-09-14T00:00:00Z" }],
  }));
  assert.equal(d.severity, "warning");
  assert.ok(d.facts.some((f) => f.includes("stall detector")));
});

// --- probe unavailable mapping (digest maps a missing probe to nulls) -----

const probeUnavailable = (over = {}) =>
  healthy({ availability: null, proofs: null, dbReadable: true, telemetry: [], ...over });

test("unavailable probe warns and never claims an unreadable store", () => {
  const d = decideOpsAlert(probeUnavailable());
  assert.equal(d.alert, true);
  assert.equal(d.severity, "warning");
  assert.ok(d.facts.some((f) => f.includes("availability: state unknown")));
  assert.ok(d.facts.some((f) => f.includes("proofs: unavailable")));
  assert.ok(!d.facts.some((f) => f.includes("UNREADABLE")));
});

test("unavailable probe plus scheduler failures still escalates to critical", () => {
  const d = decideOpsAlert(probeUnavailable({
    runs: [
      { event: "schedule", status: "completed", conclusion: "failure", createdAt: "2026-09-16T02:00:00Z" },
      { event: "schedule", status: "completed", conclusion: "failure", createdAt: "2026-09-15T02:00:00Z" },
      { event: "schedule", status: "completed", conclusion: "failure", createdAt: "2026-09-14T02:00:00Z" },
    ],
  }));
  assert.equal(d.severity, "critical");
  assert.ok(d.facts.some((f) => f.includes("3 consecutive scheduled failures")));
});

test("config-gate suspect survives when only run history exists (probe down)", () => {
  const d = decideOpsAlert(probeUnavailable({
    latestConfigCheck: { ok: false, reason: "scheduled run 2026-09-16T02:00:00Z failed with no later successful run — the config/db gate (DATABASE_URL secret, connectivity, migrations) is the prime suspect" },
  }));
  assert.equal(d.severity, "critical");
  assert.ok(d.facts.some((f) => f.includes("config/db gate")));
});

test("classifyFailureStage: freshness-verification failure with schema evidence names the migration", () => {
  const c = classifyFailureStage({
    failedStepName: "Verify the write landed (freshness postconditions)",
    configStepFailed: false,
    probe: { topicFingerprintSchemaReady: false, databaseReachable: true },
    heuristicConfigReason: "scheduled run failed with no later success — config/db gate suspect",
  });
  assert.equal(c.stage, "freshness-verification");
  assert.equal(c.suspect, false);
  assert.match(c.reason, /migration 018 missing/);
});

test("classifyFailureStage: config-step failure with missing schema reports migration/schema", () => {
  const c = classifyFailureStage({
    failedStepName: "Validate topic-generation configuration (fail fast, no writes)",
    configStepFailed: true,
    probe: { topicFingerprintSchemaReady: false, databaseReachable: true },
    heuristicConfigReason: null,
  });
  assert.equal(c.stage, "migration/schema");
  assert.match(c.reason, /fingerprint schema missing/);
});

test("classifyFailureStage: no step evidence falls back to the labelled suspect", () => {
  const c = classifyFailureStage({
    failedStepName: null,
    configStepFailed: false,
    probe: null,
    heuristicConfigReason: "scheduled run failed with no later successful run — the config/db gate is the prime suspect",
  });
  assert.equal(c.stage, "configuration/schema");
  assert.equal(c.suspect, true);
});

test("classifyFailureStage: missing generation_reason schema reports migration/schema with 019", () => {
  const c = classifyFailureStage({
    failedStepName: "Validate topic-generation configuration (fail fast, no writes)",
    configStepFailed: true,
    probe: { topicFingerprintSchemaReady: true, generationReasonSchemaReady: false, databaseReachable: true },
    heuristicConfigReason: null,
  });
  assert.equal(c.stage, "migration/schema");
  assert.match(c.reason, /019_generation_reason\.sql/);
  assert.equal(c.suspect, false);
});

test("classifyFailureStage: probe schema facts are evidence even without a failed step", () => {
  // Explicit schema fact (019 missing) outranks the run-history heuristic —
  // and being evidence, it is NOT phrased as a suspect.
  const c = classifyFailureStage({
    failedStepName: null,
    configStepFailed: false,
    probe: { topicFingerprintSchemaReady: true, generationReasonSchemaReady: false, databaseReachable: true },
    heuristicConfigReason: "scheduled run failed with no later success — config/db gate suspect",
  });
  assert.equal(c.stage, "migration/schema");
  assert.equal(c.suspect, false);
  assert.match(c.reason, /019_generation_reason\.sql/);
});

test("classifyFailureStage: publication and provider stages exist for explicit evidence", () => {
  const pub = classifyFailureStage({
    failedStepName: "Upload results",
    configStepFailed: false,
    probe: null,
    heuristicConfigReason: null,
  });
  assert.equal(pub.stage, "publication");
  assert.equal(pub.suspect, false);

  const provider = classifyFailureStage({
    failedStepName: "Pre-generate tomorrow's debate topic",
    configStepFailed: false,
    probe: { topicFingerprintSchemaReady: true, generationReasonSchemaReady: true, databaseReachable: true },
    providerFailure: true,
    heuristicConfigReason: null,
  });
  assert.equal(provider.stage, "provider");
  assert.equal(provider.suspect, false);
});

test("heuristic classification reads as SUSPECTED, never as a confirmed stage", () => {
  const d = decideOpsAlert(probeUnavailable({
    latestConfigCheck: { ok: true, reason: null },
    failureStage: {
      stage: "configuration/schema",
      reason: "scheduled run failed with no later successful run — config/db gate suspect",
      suspect: true,
    },
  }));
  assert.equal(d.severity, "critical");
  assert.ok(
    d.facts.some((f) => f.includes("suspected configuration/schema failure") && f.includes("heuristic, no stage evidence")),
    `expected suspected wording, got: ${d.facts.join(" | ")}`,
  );
  assert.ok(!d.facts.some((f) => f.includes("stage = configuration/schema")), "a suspect must never read as confirmed");
});

test("ops alert reports the classified stage, not a broad guess", () => {
  const d = decideOpsAlert(probeUnavailable({
    latestConfigCheck: { ok: true, reason: null },
    failureStage: { stage: "freshness-verification", reason: "migration 018 missing (topic fingerprint schema absent)", suspect: false },
  }));
  assert.equal(d.severity, "critical");
  assert.ok(d.facts.some((f) => f.includes("stage = freshness-verification") && f.includes("migration 018")));
});

// --- production schema drift ----------------------------------------------
//
// Regression cover for the blind spot that let production sit on a
// half-migrated database: every scheduled run was green, so nothing fired,
// and the only visible symptom was a downstream "missed-deadline" with no
// stated cause and no remedy. Schema readiness must be judged on its own.

const drift = (over = {}) => ({
  requiredTablesOk: false,
  latestApplicationSchemaReady: false,
  ...over,
});

test("schema drift is critical even when every scheduled run is green", () => {
  const d = decideOpsAlert(healthy({ schema: drift() }));
  assert.equal(d.alert, true);
  assert.equal(d.severity, "critical");
  assert.ok(
    d.facts.some((f) => f.includes("PRODUCTION SCHEMA DRIFT")),
    `expected a schema-drift fact, got: ${d.facts.join(" | ")}`,
  );
});

test("schema drift is critical on its own, with availability still ready", () => {
  // The decisive case: nothing downstream is wrong yet. Before this check the
  // alert returned null here — schema drift with no symptom produced silence.
  const d = decideOpsAlert(healthy({ schema: drift(), availability: { state: "ready", note: null } }));
  assert.equal(d.alert, true);
  assert.equal(d.severity, "critical");
});

test("schema drift names the remedy so the alert is actionable", () => {
  const d = decideOpsAlert(healthy({ schema: drift() }));
  assert.ok(
    d.facts.some((f) => f.includes("db-migrate") && f.includes("explicit human decision")),
    `expected a remediation fact, got: ${d.facts.join(" | ")}`,
  );
});

test("schema drift reads as root cause above the availability symptom", () => {
  const d = decideOpsAlert(healthy({
    schema: drift(),
    availability: { state: "missed-deadline", note: null },
  }));
  const schemaAt = d.facts.findIndex((f) => f.includes("PRODUCTION SCHEMA DRIFT"));
  const availAt = d.facts.findIndex((f) => f.includes("availability:"));
  assert.ok(schemaAt !== -1 && availAt !== -1);
  assert.ok(schemaAt < availAt, "schema drift must be stated before the symptom it causes");
});

test("incomplete application schema alone is critical", () => {
  // Tables all present, but the running build needs a migration that is not
  // applied: the subtle case where the obvious check passes.
  const d = decideOpsAlert(healthy({
    schema: drift({ requiredTablesOk: true, latestApplicationSchemaReady: false }),
  }));
  assert.equal(d.severity, "critical");
  assert.ok(d.facts.some((f) => f.includes("migration schema incomplete")));
});

test("a fully ready schema adds no fact of its own", () => {
  const d = decideOpsAlert(healthy({
    schema: drift({ requiredTablesOk: true, latestApplicationSchemaReady: true }),
    availability: { state: "missed-deadline", note: null },
  }));
  assert.ok(!d.facts.some((f) => f.startsWith("schema:")), "a healthy schema must not manufacture a fact");
});

test("unavailable schema source is an alertable unknown, never green", () => {
  const d = decideOpsAlert(healthy({
    schema: null,
    availability: { state: "ready", note: null },
    proofs: okProofs,
  }));
  assert.equal(d.alert, true);
  assert.equal(d.severity, "warning");
  assert.ok(d.facts.some((f) => f.includes("schema: application-schema readiness unknown")));
});

test("a schema verdict that is present but null stays alertable", () => {
  const d = decideOpsAlert(healthy({
    schema: drift({ requiredTablesOk: true, latestApplicationSchemaReady: null }),
  }));
  assert.equal(d.alert, true);
  assert.ok(d.facts.some((f) => f.includes("could not be verified")));
});

// --- judge benchmark staleness --------------------------------------------
//
// The published benchmark artifact is what the product now labels surfaces
// from. It reaches `main` through an artifact PR that needs a repository
// permission which can be switched off without failing any run - so the record
// can sit unrefreshed for a month while still reading as authoritative.

test("a stale judge benchmark is critical and names its remediation", () => {
  const d = decideOpsAlert(healthy({
    benchmark: { at: "2026-09-14T18:46:02Z", stale: true, thresholdDays: 14 },
  }));
  assert.equal(d.alert, true);
  assert.equal(d.severity, "critical");
  assert.ok(
    d.facts.some((f) => f.includes("judge benchmark: STALE") && f.includes("2026-09-14")),
    `expected a staleness fact, got: ${d.facts.join(" | ")}`,
  );
  assert.ok(d.facts.some((f) => f.includes("pr_created") && f.includes("Workflow permissions")));
});

test("a stale judge benchmark is critical even when the topic pipeline is fine", () => {
  const d = decideOpsAlert(healthy({
    benchmark: { at: "2026-09-14T18:46:02Z", stale: true, thresholdDays: 14 },
    availability: { state: "ready", note: null },
    schema: drift({ requiredTablesOk: true, latestApplicationSchemaReady: true }),
    proofs: okProofs,
  }));
  assert.equal(d.severity, "critical");
});

test("a current judge benchmark adds no fact of its own", () => {
  const d = decideOpsAlert(healthy({
    benchmark: { at: "2026-10-03T00:00:00Z", stale: false, thresholdDays: 14 },
    availability: { state: "missed-deadline", note: null },
  }));
  assert.ok(!d.facts.some((f) => f.startsWith("judge benchmark:")), "a fresh artifact must not manufacture a fact");
});

test("an unreadable benchmark artifact is an alertable unknown", () => {
  const d = decideOpsAlert(healthy({
    benchmark: null,
    availability: { state: "ready", note: null },
    proofs: okProofs,
  }));
  assert.equal(d.alert, true);
  assert.equal(d.severity, "warning");
  assert.ok(d.facts.some((f) => f.includes("judge benchmark: staleness unknown")));
});

test("the decision layer trusts the computed staleness verdict, not the clock", () => {
  // Age is computed once, from the artifact's own timestamp, by the digest's
  // reader. The decision layer must not re-derive it from `nowIso` — that
  // would give two places to disagree about what "stale" means.
  const stale = { at: "2026-09-14T18:46:02Z", stale: true, thresholdDays: 14 };
  assert.equal(decideOpsAlert(healthy({ benchmark: stale })).severity, "critical");
  assert.equal(
    decideOpsAlert(healthy({ benchmark: stale, nowIso: "2026-09-16T00:00:00Z" })).severity,
    "critical",
    "an early clock must not soften an asserted stale verdict",
  );
  assert.equal(
    decideOpsAlert(healthy({ benchmark: { ...stale, stale: false } })),
    null,
    "the same artifact judged fresh by the reader raises no alert at all",
  );
});

// --- P2.5 notification gate -------------------------------------------------

test("notification: new alert notifies immediately; healthy with no issue stays quiet", () => {
  const fresh = decideOpsNotification({ alerting: true, openIssue: null, issueBody: null, nowIso: NOW });
  assert.equal(fresh.kind, "new");
  assert.equal(fresh.notify, true);
  const quiet = decideOpsNotification({ alerting: false, openIssue: null, issueBody: null, nowIso: NOW });
  assert.equal(quiet.kind, "none");
  assert.equal(quiet.notify, false);
});

test("notification: resolution notifies once when an open alert closes", () => {
  const resolved = decideOpsNotification({
    alerting: false,
    openIssue: { number: 27 },
    issueBody: "…\n<!-- digest:email-sent:2026-09-16T04:00:00Z -->",
    nowIso: NOW,
  });
  assert.equal(resolved.kind, "resolved");
  assert.equal(resolved.notify, true);
});

test("notification: re-notifies only after 24h of continued alerting", () => {
  const body24hAgo = withNotificationMarker("alert body", "2026-09-15T12:00:00Z"); // exactly 24h before NOW
  const reminder = decideOpsNotification({
    alerting: true,
    openIssue: { number: 27 },
    issueBody: body24hAgo,
    nowIso: NOW,
  });
  assert.equal(reminder.kind, "reminder");
  assert.equal(reminder.notify, true);

  const recent = withNotificationMarker("alert body", "2026-09-16T02:00:00Z"); // 10h before NOW
  const quiet = decideOpsNotification({
    alerting: true,
    openIssue: { number: 27 },
    issueBody: recent,
    nowIso: NOW,
  });
  assert.equal(quiet.kind, "update");
  assert.equal(quiet.notify, false);
});

test("notification: an open alert with no prior notice gets the initial email once", () => {
  const first = decideOpsNotification({
    alerting: true,
    openIssue: { number: 27 },
    issueBody: "legacy body without any marker",
    nowIso: NOW,
  });
  assert.equal(first.kind, "new");
  assert.equal(first.notify, true);
});

test("notification markers: newest wins, unreadable timestamps re-notify", () => {
  const body = [
    "<!-- digest:email-sent:2026-09-10T04:00:00Z -->",
    "<!-- digest:email-sent:2026-09-16T02:00:00Z -->",
  ].join("\n");
  assert.equal(lastNotificationMarker(body), "2026-09-16T02:00:00Z");
  assert.equal(lastNotificationMarker("no markers"), null);
  assert.equal(lastNotificationMarker(null), null);

  const corrupt = decideOpsNotification({
    alerting: true,
    openIssue: { number: 27 },
    issueBody: "<!-- digest:email-sent:not-a-date -->",
    nowIso: NOW,
  });
  assert.equal(corrupt.kind, "reminder");
  assert.equal(corrupt.notify, true);
});
