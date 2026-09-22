// Ops-alert digest decision logic (pure, unit-testable).
//
// Nothing watched the watcher: the production topic pipeline failed six
// scheduled runs over five days because the DATABASE_URL secret was missing,
// and no human signal existed — ops health computed the right states but
// only on a dashboard nobody was obliged to open. This module turns an
// assessment into a deterministic alert decision:
//
//   alert when the topic SLO is degraded / stale / failed, OR a production
//   proof is missing, OR a config gate failed on the latest run;
//   stay quiet (null) when everything is provably fine — no alert fatigue.
//
// The JSON decision is data: the CI step renders it into a GitHub issue
// without re-implementing any judgement.

/**
 * Stage-aware failure classification (pure).
 *
 * A failed scheduled run is NOT necessarily a config failure: today's runs
 * prove a failure can be config=pass → generation=pass → freshness=FAIL.
 * Classify from the strongest available evidence, in order:
 *
 *   1. the failed workflow STEP name (GitHub jobs API) — real stage evidence;
 *   2. the health probe's migration-schema flags (018 + 019 readiness);
 *   3. the legacy heuristic (failed run with no later success) — phrased as
 *      a SUSPECTED configuration/schema failure, never as a fact.
 *
 * Canonical stage vocabulary:
 *   configuration | migration/schema | provider | generation
 *   | database-write | freshness-verification | telemetry | publication
 *   | configuration/schema (heuristic suspect only) | unknown
 *
 * @param {{
 *   failedStepName: string | null,
 *   configStepFailed: boolean,
 *   probe: { topicFingerprintSchemaReady: boolean | null, generationReasonSchemaReady?: boolean | null, databaseReachable: boolean | null } | null,
 *   providerFailure?: boolean | null,
 *   heuristicConfigReason: string | null,
 * }} input
 * @returns {{ stage: string, reason: string, suspect: boolean } | null}
 */
export function classifyFailureStage(input) {
  const step = (input.failedStepName ?? "").toLowerCase();
  const probe018 = input.probe?.topicFingerprintSchemaReady ?? null;
  const probe019 = input.probe?.generationReasonSchemaReady ?? null;
  if (/publish|artifact|upload/.test(step)) {
    return { stage: "publication", reason: "artifact publication failed (automation path, not topic generation)", suspect: false };
  }
  if (/freshness/.test(step)) {
    const reason = probe018 === false
      ? "migration 018 missing (topic fingerprint schema absent)"
      : input.heuristicConfigReason ?? "stored topic failed the freshness postconditions";
    return { stage: "freshness-verification", reason, suspect: false };
  }
  if (/config/.test(step)) {
    if (probe018 === false) {
      return { stage: "migration/schema", reason: "required production topic fingerprint schema missing; apply database migrations before topic generation", suspect: false };
    }
    if (probe019 === false) {
      return { stage: "migration/schema", reason: "required generation_reason schema missing; apply database migrations (019_generation_reason.sql) before topic generation", suspect: false };
    }
    return { stage: "configuration", reason: input.heuristicConfigReason ?? "config validation failed before any generation attempt", suspect: false };
  }
  if (/pre-generate|generation/.test(step)) {
    if (input.providerFailure === true) {
      return { stage: "provider", reason: "generation ran but the provider chain failed before producing candidates", suspect: false };
    }
    if (input.probe?.databaseReachable === false) {
      return { stage: "database-write", reason: "generation ran but the production store is unreachable", suspect: false };
    }
    return { stage: "generation", reason: "the generation step failed (provider chain or topic write)", suspect: false };
  }
  if (/telemetry/.test(step)) {
    return { stage: "telemetry", reason: "the telemetry step failed", suspect: false };
  }
  // No step evidence. The probe's schema flags are still EXPLICIT facts (a
  // schema the pipeline provably refuses to run without) — only when they
  // are unavailable does the run-history heuristic get a say, and then it
  // speaks as a SUSPECT, never as a confirmed classification (item 20).
  if (input.heuristicConfigReason) {
    if (probe018 === false) {
      return { stage: "migration/schema", reason: "required production topic fingerprint schema missing; apply database migrations before topic generation", suspect: false };
    }
    if (probe019 === false) {
      return { stage: "migration/schema", reason: "required generation_reason schema missing; apply database migrations (019_generation_reason.sql) before topic generation", suspect: false };
    }
    return { stage: "configuration/schema", reason: input.heuristicConfigReason, suspect: true };
  }
  return null;
}

/**
 * @param {{
 *   runs: Array<{ event: string; status: string; conclusion: string | null; createdAt: string }>,
 *   telemetry: Array<{ event: string; at: string; result: string; targetDate: string | null; delayMs?: number | null }>,
 *   availability: { state: string; note?: string | null } | null,
 *   dbReadable: boolean,
 *   proofs: Record<string, boolean> | null,
 *   latestConfigCheck: { ok: boolean; reason: string | null } | null,
 *   failureStage: { stage: string; reason: string; suspect: boolean } | null,
 *   nowIso: string,
 * }} input  null sections mean "source unavailable" — treated as alertable unknowns.
 * @returns {{ alert: boolean, severity: "critical" | "warning" | null, title: string, facts: string[], evidence: string } | null}
 */
export function decideOpsAlert(input) {
  const facts = [];
  let severity = null;
  const now = input.nowIso;

  // --- scheduler run history (GitHub) ------------------------------------
  const runs = input.runs ?? [];
  const scheduled = runs
    .filter((r) => r.event === "schedule")
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const completed = scheduled.filter((r) => r.status === "completed");
  let consecutiveFailures = 0;
  for (const r of completed) {
    if (r.conclusion === "success") break;
    consecutiveFailures += 1;
  }
  if (consecutiveFailures > 0) {
    facts.push(`scheduler: ${consecutiveFailures} consecutive scheduled failure${consecutiveFailures === 1 ? "" : "s"}`);
    severity = "critical";
  }
  const newestScheduled = scheduled[0] ?? null;
  if (newestScheduled) {
    const hoursSince = (Date.parse(now) - Date.parse(newestScheduled.createdAt)) / 3_600_000;
    if (hoursSince > 36) {
      facts.push(`scheduler: newest scheduled run is ${Math.round(hoursSince)}h old (stall detector)`);
      if (severity === null) severity = "warning";
    }
  }
  if (!scheduled.length && runs.length === 0) {
    // No run history at all: source unavailable or scheduler never fired.
    facts.push("scheduler: no scheduled runs on record — either never fired or run history unavailable");
    if (severity === null) severity = "warning";
  }

  // --- availability (production store) ------------------------------------
  const avail = input.availability;
  if (!avail) {
    facts.push("availability: state unknown (assessment source unavailable)");
    if (severity === null) severity = "warning";
  } else if (!input.dbReadable) {
    facts.push(`availability: production store UNREADABLE (reported ${avail.state})`);
    severity = "critical";
  } else if (avail.state === "missed-deadline" || avail.state === "invalid") {
    facts.push(`availability: ${avail.state}${avail.note ? ` — ${avail.note}` : ""}`);
    severity = "critical";
  } else if (avail.state === "unknown") {
    facts.push("availability: unknown");
    if (severity === null) severity = "warning";
  }

  // --- production proofs ---------------------------------------------------
  const proofs = input.proofs;
  if (!proofs) {
    facts.push("proofs: unavailable (telemetry source missing)");
    if (severity === null) severity = "warning";
  } else {
    const missing = Object.entries(proofs).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) {
      facts.push(`proofs: not yet proven — ${missing.join(", ")}`);
      // Missing proofs are expected during bring-up: warning, never critical.
      if (severity === null) severity = "warning";
    }
  }

  // --- latest config gate (the DATABASE_URL class of failure) --------------
  const cfg = input.latestConfigCheck;
  if (cfg && cfg.ok === false && !input.failureStage) {
    facts.push(`config: ${cfg.reason ?? "config check failed"}`);
    severity = "critical";
  }

  // --- stage-aware failure classification (no more broad guessing) ---------
  const stage = input.failureStage;
  if (stage) {
    // Lack of evidence is never converted into certainty: a heuristic
    // classification reads as "suspected … failure", an evidence-backed one
    // names the stage flatly (item 20).
    facts.push(
      stage.suspect
        ? `production topic pipeline failure — suspected ${stage.stage} failure (heuristic, no stage evidence): ${stage.reason}`
        : `production topic pipeline failure — stage = ${stage.stage}, reason = ${stage.reason}`,
    );
    severity = "critical";
  }

  if (!facts.length) return null;
  return {
    alert: true,
    severity: severity ?? "warning",
    title: `Topic pipeline ops alert (${severity ?? "warning"})`,
    facts,
    evidence: `assessed at ${now} over ${runs.length} workflow run(s) and ${(input.telemetry ?? []).length} telemetry row(s)`,
  };
}
