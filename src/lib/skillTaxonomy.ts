// Canonical skill taxonomy — the ONE source of truth for skill vocabulary.
//
// Daily Debate trains seven reasoning skills. Before this module the vocabulary
// was split across three overlapping partitions of the same observable metrics:
//
//   - adaptiveCoach  CoachDimension  (evidence/rebuttal/logic/clarity/impact/
//                                     steelmanning/structure)
//   - skillProfile   ProfileDimensionKey (claim-clarity/evidence/reasoning/
//                                     rebuttal/weighing/structure/delivery)
//   - argumentRepair RepairKind     (evidence/rebuttal/logic/impact/structure/
//                                     clarity)
//
// They disagreed on names (Logic vs Reasoning, Impact vs Weighing, Clarity vs
// Claim clarity) AND on grouping (skillProfile buried steelmanQuality under
// "structure" and invented a "delivery" dimension for fakePrecisionHits, while
// adaptiveCoach gave steelmanning its own dimension). Renaming UI strings would
// not have fixed that — the underlying partitions genuinely differed.
//
// This module resolves both: one canonical seven-dimension partition of the 13
// observable metrics, one label per skill, the legacy terms each absorbs, and
// crosswalks so every surface (scoring, coaching, progress, Argument DNA,
// result screens, docs, tests) reads the same vocabulary. Downstream modules
// import labels/keys from here rather than redeclaring them.
//
// Terminology is vocabulary + grouping; per-dimension *scoring* stays where it
// lives (adaptiveCoach's single-metric rubric vs skillProfile's multi-metric
// mean) — those are deliberately different lenses on the same skill, not
// different taxonomies. What is unified here is: what the skill IS called, and
// which observable signals belong to it.
//
// Pure — no I/O, no model calls.

import type { MetricKey } from "./skillLedger";
import { HIGHER_IS_BETTER } from "./skillLedger";

// ---------------------------------------------------------------------------
// Canonical dimensions
// ---------------------------------------------------------------------------

/**
 * The seven skills, in stable key form. Keys match the persisted vocabulary
 * (CoachingRecord.dimension, drill_assignments.dimension, repair target_kind)
 * so nothing stored is rewritten; labels below are the single learner-facing
 * name for each.
 */
export const SKILL_DIMENSION_KEYS = [
  "evidence",
  "rebuttal",
  "logic",
  "clarity",
  "impact",
  "steelmanning",
  "structure",
] as const;

export type SkillDimensionKey = (typeof SKILL_DIMENSION_KEYS)[number];

export interface SkillDimensionDef {
  key: SkillDimensionKey;
  /** The single learner-facing name. */
  label: string;
  /** Plain-language description: what training this skill changes. */
  skill: string;
  /** Every observable signal that belongs to this skill. */
  metrics: MetricKey[];
  /**
   * The primary signal this skill is scored by in the coaching rubric (kept
   * explicit so both the coach's single-metric lens and the profile's
   * multi-metric lens stay attached to the same skill).
   */
  primaryMetric: MetricKey;
  /** Legacy terms this skill absorbs — for docs and search, never shown. */
  aliases: string[];
}

/**
 * The canonical grouping. All 13 MetricKeys appear exactly once across the
 * seven skills, so no signal is double-counted or orphaned.
 */
export const SKILL_DIMENSIONS: Record<SkillDimensionKey, SkillDimensionDef> = {
  evidence: {
    key: "evidence",
    label: "Evidence",
    skill: "Backing major claims with named, checkable support.",
    metrics: ["unsupportedClaimRate", "evidenceGrounding", "uncitedEvidenceRate"],
    primaryMetric: "unsupportedClaimRate",
    aliases: ["evidence support", "claim support", "grounding"],
  },
  rebuttal: {
    key: "rebuttal",
    label: "Rebuttal",
    skill: "Meeting the opponent's actual argument instead of talking past it.",
    metrics: ["rebuttalCoverage", "rebuttalTargeting"],
    primaryMetric: "rebuttalCoverage",
    aliases: ["rebuttal coverage", "rebuttal targeting", "engagement"],
  },
  logic: {
    key: "logic",
    label: "Logic",
    skill: "Making the reasoning step from fact to conclusion explicit and valid.",
    metrics: ["fallacyRate", "causalOverclaims"],
    primaryMetric: "fallacyRate",
    aliases: ["reasoning", "reasoning discipline", "validity"],
  },
  clarity: {
    key: "clarity",
    label: "Clarity",
    skill: "Separating one clean claim from the reason that supports it.",
    metrics: ["clarity"],
    primaryMetric: "clarity",
    aliases: ["claim clarity", "claim-clarity", "readability"],
  },
  impact: {
    key: "impact",
    label: "Impact",
    skill: "Weighing why your consequence matters more than the opponent's.",
    metrics: ["impactHandling"],
    primaryMetric: "impactHandling",
    aliases: ["weighing", "impact weighing", "significance"],
  },
  steelmanning: {
    key: "steelmanning",
    label: "Steelmanning",
    skill: "Stating the opposing case at its strongest before answering it.",
    metrics: ["steelmanQuality"],
    primaryMetric: "steelmanQuality",
    aliases: ["steelman", "charity", "steelman quality"],
  },
  structure: {
    key: "structure",
    label: "Structure",
    skill: "Finishing every thread you open and keeping claims precise and internally consistent.",
    metrics: ["droppedArguments", "contradictions", "fakePrecisionHits"],
    primaryMetric: "droppedArguments",
    aliases: ["delivery", "organisation", "coherence", "position consistency", "precision"],
  },
};

/** Canonical label lookup — every surface should render skill names from here. */
export const SKILL_LABELS: Record<SkillDimensionKey, string> = Object.fromEntries(
  SKILL_DIMENSION_KEYS.map((k) => [k, SKILL_DIMENSIONS[k].label]),
) as Record<SkillDimensionKey, string>;

export const SKILL_ORDER: readonly SkillDimensionKey[] = SKILL_DIMENSION_KEYS;

export function skillLabel(key: SkillDimensionKey): string {
  return SKILL_DIMENSIONS[key].label;
}

export function skillDescription(key: SkillDimensionKey): string {
  return SKILL_DIMENSIONS[key].skill;
}

/** Every MetricKey, grouped by the skill it measures (each appears once). */
export function metricsForSkill(key: SkillDimensionKey): MetricKey[] {
  return SKILL_DIMENSIONS[key].metrics;
}

/** Which skill owns a given observable signal. */
export function skillForMetric(metric: MetricKey): SkillDimensionKey {
  for (const key of SKILL_DIMENSION_KEYS) {
    if (SKILL_DIMENSIONS[key].metrics.includes(metric)) return key;
  }
  // Unreachable: the grouping covers METRIC_KEYS exhaustively (checked in tests).
  return "logic";
}

// ---------------------------------------------------------------------------
// Legacy vocabulary crosswalk
// ---------------------------------------------------------------------------

/**
 * Normalise any legacy skill term to its canonical dimension key. Accepts the
 * canonical keys themselves plus every historical alias from the three legacy
 * vocabularies (CoachDimension, ProfileDimensionKey, RepairKind) and their
 * display spellings. Returns null for unknown input so callers can fall back
 * rather than silently mis-file a skill.
 */
export function canonicalSkillKey(term: string | null | undefined): SkillDimensionKey | null {
  if (!term) return null;
  const t = term.trim().toLowerCase().replace(/[\s_-]+/g, "");
  switch (t) {
    case "evidence":
    case "evidencesupport":
    case "claimsupport":
    case "grounding":
    case "evidencegrounding":
      return "evidence";
    case "rebuttal":
    case "rebuttalcoverage":
    case "rebuttaltargeting":
    case "engagement":
      return "rebuttal";
    case "logic":
    case "reasoning":
    case "reasoningdiscipline":
    case "validity":
      return "logic";
    case "clarity":
    case "claimclarity":
    case "readability":
      return "clarity";
    case "impact":
    case "weighing":
    case "impactweighing":
    case "significance":
      return "impact";
    case "steelmanning":
    case "steelman":
    case "charity":
    case "steelmanquality":
      return "steelmanning";
    case "structure":
    case "delivery":
    case "organisation":
    case "organization":
    case "coherence":
    case "positionconsistency":
      return "structure";
    default:
      return null;
  }
}

/**
 * Map a legacy term to its canonical learner-facing label. Falls back to the
 * raw term so nothing is ever blanked.
 */
export function canonicalSkillLabel(term: string | null | undefined): string {
  const key = canonicalSkillKey(term);
  return key ? SKILL_DIMENSIONS[key].label : (term ?? "");
}

// ---------------------------------------------------------------------------
// Evidence levels — the honesty vocabulary
// ---------------------------------------------------------------------------

/**
 * Every learner-facing claim carries one of these. The product must never
 * collapse them into a single "ability score": what was observed in a debate is
 * not the same kind of thing as a model's structural read, a deterministic
 * composite, a rough heuristic, or an externally validated result.
 */
export type EvidenceLevel =
  /** Behaviour directly observed in the stored argument graph (counts, coverage). */
  | "observed"
  /** Structure extracted by a model (e.g. steelman quality, causal overclaims). */
  | "extracted"
  /** A deterministic score computed from observed signals (no model opinion). */
  | "deterministic"
  /** A provisional heuristic over limited data (e.g. judge agreement estimates). */
  | "provisional"
  /** A claim that passed an external quality gate (currently almost nothing). */
  | "validated";

export const EVIDENCE_LEVEL_LABEL: Record<EvidenceLevel, string> = {
  observed: "Observed",
  extracted: "Model-extracted",
  deterministic: "Deterministic score",
  provisional: "Provisional",
  validated: "Externally validated",
};

export const EVIDENCE_LEVEL_DETAIL: Record<EvidenceLevel, string> = {
  observed: "Counted directly from the moves you actually made in the argument graph.",
  extracted: "Identified by a model reading the debate's structure — useful, not certain.",
  deterministic: "A fixed formula over observed signals; no model opinion in the number.",
  provisional: "An early heuristic over a small sample. Directional, not settled.",
  validated: "Cleared an external quality gate. Only rigorous judge benchmarks reach here.",
};

/**
 * The evidence level of each observable signal. Model-extracted signals are
 * exactly those the assessment engine derives by reading structure rather than
 * counting moves; everything else is counted from the graph.
 */
const METRIC_EVIDENCE_LEVEL: Record<MetricKey, EvidenceLevel> = {
  unsupportedClaimRate: "observed",
  rebuttalCoverage: "observed",
  rebuttalTargeting: "observed",
  evidenceGrounding: "observed",
  droppedArguments: "observed",
  contradictions: "observed",
  impactHandling: "deterministic",
  steelmanQuality: "extracted",
  fallacyRate: "observed",
  causalOverclaims: "extracted",
  fakePrecisionHits: "extracted",
  uncitedEvidenceRate: "observed",
  clarity: "deterministic",
};

export function evidenceLevelForMetric(metric: MetricKey): EvidenceLevel {
  return METRIC_EVIDENCE_LEVEL[metric];
}

/**
 * The evidence level of a whole skill reading: the *weakest* (most inferential)
 * level among its signals, because a skill score inherits the uncertainty of its
 * least-certain input. A skill backed only by observed signals reads "observed";
 * one that leans on a model-extracted signal is never presented as purely
 * observed.
 */
export function evidenceLevelForSkill(key: SkillDimensionKey): EvidenceLevel {
  const rank: Record<EvidenceLevel, number> = {
    observed: 0,
    deterministic: 1,
    extracted: 2,
    provisional: 3,
    validated: -1,
  };
  return SKILL_DIMENSIONS[key].metrics
    .map(evidenceLevelForMetric)
    .reduce((worst, lvl) => (rank[lvl] > rank[worst] ? lvl : worst), "observed" as EvidenceLevel);
}

/**
 * Canonical normalisation of one metric reading to "goodness" in 0..1: higher
 * is better after inverting lower-is-better metrics. This is the single
 * definition the learner model uses, so skill levels cannot disagree between
 * surfaces. (Legacy `skillProfile.goodness` mirrors it for its pinned view.)
 */
export function metricGoodness(value: number | null | undefined, metric: MetricKey): number | null {
  if (value === null || value === undefined) return null;
  const v = Math.max(0, Math.min(1, value));
  return HIGHER_IS_BETTER[metric] ? v : 1 - v;
}

/**
 * Which canonical skill a repair kind targets. Repairs are named after the
 * skill the learner is rebuilding; steelmanning has no dedicated repair kind
 * today, so it never appears here.
 */
export function skillKeyForRepairKind(kind: string): SkillDimensionKey | null {
  switch (kind) {
    case "evidence":
    case "rebuttal":
    case "logic":
    case "impact":
    case "structure":
    case "clarity":
      return kind;
    default:
      return null;
  }
}
