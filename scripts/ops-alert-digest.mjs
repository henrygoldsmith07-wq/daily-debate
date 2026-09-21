#!/usr/bin/env node
// Daily ops-alert digest for the topic pipeline.
//
// Nothing watched the watcher: the production pipeline failed for five days
// (missing DATABASE_URL secret) with zero human signal, because ops health
// only reports on a dashboard. This digest runs in CI once a day and turns
// the same evidence into a GitHub issue:
//
//   alerting state  -> open or update ONE issue labeled `ops-alert`
//   healthy state   -> close any open `ops-alert` issue with a resolution note
//
// Judgement lives in scripts/lib/ops-alert.mjs (pure, unit-tested); this
// script is I/O only. Evidence sources:
//
//   1. GitHub run history (public REST, token optional) — scheduler truth.
//   2. The deployed app's PUBLIC health probe (/api/health) — availability,
//      proofs, and store readability. This replaced a direct DATABASE_URL
//      connection: the probe serves the canonical loadOpsHealth() reduction
//      (src/lib/healthProbe.ts), so availability/proof judgement is never
//      re-derived here, and the workflow no longer needs the DATABASE_URL
//      secret whose absence caused the 2026-09 outage. The app is the
//      second witness — if it is down, that difference is diagnostic, and
//      scheduler facts from GitHub still alert on their own.
//
// Best-effort by design: a failed source degrades to "unavailable" (which
// the decision layer treats as alertable-unknown); it never throws.
//
// Env: GITHUB_TOKEN (optional; issues:write if set), PROD_HEALTH_URL
//      (optional; default https://dailydebate.app), OPS_ALERT_LABEL
//      (optional, default "ops-alert").
//
// Exit codes: 0 always (alerting must never break CI); "1" only on misuse.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { decideOpsAlert } from "./lib/ops-alert.mjs";

const REPO = "henrygoldsmith07-wq/daily-debate";
const LABEL = process.env.OPS_ALERT_LABEL?.trim() || "ops-alert";
const PROD_BASE = (process.env.PROD_HEALTH_URL?.trim() || "https://dailydebate.app").replace(/\/+$/, "");

function gh(path, token, init) {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

/** Last 12 topic-generation runs with event/status/conclusion/createdAt. */
async function fetchRuns(token) {
  try {
    const res = await gh(
      `/repos/${REPO}/actions/workflows/topic-generation.yml/runs?per_page=12`,
      token,
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.workflow_runs ?? [])
      .filter((r) => r.created_at)
      .map((r) => ({
        event: r.event ?? "unknown",
        status: r.status ?? "unknown",
        conclusion: r.conclusion ?? null,
        createdAt: r.created_at,
      }));
  } catch {
    return [];
  }
}

/**
 * Fetch the deployed app's public health probe and validate it is fresh and
 * internally coherent (src/lib/healthProbe.ts `isUsableProbe`). Returns null
 * when unavailable — NEVER a guess: an unavailable probe must not be read as
 * either healthy or broken store state.
 */
async function fetchProbe(nowIso) {
  try {
    const res = await fetch(`${PROD_BASE}/api/health`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const state = await res.json();
    if (!state || typeof state !== "object") return null;
    // Local mirror of isUsableProbe's two hard checks (the TS module cannot
    // be imported from a standalone .mjs without a TS runtime):
    const maxAgeMs = 90 * 60_000; // probe must describe a report < 90 min old
    if (state.databaseReachable === false && state.availability === "ready") return null;
    const generated = Date.parse(String(state.generatedAt ?? ""));
    const now = Date.parse(nowIso);
    if (!Number.isFinite(generated) || !Number.isFinite(now)) return null;
    if (now - generated > maxAgeMs) return null;
    return state;
  } catch {
    return null;
  }
}

/**
 * Heuristic only used when the probe cannot speak: a failed scheduled run
 * that recorded no later success of any kind died before doing its job — the
 * config/db gate (DATABASE_URL secret, connectivity, migrations) is the
 * prime suspect. With a live probe, availability/proofs make this redundant.
 */
function latestConfigGate(runs) {
  const failed = runs
    .filter((r) => r.event === "schedule" && r.status === "completed" && r.conclusion === "failure")
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  if (!failed) return { ok: true, reason: null };
  const laterSuccess = runs.some(
    (r) => r.status === "completed" && r.conclusion === "success" && Date.parse(r.createdAt) > Date.parse(failed.createdAt),
  );
  if (laterSuccess) return { ok: true, reason: null };
  return {
    ok: false,
    reason: `scheduled run ${failed.createdAt} failed with no later successful run — the config/db gate (DATABASE_URL secret, connectivity, migrations) is the prime suspect`,
  };
}

async function main() {
  const token = process.env.GITHUB_TOKEN?.trim() || null;
  const nowIso = new Date().toISOString();

  const runs = await fetchRuns(token);
  const probe = await fetchProbe(nowIso);

  // Map probe evidence onto the decision input. A missing probe leaves
  // availability/proofs as null ("source unavailable" -> alertable warning)
  // and never asserts store unreadability by itself.
  const availability = probe ? { state: probe.availability ?? "unknown", note: null } : null;
  const dbReadable = probe ? probe.databaseReachable === true : true;
  const proofs = probe?.proofs ?? null;

  const decision = decideOpsAlert({
    runs,
    telemetry: [],
    availability,
    dbReadable,
    proofs,
    latestConfigCheck: latestConfigGate(runs),
    nowIso,
  });

  // --- issue management ----------------------------------------------------
  const listRes = await gh(`/repos/${REPO}/issues?state=open&labels=${encodeURIComponent(LABEL)}&per_page=10`, token);
  const openAlerts = listRes.ok ? await listRes.json() : [];

  if (!decision) {
    for (const issue of openAlerts) {
      await gh(`/repos/${REPO}/issues/${issue.number}/comments`, token, {
        method: "POST",
        body: JSON.stringify({
          body: `Resolved as of ${nowIso} — all topic-pipeline checks pass. Closing this alert.\n\n<!-- digest:auto-close -->`,
        }),
      });
      await gh(`/repos/${REPO}/issues/${issue.number}`, token, { method: "PATCH", body: JSON.stringify({ state: "closed" }) });
      console.log(`[ops-alert] healthy — closed #${issue.number}`);
    }
    console.log("[ops-alert] healthy — no open alert issues");
    process.exit(0);
  }

  const body = [
    `**Severity:** ${decision.severity} · **Assessed:** ${decision.evidence}`,
    "",
    ...decision.facts.map((f) => `- ${f}`),
    "",
    probe
      ? `_Availability and proofs via ${PROD_BASE}/api/health (report generated ${probe.generatedAt}); scheduler facts via GitHub run history._`
      : `_Health probe (${PROD_BASE}/api/health) unavailable — availability and proofs could not be assessed. Scheduler facts via GitHub run history._`,
    "",
    "_This issue is managed by the daily ops-alert digest (`.github/workflows/ops-alert.yml`).",
    "It updates in place while alerting and auto-closes when the pipeline is provably healthy._",
    "",
    "<!-- digest:fingerprint -->",
  ].join("\n");

  const existing = openAlerts[0];
  if (existing) {
    await gh(`/repos/${REPO}/issues/${existing.number}`, token, {
      method: "PATCH",
      body: JSON.stringify({ title: decision.title, body, state: "open" }),
    });
    console.log(`[ops-alert] still alerting (${decision.severity}) — updated #${existing.number}`);
  } else {
    await gh(`/repos/${REPO}/labels`, token, {
      method: "POST",
      body: JSON.stringify({ name: LABEL, color: "D93F0B", description: "Daily Debate topic-pipeline ops alerts" }),
    }); // 422 = already exists; fine.
    const createRes = await gh(`/repos/${REPO}/issues`, token, {
      method: "POST",
      body: JSON.stringify({ title: decision.title, body, labels: [LABEL] }),
    });
    const created = await createRes.json();
    console.log(`[ops-alert] ALERT (${decision.severity}) — opened #${created.number}: ${decision.facts.join(" | ")}`);
  }
  process.exit(0);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((e) => {
    process.stderr.write(String(e?.stack ?? e) + "\n");
    process.exit(0); // alerting must never fail CI
  });
}
