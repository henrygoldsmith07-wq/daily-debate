// Pure helpers for the human-evaluation corpus population pipeline.
// The API routes (src/app/api/corpus/*) handle auth + I/O; everything that
// can be pure lives here so it is unit-testable.

import type { SideScores } from "./debateEvaluation";
import { EVAL_DIMENSIONS } from "./debateEvaluation";

/** Operational floor: enough independent ratings to make a pilot item usable. */
export const MIN_RATERS_PER_ITEM = 2;
/** Normal collection target: keep an item open until three independent ratings land. */
export const RATING_COLLECTION_TARGET = 3;
export const CALIBRATION_RATERS_PER_ITEM = RATING_COLLECTION_TARGET;

export const VALIDATION_STAGES = {
  infrastructure: {
    label: "Stage 0 · infrastructure",
    minItems: 0,
    minRatersPerItem: 0,
    purpose: "Pipeline and fixture validation only; no human-validity claim.",
  },
  pilot: {
    label: "Stage 1 · pilot",
    minItems: 100,
    minRatersPerItem: MIN_RATERS_PER_ITEM,
    purpose: "Test the rubric, disagreement patterns and annotation workflow; claims remain provisional.",
  },
  calibration: {
    label: "Stage 2 · calibration",
    minItems: 500,
    minRatersPerItem: CALIBRATION_RATERS_PER_ITEM,
    purpose: "Calibrate judge and coaching targets, including per-dimension and subgroup analysis.",
  },
  mature: {
    label: "Stage 3 · mature corpus",
    minItems: 1_000,
    minRatersPerItem: CALIBRATION_RATERS_PER_ITEM,
    purpose: "Stratified external-validity evidence and the minimum corpus stage for ranked/competitive claims.",
  },
} as const;

export type ValidationStageName = keyof typeof VALIDATION_STAGES;
export const POPULATION_TARGET_ITEMS = VALIDATION_STAGES.mature.minItems;
export const CALIBRATION_TARGET_ITEMS = VALIDATION_STAGES.calibration.minItems;
export const PILOT_TARGET_ITEMS = VALIDATION_STAGES.pilot.minItems;

export function validationStageForCoverage(input: {
  itemsWithTwoPlusRatings: number;
  itemsWithThreePlusRatings: number;
}): ValidationStageName {
  if (input.itemsWithThreePlusRatings >= VALIDATION_STAGES.mature.minItems) return "mature";
  if (input.itemsWithThreePlusRatings >= VALIDATION_STAGES.calibration.minItems) return "calibration";
  if (input.itemsWithTwoPlusRatings >= VALIDATION_STAGES.pilot.minItems) return "pilot";
  return "infrastructure";
}

export function isCorpusAdmin(email: string | null | undefined, adminList: string | undefined): boolean {
  if (!email || !adminList) return false;
  return adminList
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

// --- Stratification --------------------------------------------------------

export function lengthBucketFor(transcript: string): "short" | "medium" | "long" {
  const words = transcript.trim().split(/\s+/).length;
  if (words <= 120) return "short";
  if (words <= 300) return "medium";
  return "long";
}

export function abilityBandFor(level: number | null | undefined): "novice" | "intermediate" | "advanced" {
  if (!level || level < 4) return "novice";
  if (level < 8) return "intermediate";
  return "advanced";
}

/**
 * Anonymise a debate transcript for blind rating: every speaker becomes
 * "Side A"/"Side B", stripping names, "(round n)" player labels and any
 * AI/opponent markers that could reveal which side was the machine.
 */
export function anonymiseTranscript(lines: Array<{ side: "a" | "b"; round: number; text: string }>): string {
  return lines.map((l) => `Side ${l.side.toUpperCase()} (round ${l.round}): ${l.text}`).join("\n");
}

// --- Presentation randomisation (position-bias control) ----------------------
// Human raters must not always see the same original side first: a rater who
// always reads "Side A" first may systematically favour it. Each (rater,
// item) pair is deterministically assigned a presentation side — stable
// across refreshes (no mid-rating flips) and balanced ~50/50 in expectation
// via FNV-1a hash parity. Scores and winners submitted in presented
// coordinates are mapped back to original coordinates server-side before
// storage (normalizeRatingToOriginal), so analysis always reads one frame.

/** Which original side is shown first to a rater for one item. */
export type PresentationSide = "a" | "b";

export function assignPresentationSide(raterId: string, itemId: string): PresentationSide {
  let h = 2166136261;
  const s = `${raterId}:${itemId}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Avalanche: without this, the LSB (and thus the parity) can correlate with
  // string structure — an unlucky or chosen id pattern could then see one side
  // first every time. Folding high bits down balances it; the adversarial
  // user-i/item-i pattern that failed 500/500 before is now ~50/50.
  h ^= h >>> 15;
  return (h >>> 0) % 2 === 0 ? "a" : "b";
}

/** Swap "Side A"/"Side B" labels throughout an anonymised transcript. */
export function swapTranscriptSides(transcript: string): string {
  return transcript
    .replaceAll("Side A", "__SIDE_T__")
    .replaceAll("Side B", "Side A")
    .replaceAll("__SIDE_T__", "Side B");
}

/** Mirror a winner label across the presentation swap. */
export function mirrorWinner(winner: "a" | "b" | "tie"): "a" | "b" | "tie" {
  return winner === "a" ? "b" : winner === "b" ? "a" : "tie";
}

export interface PresentedRating {
  scores_a: Partial<SideScores>;
  scores_b: Partial<SideScores>;
  winner: "a" | "b" | "tie";
}

/**
 * Map a rating submitted in PRESENTED coordinates back to original item
 * coordinates before storage. When presented_first is "b", Side A on the
 * rater's screen was original side B, so scores swap and the winner mirrors.
 */
export function normalizeRatingToOriginal(rating: PresentedRating, presentedFirst: PresentationSide): PresentedRating {
  if (presentedFirst === "a") return rating;
  return {
    scores_a: rating.scores_b,
    scores_b: rating.scores_a,
    winner: mirrorWinner(rating.winner),
  };
}

// --- Rating payload validation ---------------------------------------------

export interface RatingPayload {
  scores_a: Partial<SideScores>;
  scores_b: Partial<SideScores>;
  winner: "a" | "b" | "tie";
  confidence?: number;
  rationale?: string;
}

function validScores(scores: unknown): scores is Partial<SideScores> {
  if (typeof scores !== "object" || scores === null) return false;
  for (const dim of EVAL_DIMENSIONS) {
    const v = (scores as Record<string, unknown>)[dim];
    if (v === undefined) continue; // missing dims fall back at analysis time
    if (typeof v !== "number" || !Number.isFinite(v) || v < 1 || v > 5) return false;
  }
  return true;
}

/** Returns a list of problems; empty means the payload is acceptable. */
export function validateRating(body: unknown): string[] {
  const errors: string[] = [];
  const b = body as RatingPayload | null;
  if (!b || typeof b !== "object") return ["body must be an object"];
  if (!validScores(b.scores_a)) errors.push("scores_a must assign 1-5 to rubric dimensions");
  if (!validScores(b.scores_b)) errors.push("scores_b must assign 1-5 to rubric dimensions");
  if (b.winner !== "a" && b.winner !== "b" && b.winner !== "tie") errors.push("winner must be a|b|tie");
  if (b.confidence !== undefined && (typeof b.confidence !== "number" || b.confidence < 0 || b.confidence > 1)) {
    errors.push("confidence must be between 0 and 1");
  }
  if (b.rationale !== undefined && typeof b.rationale !== "string") errors.push("rationale must be a string");
  if (b.rationale && b.rationale.length > 1000) errors.push("rationale too long (max 1000 chars)");
  return errors;
}

/** Fill any unrated dimension with the given fallback so analysis sees full vectors. */
export function completeScores(partial: Partial<SideScores>, fallback = 3): SideScores {
  const out = {} as SideScores;
  for (const dim of EVAL_DIMENSIONS) out[dim] = partial[dim] ?? fallback;
  return out;
}

// --- Population tracking ----------------------------------------------------
// The authoritative collection target is staged above. Recruitment aims for
// the mature corpus while pilot and calibration readiness remain distinct.
/** Minimum corpus items per stratum cell (length bucket / ability band). */
export const STRATUM_MINIMUM = 30;

/** Canonical strata — zero-coverage cells must be flagged, not invisible. */
export const LENGTH_BUCKETS = ["short", "medium", "long"] as const;
export const ABILITY_BANDS = ["novice", "intermediate", "advanced"] as const;

export interface PopulationItemSummary {
  id?: string;
  length_bucket: string;
  ability_band: string;
  subject_category: string | null;
}

export interface PopulationProgress {
  totalItems: number;
  fullyRatedItems: number;
  calibrationRatedItems: number;
  targetItems: number;
  remainingToTarget: number;
  stage: ValidationStageName;
  stageLabel: string;
  nextStage: ValidationStageName | null;
  byLength: Record<string, number>;
  byAbility: Record<string, number>;
  bySubject: Record<string, number>;
  /** Stratum cells still below STRATUM_MINIMUM — where recruitment should aim. */
  cellsNeedingCoverage: string[];
}

export function populationProgress(
  items: PopulationItemSummary[],
  ratingCounts: Map<string, number>,
): PopulationProgress {
  const byLength: Record<string, number> = {};
  const byAbility: Record<string, number> = {};
  const bySubject: Record<string, number> = {};
  let fullyRated = 0;
  let calibrationRated = 0;

  for (const item of items) {
    byLength[item.length_bucket] = (byLength[item.length_bucket] ?? 0) + 1;
    byAbility[item.ability_band] = (byAbility[item.ability_band] ?? 0) + 1;
    const subj = item.subject_category ?? "unknown";
    bySubject[subj] = (bySubject[subj] ?? 0) + 1;
    if ((ratingCounts.get(item.id ?? "") ?? 0) >= MIN_RATERS_PER_ITEM) fullyRated += 1;
    if ((ratingCounts.get(item.id ?? "") ?? 0) >= CALIBRATION_RATERS_PER_ITEM) calibrationRated += 1;
  }

  const cellsNeedingCoverage: string[] = [];
  for (const bucket of LENGTH_BUCKETS) {
    if ((byLength[bucket] ?? 0) < STRATUM_MINIMUM) cellsNeedingCoverage.push(`length:${bucket}`);
  }
  for (const band of ABILITY_BANDS) {
    if ((byAbility[band] ?? 0) < STRATUM_MINIMUM) cellsNeedingCoverage.push(`ability:${band}`);
  }

  const stage = validationStageForCoverage({
    itemsWithTwoPlusRatings: fullyRated,
    itemsWithThreePlusRatings: calibrationRated,
  });
  const stageOrder: ValidationStageName[] = ["infrastructure", "pilot", "calibration", "mature"];
  const stageIndex = stageOrder.indexOf(stage);

  return {
    totalItems: items.length,
    fullyRatedItems: fullyRated,
    calibrationRatedItems: calibrationRated,
    targetItems: POPULATION_TARGET_ITEMS,
    remainingToTarget: Math.max(0, POPULATION_TARGET_ITEMS - items.length),
    stage,
    stageLabel: VALIDATION_STAGES[stage].label,
    nextStage: stageIndex < stageOrder.length - 1 ? stageOrder[stageIndex + 1] : null,
    byLength,
    byAbility,
    bySubject,
    cellsNeedingCoverage,
  };
}

// --- Population-campaign stratification (deterministic, no model judgement) -

export type DynamicsTier = "close" | "decisive" | "weak_vs_weak";
export type EvidenceDensity = "evidence_heavy" | "balanced" | "evidence_light";
export type StyleBucket = "formal" | "hedged" | "plain" | "intense";

/**
 * Debate-difficulty tier from the deterministic assessment: a close debate
 * exercises the judge hardest; weak-vs-weak debates test whether the judge
 * resists rewarding confident nonsense.
 */
export function deriveDynamicsTier(scoreA: number, scoreB: number): DynamicsTier {
  const gap = Math.abs(scoreA - scoreB);
  if (scoreA < 45 && scoreB < 45) return "weak_vs_weak";
  return gap < 10 ? "close" : "decisive";
}

export function deriveEvidenceDensity(evidenceNodes: number, claimsMade: number): EvidenceDensity {
  const ratio = claimsMade > 0 ? evidenceNodes / claimsMade : evidenceNodes > 0 ? 2 : 0;
  if (ratio >= 1) return "evidence_heavy";
  if (ratio >= 0.34) return "balanced";
  return "evidence_light";
}

export interface StyleSignals {
  /** formalConnectorsPer100 from debateEvaluation.styleFeatures */
  formality: number;
  /** hedgesPer100 */
  hedges: number;
  /** assertivesPer100 */
  assertives: number;
}

/** Writing-style bucket so the corpus covers formal, hedged, plain, and intense prose. */
export function deriveStyleBucket(s: StyleSignals): StyleBucket {
  if (s.assertives > 3) return "intense";
  if (s.hedges > 2.5) return "hedged";
  if (s.formality > 1.5) return "formal";
  return "plain";
}

// --- System-vs-human comparison ---------------------------------------------

export function oppositeStance(stance: "for" | "against"): "for" | "against" {
  return stance === "for" ? "against" : "for";
}

// --- Pilot consensus gate ----------------------------------------------------
// `humanGroundTruthReady` is a retained API name. Its threshold is now the
// Stage-1 pilot consensus gate, NOT an external-validity claim. Stage 2/3 are
// separately visible through VALIDATION_STAGES and require >=3 ratings/item.

export const GROUND_TRUTH_MIN_CONSENSUS_ITEMS = PILOT_TARGET_ITEMS;
export const GROUND_TRUTH_MIN_RATERS = 5;
/** Mean winner Cohen κ (floor); "substantial agreement" on the Landis-Koch scale. */
export const GROUND_TRUTH_MIN_KAPPA = 0.6;

export interface GroundTruthInput {
  /** Items with ≥ MIN_RATERS_PER_ITEM raters AND a usable (non-split) consensus. */
  consensusReadyItems: number;
  /** Distinct raters who contributed those consensus items. */
  raters: number;
  /** Mean pairwise winner κ over rater pairs, or null when none computable. */
  meanWinnerKappa: number | null;
}

export interface GroundTruthDecision {
  ready: boolean;
  reasons: string[];
}

export function humanGroundTruthReady(input: GroundTruthInput): GroundTruthDecision {
  const reasons: string[] = [];
  if (input.consensusReadyItems < GROUND_TRUTH_MIN_CONSENSUS_ITEMS) {
    reasons.push(
      `needs ${GROUND_TRUTH_MIN_CONSENSUS_ITEMS} consensus-rated items (have ${input.consensusReadyItems})`,
    );
  }
  if (input.raters < GROUND_TRUTH_MIN_RATERS) {
    reasons.push(`needs ${GROUND_TRUTH_MIN_RATERS} independent raters (have ${input.raters})`);
  }
  if (input.meanWinnerKappa === null || input.meanWinnerKappa < GROUND_TRUTH_MIN_KAPPA) {
    const shown = input.meanWinnerKappa === null ? "—" : input.meanWinnerKappa.toFixed(3);
    reasons.push(`needs mean winner κ ≥ ${GROUND_TRUTH_MIN_KAPPA} (have ${shown})`);
  }
  return { ready: reasons.length === 0, reasons };
}

export interface ComparisonPair {
  judgeWinner: "a" | "b" | "tie";
  consensusWinner: "a" | "b" | "tie";
}

/**
 * Aggregate judge-vs-consensus outcomes. Winner agreement is the headline;
 * disagreements stay visible — they are the calibration signal, not noise to
 * hide.
 */
export function aggregateSystemComparison(pairs: ComparisonPair[]): {
  judged: number;
  agree: number;
  disagreement: number;
  agreementRate: number | null;
} {
  const judged = pairs.length;
  if (!judged) return { judged: 0, agree: 0, disagreement: 0, agreementRate: null };
  const agree = pairs.filter((p) => p.judgeWinner === p.consensusWinner).length;
  return {
    judged,
    agree,
    disagreement: judged - agree,
    agreementRate: Number((agree / judged).toFixed(3)),
  };
}
