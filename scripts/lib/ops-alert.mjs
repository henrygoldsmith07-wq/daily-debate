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
 * @param {{
 *   runs: Array<{ event: string; status: string; conclusion: string | null; createdAt: string }>,
 *   telemetry: Array<{ event: string; at: string; result: string; targetDate: string | null }>,
 *   availability: { state: string; note?: string | null } | null,
 *   dbReadable: boolean,
 *   proofs: { manualSuccess: boolean; scheduledSuccessAfterManual: boolean; idempotenceRerun: boolean; onTimeBeforeDeadline: boolean } | null,
 *   latestConfigCheck: { ok: boolean; reason: string | null } | null,
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
  if (cfg && cfg.ok === false) {
    facts.push(`config: ${cfg.reason ?? "config check failed"}`);
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
