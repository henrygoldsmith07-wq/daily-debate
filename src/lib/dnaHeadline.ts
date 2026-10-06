// Argument DNA headline — "What kind of arguer am I becoming?"
//
// A compact qualitative read over the existing DNA model: strongest recurring
// behaviour, most important current weakness, most improved observable skill,
// the current deliberate-practice focus, and the evidence behind the read.
// Everything is derived from the same observable metrics the judge pipeline
// uses — qualitative labels and observed behaviour, never synthetic
// personality claims ("you are a visionary debater"). Pure.

import type { ArgumentDnaInsight, ArgumentDnaModel } from "./argumentDna";
import { MIN_PROFILE_DEBATES, type ProfileDimension } from "./skillProfile";

export interface DnaHeadline {
  /** "What kind of arguer am I becoming?" — one grounded sentence. */
  becoming: string;
  strongest: { label: string; statement: string } | null;
  weakness: { label: string; statement: string } | null;
  mostImproved: { label: string; statement: string } | null;
  focus: string | null;
  /** Evidence line: how many debates this read rests on. */
  evidenceLine: string;
  /** True when the sample is too small for confident claims. */
  limitedEvidence: boolean;
}

const IMPROVED_LABELS: Record<string, string> = {
  unsupportedClaimRate: "claim support",
  rebuttalCoverage: "rebuttal coverage",
  rebuttalTargeting: "rebuttal targeting",
  evidenceGrounding: "evidence grounding",
  droppedArguments: "answering opposing arguments",
  contradictions: "position consistency",
  impactHandling: "impact weighing",
  steelmanQuality: "steelmanning",
  fallacyRate: "reasoning discipline",
  causalOverclaims: "causal claims",
  fakePrecisionHits: "figure precision",
  uncitedEvidenceRate: "source citation",
  clarity: "clarity",
};

/**
 * The headline read. `focus` is the current deliberate-practice focus label
 * (from the coaching loop), when one is active.
 */
export function buildDnaHeadline(model: ArgumentDnaModel, focus: string | null = null): DnaHeadline {
  const dims = model.profile.dimensions.filter((d): d is ProfileDimension & { score: number } => d.score !== null);
  const strongest = dims.length
    ? dims.reduce((best, d) => (d.score > best.score ? d : best))
    : null;
  const weakness = dims.length
    ? dims.reduce((worst, d) => (d.score < worst.score ? d : worst))
    : null;

  const improvedMetric = model.ledger.improvements[0] ?? null;
  const regressions = model.ledger.regressions;
  const limitedEvidence = model.analysedDebates < MIN_PROFILE_DEBATES;

  const strongestStatement = strongest
    ? `Your most consistent behaviour: ${behaviourFor(strongest.key)} (${strongest.score} of 100 across ${strongest.sampleSize} ${strongest.sampleSize === 1 ? "debate" : "debates"}).`
    : null;
  const weaknessStatement = weakness
    ? `The gap that shows up most often: ${weaknessBehaviourFor(weakness.key)}.`
    : null;
  const improvedStatement = improvedMetric
    ? `${capitalise(IMPROVED_LABELS[improvedMetric] ?? improvedMetric)} is your most improved observable skill recently${regressions.length ? `, while ${IMPROVED_LABELS[regressions[0]] ?? regressions[0]} needs attention` : ""}.`
    : null;

  const becomingParts: string[] = [];
  if (strongestStatement) becomingParts.push(`strongest at ${behaviourFor(strongest!.key)}`);
  if (weaknessStatement) becomingParts.push(`still working on ${weaknessBehaviourFor(weakness!.key)}`);
  const becoming = becomingParts.length
    ? `You're becoming someone who is ${becomingParts.join(", ")}.`
    : "Complete a few debates and this read fills in from what you actually argued.";

  return {
    becoming,
    strongest: strongest ? { label: strongest.label, statement: strongestStatement! } : null,
    weakness: weakness ? { label: weakness.label, statement: weaknessStatement! } : null,
    mostImproved: improvedMetric
      ? { label: IMPROVED_LABELS[improvedMetric] ?? improvedMetric, statement: improvedStatement! }
      : null,
    focus,
    evidenceLine: limitedEvidence
      ? `Based on ${model.analysedDebates} analysed ${model.analysedDebates === 1 ? "debate" : "debates"} — early read, still settling.`
      : `Based on ${model.analysedDebates} analysed debates (${model.totalDebates} tracked in total).`,
    limitedEvidence,
  };
}

const BEHAVIOUR: Record<string, string> = {
  "claim-clarity": "making one clear claim at a time",
  evidence: "backing claims with named evidence",
  reasoning: "keeping the reasoning between fact and conclusion explicit",
  rebuttal: "meeting opposing arguments head-on",
  weighing: "saying why your impact matters more",
  structure: "closing the loop on every thread you open",
  delivery: "speaking in precise, checkable terms",
};

const WEAKNESS: Record<string, string> = {
  "claim-clarity": "separating claim from reason",
  evidence: "grounding major claims in named support",
  reasoning: "bridging facts to conclusions explicitly",
  rebuttal: "answering the strongest opposing argument",
  weighing: "making the impact land on the decision",
  structure: "finishing the threads you open",
  delivery: "avoiding uncheckable precision",
};

function behaviourFor(key: string): string {
  return BEHAVIOUR[key] ?? key;
}

function weaknessBehaviourFor(key: string): string {
  return WEAKNESS[key] ?? key;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Insight list unchanged — exposed for the deeper-analysis disclosure. */
export function dnaInsightsAreSufficient(model: ArgumentDnaModel): boolean {
  return model.insights.length > 0 && model.analysedDebates >= MIN_PROFILE_DEBATES;
}

export type { ArgumentDnaInsight };
