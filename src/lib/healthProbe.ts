// Public health-probe state (pure, unit-tested).
//
// A public, unauthenticated, NON-SENSITIVE summary of topic-pipeline health:
// booleans and enum states only — no titles, no dates beyond coarse state,
// no identifiers, no counters that could profile usage. The daily ops-alert
// digest consumes this over HTTP so the workflow needs neither the
// DATABASE_URL secret nor any GitHub PAT: the deployed app is the witness
// that can actually read the production store.
//
// This is a SECOND witness, not the primary: the app serving this probe can
// itself be down, and its DB view uses the app runtime's service key (which
// is independent of the Actions DATABASE_URL secret whose absence caused the
// 2026-09 outage). Judgement semantics stay canonical by construction — the
// input is the real `loadOpsHealth()` report, never a re-derivation.

import type { OpsHealthReport } from "./opsHealth";

export interface PublicHealthState {
  /** Coarse overall topic-pipeline state (worst of scheduler + availability). */
  topicStatus: OpsHealthReport["topicSlo"]["status"];
  scheduler: OpsHealthReport["topicSlo"]["scheduler"]["state"];
  availability: OpsHealthReport["topicSlo"]["availability"]["state"];
  databaseReachable: boolean;
  databaseRequiredTablesOk: boolean | null;
  /** Is the migration-018 topic-fingerprint schema present? null = unknown.
   *  This is the fact whose absence caused scheduled-run failures #54-#59. */
  topicFingerprintSchemaReady: boolean | null;
  /** Is the migration-019 generation_reason schema (column + value
   *  constraint) present? null = unknown. Coarse boolean only. */
  generationReasonSchemaReady: boolean | null;
  /** The production proofs (item 7), exposed as plain booleans. Typed as the
   *  canonical slice so upstream proof changes surface here at compile time. */
  proofs: OpsHealthReport["topicSlo"]["proofs"];
  /** When the upstream report was generated (the probe consumer checks this). */
  generatedAt: string;
  /** Bounded staleness guard for consumers: report age in ms. */
  ageMs: number | null;
}

/**
 * Reduce the full ops-health report to the publishable, non-sensitive subset.
 * Deterministic: identical reports produce identical probe state.
 */
export function derivePublicHealthState(report: OpsHealthReport, nowIso: string): PublicHealthState {
  const generatedMs = Date.parse(report.generatedAt);
  const nowMs = Date.parse(nowIso);
  return {
    topicStatus: report.topicSlo.status,
    scheduler: report.topicSlo.scheduler.state,
    availability: report.topicSlo.availability.state,
    databaseReachable: report.database.reachable,
    databaseRequiredTablesOk: report.database.requiredTablesOk,
    topicFingerprintSchemaReady: report.database.migrationReadiness.migration018TopicFingerprintReady,
    generationReasonSchemaReady: report.database.migrationReadiness.migration019GenerationReasonReady,
    proofs: { ...report.topicSlo.proofs },
    generatedAt: report.generatedAt,
    ageMs: Number.isFinite(generatedMs) && Number.isFinite(nowMs) ? Math.max(0, nowMs - generatedMs) : null,
  };
}

/**
 * Consumer-side sanity gate for a fetched probe payload: is it well-formed,
 * recent enough to act on, and internally coherent (a probe cannot claim a
 * ready topic while its own database check failed)?
 */
export function isUsableProbe(state: PublicHealthState, nowIso: string, maxAgeMs: number): boolean {
  if (state.databaseReachable === false && state.availability === "ready") return false;
  // The freshness verifier hard-fails without the 018 schema, so any "ready"
  // claim from a probe that also reports the schema missing is incoherent —
  // a stale or version-skewed witness, not usable evidence.
  if (state.topicFingerprintSchemaReady === false && state.availability === "ready") return false;
  if (state.ageMs !== null && state.ageMs > maxAgeMs) return false;
  if (state.ageMs === null) {
    const generated = Date.parse(state.generatedAt);
    const now = Date.parse(nowIso);
    if (!Number.isFinite(generated) || !Number.isFinite(now)) return false;
    if (now - generated > maxAgeMs) return false;
  }
  return true;
}
