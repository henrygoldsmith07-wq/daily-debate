// Canonical evaluation envelope + version stamping.
//
// Every stored evaluation (PvP judge verdict, solo summary/assessment) carries
// an explicit version stamp so historical results can be distinguished when
// the scoring policy or the persisted evaluation shape changes. The stamps are
// additive optional fields — older rows simply lack them.

import type { AssessmentStatus, ObservableAssessment } from "./observableAssessment";
import type { DebateSummary, EvaluationStamp, PvpVerdict } from "./types";
import { SCORING_ENGINE_VERSION } from "./judgeVersioning";

/**
 * Bump when the persisted evaluation envelope shape changes: fields added,
 * renamed, or re-semanticed. Consumers must treat an unfamiliar version as
 * "read fields best-effort, never recompute rewards from it".
 */
export const EVALUATION_SCHEMA_VERSION = 2;

/**
 * The scoring policy version in force at evaluation time. Mirrors
 * SCORING_ENGINE_VERSION (observableAssessment weights/formula) so a stored
 * evaluation is attributable to the exact policy that produced it.
 */
export const POLICY_VERSION = SCORING_ENGINE_VERSION;

export interface DebateEvaluationResult {
  stamp: EvaluationStamp;
  scoreStatus: AssessmentStatus;
  verdict?: PvpVerdict;
  summary?: DebateSummary;
  observableAssessment?: ObservableAssessment;
}

/** Build the version stamp for an evaluation happening now. Pure. */
export function evaluationStamp(now: Date = new Date()): EvaluationStamp {
  return {
    schemaVersion: EVALUATION_SCHEMA_VERSION,
    policyVersion: POLICY_VERSION,
    evaluatedAt: now.toISOString(),
  };
}

/**
 * Attach the evaluation stamp to a PvP verdict without disturbing its shape
 * (readers of judge_verdict jsonb keep working; the stamp is additive).
 * Returns a new object — never mutates the input.
 */
export function stampVerdict(verdict: PvpVerdict, now: Date = new Date()): PvpVerdict {
  return { ...verdict, evaluation: evaluationStamp(now) };
}

/** Wrap any evaluation parts into the canonical envelope. Pure. */
export function buildEvaluationResult(
  parts: Omit<DebateEvaluationResult, "stamp">,
  now: Date = new Date(),
): DebateEvaluationResult {
  return { ...parts, stamp: evaluationStamp(now) };
}
