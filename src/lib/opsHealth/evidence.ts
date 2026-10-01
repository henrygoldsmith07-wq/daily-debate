// Production-evidence sections.
//
// These inform trust rather than operational availability: human validation
// of the judge, coaching runtime health, and whether the training loop is
// measurable yet. `INSUFFICIENT DATA` is an honest output here, not a bug to
// hide behind a green checkmark.

import { rollupOverall, type HealthState } from "./core";
import type { CoachingContextDegradationReason } from "../types";


/**
 * A production-evidence section: one explicitly-stated status with its
 * facts and denominators. Used for subsystems that inform trust but are not
 * part of the operational overall roll-up (human validation, training
 * effectiveness). Unknown/insufficient stays visible, never green-washed.
 */
export interface EvidenceSection {
  status: HealthState;
  headline: string;
  facts: Array<{ label: string; value: string }>;
  note: string | null;
}

export interface HumanValidationInput {
  items: number;
  raters: number;
  itemsWithTwoPlusRatings: number;
  itemsWithThreePlusRatings?: number;
  consensusReady: number;
  unresolvedDisagreements: number;
  meanWinnerKappa: number | null;
  canUseAsGroundTruth: boolean;
  adjudicatedItems?: number;
  correctedRatings?: number;
  presentationBalance?: number | null;
}

export function assessHumanValidation(input: HumanValidationInput): EvidenceSection {
  const facts = [
    { label: "Corpus items", value: String(input.items) },
    { label: "Raters", value: String(input.raters) },
    { label: "Independently rated (≥2)", value: String(input.itemsWithTwoPlusRatings) },
    { label: "Calibration-rated (≥3)", value: String(input.itemsWithThreePlusRatings ?? 0) },
    { label: "Consensus-ready", value: String(input.consensusReady) },
    { label: "Unresolved disagreements", value: String(input.unresolvedDisagreements) },
    { label: "Adjudicated", value: String(input.adjudicatedItems ?? 0) },
    { label: "Corrected ratings (audited)", value: String(input.correctedRatings ?? 0) },
    {
      label: "Presentation balance (A-first vs B-first)",
      value: input.presentationBalance === null || input.presentationBalance === undefined
        ? "—"
        : input.presentationBalance.toFixed(2),
    },
    { label: "Mean winner κ", value: input.meanWinnerKappa === null ? "—" : input.meanWinnerKappa.toFixed(3) },
  ];
  if (input.items === 0 || input.itemsWithTwoPlusRatings === 0) {
    return {
      status: "blocked",
      headline: "no independently-rated debates yet",
      facts,
      note: "The corpus cannot validate the judge until ≥2 independent raters cover real debates.",
    };
  }
  if (input.canUseAsGroundTruth) {
    return {
      status: "healthy",
      headline: "pilot consensus gate met",
      facts,
      note: "Judge-vs-human pilot estimates may use consensus-ready items only; stronger validity claims still require the staged 500/1,000-item corpus targets.",
    };
  }
  return {
    status: "degraded",
    headline: "collecting — pilot consensus gate not yet met",
    facts,
    note: "Agreement numbers are provisional; Stage 2/3 validity claims require larger, ≥3-rater samples.",
  };
}

export interface TrainingEvidenceInput {
  repairs: number;
  retestsObserved: number;
  retestsPending: number;
  /** First-retest recurrence rate, or null below the minimum sample. */
  firstRetestRate: number | null;
  firstRetestN: number;
  /** Repairs with ≥3 eligible retests (equal-exposure window); may be 0. */
  firstThreeDenominator: number;
  /** Median eligible retests until first recurrence; null when unmeasured. */
  medianOpportunitiesToRecurrence: number | null;
  /** Observed-but-not-recurring repairs (censored, never counted clean). */
  censoredRepairs: number;
}

export interface CoachingRuntimeInput {
  startsSampled: number;
  degradedStarts: number;
  truncated: boolean;
  latestDegradedAt: string | null;
  reasonCounts: Partial<Record<CoachingContextDegradationReason, number>>;
}

export interface CoachingRuntimeHealth extends EvidenceSection {
  startsSampled: number;
  degradedStarts: number;
  truncated: boolean;
  latestDegradedAt: string | null;
  reasonCounts: Partial<Record<CoachingContextDegradationReason, number>>;
}

export function assessCoachingRuntimeHealth(
  input: CoachingRuntimeInput,
): CoachingRuntimeHealth {
  const facts = [
    { label: "Recent solo starts sampled", value: String(input.startsSampled) },
    { label: "Starts with degraded coaching context", value: String(input.degradedStarts) },
    { label: "Seven-day sample truncated", value: input.truncated ? "yes" : "no" },
  ];
  for (const [reason, count] of Object.entries(input.reasonCounts)) {
    if (!count) continue;
    facts.push({ label: `Degradation · ${reason}`, value: String(count) });
  }

  if (input.startsSampled === 0) {
    return {
      status: "unknown",
      headline: "no recent solo starts to assess coaching runtime",
      facts,
      note: "Runtime coaching availability is unresolved until a solo debate starts.",
      ...input,
    };
  }
  if (input.degradedStarts === 0) {
    return {
      status: input.truncated ? "degraded" : "healthy",
      headline: input.truncated
        ? "recent coaching starts are healthy in a capped sample"
        : "recent solo starts loaded coaching context successfully",
      facts,
      note: input.truncated
        ? "More than 100 solo starts occurred in the seven-day window; health reflects only the newest 100 and is therefore partial."
        : null,
      ...input,
    };
  }
  return {
    status: "degraded",
    headline: `${input.degradedStarts}/${input.startsSampled} recent solo starts degraded coaching context`,
    facts,
    note: "Debates remain usable by design, but one or more coaching dependencies failed. Investigate before treating a missing goal/retest as intentional.",
    ...input,
  };
}

/** Measurement readiness — never an outcome judgement. */
export type MeasurementState = "insufficient" | "measurable" | "stale" | "invalid";

export interface TrainingEvidence extends EvidenceSection {
  /** Why data can (or cannot) support a metric — distinct from the metric itself. */
  measurement: MeasurementState;
  /** Observed values, reported as observations with denominators. */
  outcomes: Array<{ label: string; value: string }>;
}

export function assessTrainingEvidence(input: TrainingEvidenceInput): TrainingEvidence {
  const facts = [
    { label: "Completed repairs", value: String(input.repairs) },
    { label: "Explicit observable retests observed", value: String(input.retestsObserved) },
    { label: "Awaiting retest (pending, never counted clean)", value: String(input.retestsPending) },
    { label: "Censored (observed, no recurrence yet)", value: String(input.censoredRepairs) },
    { label: "Equal-exposure denominator (explicit retest + ≥2 follow-ups)", value: String(input.firstThreeDenominator) },
  ];
  // OBSERVED OUTCOMES — reported with denominators, never colour-coded.
  const outcomes: Array<{ label: string; value: string }> = [
    {
      label: "Observed first-retest recurrence",
      value: input.firstRetestRate === null ? "not measurable yet" : `${Math.round(input.firstRetestRate * 100)}% (n=${input.firstRetestN})`,
    },
    {
      label: "Median opportunities to first recurrence",
      value: input.medianOpportunitiesToRecurrence === null ? "not measurable yet" : String(input.medianOpportunitiesToRecurrence),
    },
  ];

  // MEASUREMENT STATE — readiness only, independent of whether the observed
  // numbers look good or bad.
  if (input.repairs === 0) {
    return {
      status: "blocked",
      headline: "no completed repairs recorded yet — measurement is impossible",
      facts,
      note: "Measurement: INSUFFICIENT. The loop cannot be measured until repairs exist.",
      measurement: "insufficient",
      outcomes,
    };
  }
  if (input.firstRetestRate === null) {
    return {
      status: "degraded",
      headline: "insufficient retest sample — outcome not measurable",
      facts,
      note: "Measurement: INSUFFICIENT. Below the minimum measurable sample; recurrence is not reportable.",
      measurement: "insufficient",
      outcomes,
    };
  }
  return {
    status: "healthy",
    headline: "measurement is ready (outcomes below are observational)",
    facts,
    note: "Measurement: MEASURABLE. Observed outcomes are association, not causation: users who repair differ in many ways.",
    measurement: "measurable",
    outcomes,
  };
}
