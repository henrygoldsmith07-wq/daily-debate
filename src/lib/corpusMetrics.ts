// Rewritten corpus metrics with explicit sample gates and uncertainty.
// Every published metric carries: { estimate, ciLower, ciUpper, n, state }.

import { gateBinomial, SAMPLE_GATES, type GatedMetric } from "./evidenceState";
import { cohenKappa } from "./humanCorpus";
import {
  MIN_RATERS_PER_ITEM,
  humanGroundTruthReady,
  type GroundTruthDecision,
} from "./corpus";

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

interface StoredSystemVerdict {
  winner?: string;
  playerAScore?: number;
  playerBScore?: number;
  confidence?: number | null;
  citationFlags?: { cited?: number; flagged?: number };
  swap_check?: { stable?: boolean };
}

// --- gated metric result ---------------------------------------------------

type WinnerLabel = "a" | "b" | "tie";

function majorityWinner(winners: string[]): WinnerLabel {
  const votes: Record<WinnerLabel, number> = { a: 0, b: 0, tie: 0 };
  for (const w of winners) if (w === "a" || w === "b" || w === "tie") votes[w] += 1;
  const sorted = Object.entries(votes).sort((x, y) => y[1] - x[1]);
  return votes[sorted[0][0] as WinnerLabel] === votes[sorted[1][0] as WinnerLabel] ? "tie" : sorted[0][0] as WinnerLabel;
}

function meanOverall(scores: unknown): number {
  const dims = ["evidenceQuality", "reasoning", "relevance", "rebuttalQuality", "logicalValidity", "sourceQuality"] as const;
  const s = scores as Partial<Record<(typeof dims)[number], number>> | null;
  if (!s || typeof s !== "object") return 3;
  return dims.reduce((acc, d) => acc + (s[d] ?? 3), 0) / dims.length;
}

function readSV(sm: unknown): StoredSystemVerdict | null {
  const sv = (sm as Record<string, unknown>)?.system_verdict;
  return sv && typeof sv === "object" ? (sv as StoredSystemVerdict) : null;
}

// --- main computation ---------------------------------------------------------

export interface CorpusMetricsResult {
  corpus: {
    items: number;
    ratings: number;
    raters: number;
    itemsWithTwoPlusRatings: number;
    itemsWithThreePlusRatings: number;
  };
  humanConsensusUnanimous: GatedMetric;
  judgeVsConsensus: GatedMetric & { agree: number };
  closeDebateAccuracy: GatedMetric & { closeN: number };
  positionSwapStability: GatedMetric;
  calibrationError: number | null;
  citationFlagRate: GatedMetric;
  /** Independent-human-validation readiness (ground-truth gate + dispersion). */
  humanValidation: {
    consensusReadyItems: number;
    unresolvedDisagreements: number;
    meanWinnerKappa: number | null;
    meanScoreGapDispersion: number | null;
    meanRaterConfidence: number | null;
    groundTruth: GroundTruthDecision;
  };
  /** Evidence states for dashboard rendering */
  evidenceStates: Record<string, string>;
}

/** Mean overall preference gap (a minus b) a rater assigned to one item. */
function raterGap(r: MetricRating): number {
  return meanOverall(r.scores_a) - meanOverall(r.scores_b);
}

/** Population standard deviation, null when fewer than two values. */
function stdev(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

export function computeCorpusMetrics(items: MetricItem[], ratings: MetricRating[]): CorpusMetricsResult {
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
    if (list.length >= 2) itemsWithTwo++;
    if (list.length >= 3) itemsWithThree++;
  }

  // Human consensus
  let unanimous = 0;
  let multiRatedCount = 0;
  for (const [, list] of ratingsByItem) {
    if (list.length < 2) continue;
    multiRatedCount++;
    const winners = list.map((r) => r.winner);
    if (winners.every((w) => w === winners[0]) && winners[0] !== "tie") unanimous++;
  }

  // Judge vs consensus etc
  let judged = 0, judgeAgree = 0, closeN = 0, closeAgree = 0;
  let swapN = 0, swapStable = 0, citedNodes = 0, flaggedNodes = 0;
  const calibBins = Array.from({ length: 10 }, () => ({ total: 0, correct: 0, confidenceSum: 0 }));

  for (const item of items) {
    const list = ratingsByItem.get(item.id);
    if (!list || list.length < 2) continue;
    const consensus = majorityWinner(list.map((r) => r.winner));

    const sv = readSV(item.side_mapping);
    if (sv?.winner === "a" || sv?.winner === "b" || sv?.winner === "tie") {
      judged++;
      if (sv.winner === consensus) judgeAgree++;

      const gapCheck = Math.abs(
        list.reduce((s, r) => s + meanOverall(r.scores_a), 0) / list.length -
        list.reduce((s, r) => s + meanOverall(r.scores_b), 0) / list.length,
      );
      if (gapCheck < 0.75) { closeN++; if (sv.winner === consensus) closeAgree++; }

      const conf = typeof sv.confidence === "number" ? sv.confidence : null;
      if (conf !== null && conf >= 0 && conf <= 1) {
        const bin = Math.min(9, Math.floor(conf * 10));
        calibBins[bin].total++;
        calibBins[bin].confidenceSum += conf;
        if (sv.winner === consensus) calibBins[bin].correct++;
      }

      const flags = sv.citationFlags;
      if (flags && typeof flags.cited === "number" && typeof flags.flagged === "number") {
        citedNodes += flags.cited;
        flaggedNodes += flags.flagged;
      }
    }

    const swap = (item.side_mapping as Record<string, unknown>)?.system_verdict !== undefined
      ? ((item.side_mapping as Record<string, Record<string, unknown>>).system_verdict.swap_check as { stable?: boolean } | undefined)
      : undefined;
    if (typeof swap?.stable === "boolean") { swapN++; if (swap.stable) swapStable++; }
  }

  // --- Independent-human-validation readiness --------------------------------
  // Consensus-ready = ≥2 raters with a STRICT majority winner (not a split).
  // Everything else among multi-rated items is an unresolved disagreement that
  // must go through adjudication before it counts toward anything.
  let consensusReadyItems = 0;
  let unresolvedDisagreements = 0;
  const dispersions: number[] = [];
  for (const [, list] of ratingsByItem) {
    if (list.length < MIN_RATERS_PER_ITEM) continue;
    const winners = list.map((r) => r.winner);
    const votes: Record<WinnerLabel, number> = { a: 0, b: 0, tie: 0 };
    for (const w of winners) if (w === "a" || w === "b" || w === "tie") votes[w] += 1;
    const ranked = Object.values(votes).sort((x, y) => y - x);
    const hasConsensus = ranked[0] > ranked[1] && majorityWinner(winners) !== "tie";
    if (hasConsensus) consensusReadyItems++;
    else unresolvedDisagreements++;
    const d = stdev(list.map(raterGap));
    if (d !== null) dispersions.push(d);
  }
  // Pairwise winner κ over rater pairs with ≥5 commonly-rated items (same
  // discipline as the admin reliability endpoint, reused from humanCorpus).
  const pairVotes = new Map<string, Array<[WinnerLabel, WinnerLabel]>>();
  for (const [, list] of ratingsByItem) {
    if (list.length !== 2) continue;
    const [x, y] = [...list].sort((m, n) => m.rater_id.localeCompare(n.rater_id));
    const key = `${x.rater_id}|${y.rater_id}`;
    const seq = pairVotes.get(key) ?? [];
    seq.push([x.winner as WinnerLabel, y.winner as WinnerLabel]);
    pairVotes.set(key, seq);
  }
  const kappas: number[] = [];
  for (const seq of pairVotes.values()) {
    if (seq.length >= 5) kappas.push(cohenKappa(seq.map(([a]) => a), seq.map(([, b]) => b)));
  }
  const meanWinnerKappa = kappas.length
    ? Number((kappas.reduce((s, k) => s + k, 0) / kappas.length).toFixed(3))
    : null;
  const confidences = ratings
    .map((r) => r.confidence)
    .filter((c): c is number => typeof c === "number" && c >= 0 && c <= 1);
  const groundTruth = humanGroundTruthReady({
    consensusReadyItems,
    raters: raters.size,
    meanWinnerKappa,
  });

  // Gated results
  const consensusGate = SAMPLE_GATES.humanConsensus;
  const judgeGate = SAMPLE_GATES.judgeVsConsensus;
  const closeGate = SAMPLE_GATES.closeDebateAccuracy;
  const swapGate = SAMPLE_GATES.positionSwapStability;
  const calibGate = SAMPLE_GATES.calibration;
  const citeGate = SAMPLE_GATES.citationFlagRate;

  const binTotal = calibBins.reduce((s, b) => s + b.total, 0);

  return {
    corpus: {
      items: items.length,
      ratings: ratings.length,
      raters: raters.size,
      itemsWithTwoPlusRatings: itemsWithTwo,
      itemsWithThreePlusRatings: itemsWithThree,
    },
    humanConsensusUnanimous: gateBinomial(unanimous, multiRatedCount, consensusGate),
    judgeVsConsensus: {
      ...gateBinomial(judgeAgree, judged, judgeGate),
      agree: judgeAgree,
    },
    closeDebateAccuracy: {
      ...gateBinomial(closeAgree, closeN, closeGate),
      closeN,
    },
    positionSwapStability: gateBinomial(swapStable, swapN, swapGate),
    calibrationError: finalizeEce(calibBins),
    citationFlagRate: gateBinomial(flaggedNodes, citedNodes, { minReportable: citeGate.minReportable, minEarly: citeGate.minEarly }),
    humanValidation: {
      consensusReadyItems,
      unresolvedDisagreements,
      meanWinnerKappa,
      meanScoreGapDispersion: dispersions.length
        ? Number((dispersions.reduce((s, d) => s + d, 0) / dispersions.length).toFixed(3))
        : null,
      meanRaterConfidence: confidences.length
        ? Number((confidences.reduce((s, c) => s + c, 0) / confidences.length).toFixed(3))
        : null,
      groundTruth,
    },
    evidenceStates: {
      humanConsensus: resolveState(multiRatedCount, consensusGate),
      judgeVsConsensus: resolveState(judged, judgeGate),
      closeDebateAccuracy: resolveState(closeN, closeGate),
      positionSwapStability: resolveState(swapN, swapGate),
      calibration: resolveState(binTotal, calibGate),
      citationFlagRate: resolveState(citedNodes, citeGate),
    },
  };
}

function resolveState(n: number, gate: { minReportable: number; minEarly: number }): string {
  if (n >= gate.minReportable) return "reportable";
  if (n >= gate.minEarly) return "early";
  return "insufficient";
}

export function finalizeEce(bins: Array<{ total: number; correct: number; confidenceSum?: number }>): number | null {
  const total = bins.reduce((s, b) => s + b.total, 0);
  if (!total) return null;
  let ece = 0;
  for (const b of bins) {
    if (!b.total) continue;
    ece += (b.total / total) * Math.abs(b.correct / b.total - (b.confidenceSum ?? b.correct / b.total) / b.total);
  }
  return Math.round(ece * 1000) / 1000;
}
