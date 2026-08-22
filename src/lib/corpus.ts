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
