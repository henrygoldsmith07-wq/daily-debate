// Published-metric computations for the flagship human-evaluation corpus.
// Pure functions over raw DB rows so every number on /metrics is testable and
// reproducible. Honesty rule: any metric without enough data returns null and
// the UI shows an explicit dash — never a fabricated placeholder.

import { EVAL_DIMENSIONS, type SideScores } from "./debateEvaluation";
import { completeScores } from "./corpus";

export interface MetricRating {
  corpus_id: string;
  rater_id: string;
  winner: string;
  confidence: number | null;
  scores_a: unknown;
  scores_b: unknown;
}

export interface MetricItem {
  id: string;
  side_mapping: unknown;
}

export interface StoredSystemVerdict {
  winner?: string;
  playerAScore?: number;
  playerBScore?: number;
  confidence?: number | null;
  citationFlags?: { cited?: number; flagged?: number };
  swap_check?: { stable?: boolean };
}

export interface SwapCheck {
  stable?: boolean;
}

export interface CorpusMetrics {
  corpus: {
    items: number;
    ratings: number;
    raters: number;
    itemsWithTwoPlusRatings: number;
    itemsWithThreePlusRatings: number;
  };
  /** Unanimous-winner share among items with >=2 ratings. */
  humanConsensusUnanimousPct: number | null;
  /** Majority-vs-runner-up share among items with >=2 ratings. */
  humanConsensusMajorityPct: number | null;
  judgeVsConsensus: { judged: number; agree: number; pct: number | null };
  /** Judge accuracy restricted to debates humans scored as close (Likert gap < CLOSE_DEBATE_GAP). */
  closeDebateAccuracy: { n: number; agree: number; pct: number | null };
  /** Share of swap-checked judgements whose mirrored verdict matches the original. */
  positionSwapStability: { n: number; stable: number; pct: number | null };
  /** Expected Calibration Error over system-verdict confidences (10 bins). */
  calibrationError: number | null;
  /** Share of cited evidence nodes the citation verifier flagged as problematic. */
  unsupportedSourceFlagRate: { citedNodes: number; flagged: number; pct: number | null };
  notes: string[];
}

/** Debates whose two sides' mean rubric scores sit within this gap count as "close". */
export const CLOSE_DEBATE_GAP = 0.75;

type WinnerLabel = "a" | "b" | "tie";

function majorityWinner(winners: string[]): WinnerLabel {
  const votes: Record<WinnerLabel, number> = { a: 0, b: 0, tie: 0 };
  for (const w of winners) if (w === "a" || w === "b" || w === "tie") votes[w] += 1;
  const order: WinnerLabel[] = ["a", "b", "tie"];
  const sorted = [...order].sort((x, y) => votes[y] - votes[x]);
  return votes[sorted[0]] === votes[sorted[1]] ? "tie" : sorted[0];
}

function meanOverall(scores: unknown): number {
  const s = completeScores(scores as Partial<SideScores>);
  return EVAL_DIMENSIONS.reduce((acc, d) => acc + s[d], 0) / EVAL_DIMENSIONS.length;
}

function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function readSystemVerdict(sideMapping: unknown): StoredSystemVerdict | null {
  const sm = sideMapping as Record<string, unknown> | null;
  const sv = sm?.system_verdict;
  return sv && typeof sv === "object" ? (sv as StoredSystemVerdict) : null;
}

function readSwapCheck(sideMapping: unknown): SwapCheck | null {
  const sv = readSystemVerdict(sideMapping);
  const sc = sv?.swap_check;
  return sc && typeof sc === "object" ? (sc as SwapCheck) : null;
}

export function computeCorpusMetrics(items: MetricItem[], ratings: MetricRating[]): CorpusMetrics {
  const notes: string[] = [];

  // --- corpus shape ---------------------------------------------------------
  const raters = new Set(ratings.map((r) => r.rater_id));
  const ratingsByItem = new Map<string, MetricRating[]>();
  for (const r of ratings) {
    const list = ratingsByItem.get(r.corpus_id) ?? [];
    list.push(r);
    ratingsByItem.set(r.corpus_id, list);
  }
  let itemsWithTwo = 0;
  let itemsWithThree = 0;
  for (const list of ratingsByItem.values()) {
    if (list.length >= 2) itemsWithTwo += 1;
    if (list.length >= 3) itemsWithThree += 1;
  }

  // --- human consensus ------------------------------------------------------
  let unanimous = 0;
  let majorityHolds = 0;
  for (const [, list] of ratingsByItem) {
    if (list.length < 2) continue;
    const winners = list.map((r) => r.winner);
    const consensus = majorityWinner(winners);
    if (consensus !== "tie" && winners.every((w) => w === consensus)) unanimous += 1;
    const topCount = Math.max(...Object.values(votesFor(winners)));
    if (topCount > list.length / 2) majorityHolds += 1;
  }

  // --- judge vs consensus (+ close subset, calibration, citations, swaps) ---
  let judged = 0;
  let judgeAgree = 0;
  let closeN = 0;
  let closeAgree = 0;
  let swapN = 0;
  let swapStable = 0;
  let citedNodes = 0;
  let flaggedNodes = 0;
  const calibBins = Array.from({ length: 10 }, () => ({ total: 0, correct: 0, confidenceSum: 0 }));

  for (const item of items) {
    const list = ratingsByItem.get(item.id);
    if (!list || list.length < 2) continue;
    const consensus = majorityWinner(list.map((r) => r.winner));

    const sv = readSystemVerdict(item.side_mapping);
    if (sv?.winner === "a" || sv?.winner === "b" || sv?.winner === "tie") {
      judged += 1;
      const agree = sv.winner === consensus;
      if (agree) judgeAgree += 1;

      // "Close" = humans' mean overall rubric scores nearly tied.
      const gapCheck = Math.abs(
        list.reduce((s, r) => s + meanOverall(r.scores_a), 0) / list.length -
          list.reduce((s, r) => s + meanOverall(r.scores_b), 0) / list.length,
      );
      if (gapCheck < CLOSE_DEBATE_GAP) {
        closeN += 1;
        if (agree) closeAgree += 1;
      }

      const conf = typeof sv.confidence === "number" ? sv.confidence : null;
      if (conf !== null && conf >= 0 && conf <= 1) {
        const bin = Math.min(9, Math.floor(conf * 10));
        calibBins[bin].total += 1;
        calibBins[bin].confidenceSum += conf;
        if (agree) calibBins[bin].correct += 1;
      }

      const flags = sv.citationFlags;
      if (flags && typeof flags.cited === "number" && typeof flags.flagged === "number") {
        citedNodes += flags.cited;
        flaggedNodes += flags.flagged;
      }
    }

    const swap = readSwapCheck(item.side_mapping);
    if (typeof swap?.stable === "boolean") {
      swapN += 1;
      if (swap.stable) swapStable += 1;
    }
  }

  const binTotal = calibBins.reduce((s, b) => s + b.total, 0);
  if (binTotal === 0) notes.push("No system verdicts with confidence yet — calibration pending a comparison run.");

  return {
    corpus: {
      items: items.length,
      ratings: ratings.length,
      raters: raters.size,
      itemsWithTwoPlusRatings: itemsWithTwo,
      itemsWithThreePlusRatings: itemsWithThree,
    },
    humanConsensusUnanimousPct: pct(unanimous, itemsWithTwo),
    humanConsensusMajorityPct: pct(majorityHolds, itemsWithTwo),
    judgeVsConsensus: { judged, agree: judgeAgree, pct: pct(judgeAgree, judged) },
    closeDebateAccuracy: { n: closeN, agree: closeAgree, pct: pct(closeAgree, closeN) },
    positionSwapStability: { n: swapN, stable: swapStable, pct: pct(swapStable, swapN) },
    calibrationError: finalizeEce(calibBins),
    unsupportedSourceFlagRate: {
      citedNodes,
      flagged: flaggedNodes,
      pct: pct(flaggedNodes, citedNodes),
    },
    notes,
  };
}

function votesFor(winners: string[]): Record<WinnerLabel, number> {
  const votes: Record<WinnerLabel, number> = { a: 0, b: 0, tie: 0 };
  for (const w of winners) if (w === "a" || w === "b" || w === "tie") votes[w] += 1;
  return votes;
}

/**
 * Standard ECE: for each confidence bin, |observed accuracy − mean confidence|
 * weighted by bin share.
 */
export function finalizeEce(bins: Array<{ total: number; correct: number; confidenceSum?: number }>): number | null {
  const total = bins.reduce((s, b) => s + b.total, 0);
  if (!total) return null;
  let ece = 0;
  for (const b of bins) {
    if (!b.total) continue;
    const accuracy = b.correct / b.total;
    const meanConf = b.confidenceSum ? b.confidenceSum / b.total : accuracy;
    ece += (b.total / total) * Math.abs(accuracy - meanConf);
  }
  return Math.round(ece * 1000) / 1000;
}
