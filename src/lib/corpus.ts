// Pure helpers for the human-evaluation corpus population pipeline.
// The API routes (src/app/api/corpus/*) handle auth + I/O; everything that
// can be pure lives here so it is unit-testable.

import type { SideScores } from "./debateEvaluation";
import { EVAL_DIMENSIONS } from "./debateEvaluation";

export const MIN_RATERS_PER_ITEM = 2;

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
// The benchmark target: 500-1,000+ real debates, >=2 blind raters each,
// spread across subjects, ability bands, and argument lengths. These helpers
// make collection progress measurable instead of anecdotal.

export const POPULATION_TARGET_ITEMS = 500;
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
  targetItems: number;
  remainingToTarget: number;
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

  for (const item of items) {
    byLength[item.length_bucket] = (byLength[item.length_bucket] ?? 0) + 1;
    byAbility[item.ability_band] = (byAbility[item.ability_band] ?? 0) + 1;
    const subj = item.subject_category ?? "unknown";
    bySubject[subj] = (bySubject[subj] ?? 0) + 1;
    if ((ratingCounts.get(item.id ?? "") ?? 0) >= MIN_RATERS_PER_ITEM) fullyRated += 1;
  }

  const cellsNeedingCoverage: string[] = [];
  for (const bucket of LENGTH_BUCKETS) {
    if ((byLength[bucket] ?? 0) < STRATUM_MINIMUM) cellsNeedingCoverage.push(`length:${bucket}`);
  }
  for (const band of ABILITY_BANDS) {
    if ((byAbility[band] ?? 0) < STRATUM_MINIMUM) cellsNeedingCoverage.push(`ability:${band}`);
  }

  return {
    totalItems: items.length,
    fullyRatedItems: fullyRated,
    targetItems: POPULATION_TARGET_ITEMS,
    remainingToTarget: Math.max(0, POPULATION_TARGET_ITEMS - items.length),
    byLength,
    byAbility,
    bySubject,
    cellsNeedingCoverage,
  };
}

// --- System-vs-human comparison ---------------------------------------------

export function oppositeStance(stance: "for" | "against"): "for" | "against" {
  return stance === "for" ? "against" : "for";
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
