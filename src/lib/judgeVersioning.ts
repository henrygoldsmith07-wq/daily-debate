// Judge versioning — every verdict carries a stable fingerprint so model drift
// is detectable and attributable. When agreement drops from 79% → 71%, you
// know exactly which results were affected.
//
// The fingerprint captures everything that could influence a verdict:
// provider identity, model slug/revision, prompt wording version, the
// deterministic scoring engine version, the graph schema version, sampling
// temperature, and the ensemble composition. Pure — no I/O.

import type { JudgeId } from "./ensembleJudge";

/** Bump when any prompt wording changes — even minor rewording shifts outputs. */
export const PROMPT_VERSION = 3;

/** Bump when observableAssessment.ts scoring weights/formula change. */
export const SCORING_ENGINE_VERSION = 1;

/** Bump when argGraph node kinds, edge relations, or required fields change. */
export const GRAPH_SCHEMA_VERSION = 1;

export interface JudgeFingerprint {
  /** Which transport produced this verdict */
  provider: string;
  /** Model slug sent to the API (e.g. "nvidia/nemotron-3-ultra") */
  model: string;
  /** Model revision/snapshot if reported by provider; null otherwise */
  revision?: string | null;
  /** Prompt wording version — bump on any rewording */
  promptVersion: number;
  /** Deterministic scoring engine version */
  scoringEngineVersion: number;
  /** Graph schema version */
  graphSchemaVersion: number;
  /** Sampling temperature used */
  temperature: number;
  /** Full ensemble composition (all judges attempted, regardless of success) */
  ensemble: string[];
}

/**
 * Build a version fingerprint for a single judge call. Pure — no side effects.
 * Callers supply the model slug and provider; the rest comes from constants.
 */
export function makeFingerprint(
  provider: JudgeId | string,
  model: string,
  opts?: {
    revision?: string | null;
    temperature?: number;
    ensemble?: string[];
  }
): JudgeFingerprint {
  return {
    provider,
    model,
    revision: opts?.revision ?? null,
    promptVersion: PROMPT_VERSION,
    scoringEngineVersion: SCORING_ENGINE_VERSION,
    graphSchemaVersion: GRAPH_SCHEMA_VERSION,
    temperature: opts?.temperature ?? 0,
    ensemble: opts?.ensemble ?? [provider],
  };
}

/**
 * Build a composite fingerprint for an ensemble result.
 * Captures every judge that was ATTEMPTED (even if one failed).
 */
export function makeEnsembleFingerprint(
  fingerprints: JudgeFingerprint[]
): JudgeFingerprint {
  if (!fingerprints.length) {
    throw new Error("Cannot make ensemble fingerprint from empty list");
  }

  // Use the first fingerprint as the base (primary judge)
  const primary = fingerprints[0];

  return {
    ...primary,
    ensemble: fingerprints.map((f) => `${f.provider}:${f.model}`),
  };
}

/** Compact string form for logs and DB columns: "nvidia:nemotron-3-ultra@pv3" */
export function fingerprintToString(fp: JudgeFingerprint): string {
  const rev = fp.revision ? `@${fp.revision}` : "";
  const ens = fp.ensemble.length > 1 ? `+${fp.ensemble.length - 1}` : "";
  return `${fp.provider}:${fp.model}${rev}@pv${fp.promptVersion}.se${fp.scoringEngineVersion}.gs${fp.graphSchemaVersion}t${fp.temperature}${ens}`;
}
