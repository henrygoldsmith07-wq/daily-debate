// Ensemble judges + provisional uncertainty estimates.
// Combines OpenRouter + Anthropic verdicts and avoids pretending tiny score
// differences are meaningful. Used by the public benchmark and by PvP when
// live keys are present; falls back to single-judge otherwise.
//
// Honesty note on uncertainty: with 1–2 judges there is no meaningful sample
// from which to compute inferential statistics. The fields below are
// PROVISIONAL HEURISTIC estimates (a spread band over judge score gaps and a
// raw vote share) and are labelled as such in the UI. They must never be
// presented as calibrated confidence intervals or posteriors.

import type { PvpJudgeResult, PvpVerdict } from "./types";
import type { AssessmentStatus, ObservableAssessment } from "./observableAssessment";
import { makeEnsembleFingerprint, type JudgeFingerprint } from "./judgeVersioning";

export type JudgeId = "openrouter" | "anthropic" | "nvidia";
export interface JudgedVerdict extends PvpJudgeResult {
  judgeId: JudgeId;
  latencyMs?: number;
  fingerprint?: JudgeFingerprint;
}

export interface EnsembleResult {
  winner: "a" | "b" | "tie";
  playerAScore: number;
  playerBScore: number;
  scoreGap: number; // |A-B|
  confidence: number; // 0..1 — PROVISIONAL heuristic from gap + judge votes, NOT calibrated
  isTie: boolean; // true when ensemble disagrees or gap < tieThreshold
  tieReason?: string;
  // Per-judge detail
  judges: JudgedVerdict[];
  // Provisional uncertainty estimates (heuristic, not inferential)
  scoreGapEstimate: { lo: number; hi: number }; // heuristic spread band over the score gap across judge scores
  judgeSplit: { a: number; b: number; tie: number }; // raw vote share across judges — not a posterior
  // Which argGraph to show (prefer the majority winner's graph, or OpenRouter's if tie)
  argGraph?: PvpJudgeResult["argGraph"];
  rationale: string;
  decidingFactor?: string;
  scoreStatus: AssessmentStatus;
  observableAssessment?: ObservableAssessment;
}

const TIE_THRESHOLD = 5; // points: |A-B| < 5 => tie unless judges strongly agree
const MIN_CONFIDENCE_FOR_WIN = 0.55;

function winnerFromScores(a: number, b: number): "a" | "b" | "tie" {
  if (Math.abs(a - b) < TIE_THRESHOLD) return "tie";
  return a > b ? "a" : "b";
}

// Provisional spread band over the gap given 1–2 judge scores. With n<2 this
// is a fixed ±6 heuristic; it is NOT a confidence interval.
function gapBand(scores: Array<{ a: number; b: number }>): { lo: number; hi: number } {
  if (!scores.length) return { lo: 0, hi: 0 };
  const gaps = scores.map((s) => Math.abs(s.a - s.b));
  const mean = gaps.reduce((x, y) => x + y, 0) / gaps.length;
  if (gaps.length === 1) return { lo: Math.max(0, mean - 6), hi: mean + 6 };
  const variance = gaps.reduce((acc, g) => acc + (g - mean) ** 2, 0) / (gaps.length - 1);
  const se = Math.sqrt(variance / gaps.length);
  const margin = Math.max(1.96 * se, 2);
  return { lo: Math.max(0, mean - margin), hi: mean + margin };
}

// Raw vote share across judges — displayed as "judge split", not a posterior.
function judgeVoteShare(judges: JudgedVerdict[]): { a: number; b: number; tie: number } {
  const n = judges.length || 1;
  let a = 0, b = 0, t = 0;
  for (const j of judges) {
    if (j.winner === "a") a++;
    else if (j.winner === "b") b++;
    else t++;
  }
  return { a: a / n, b: b / n, tie: t / n };
}

// Provisional agreement heuristic: maps gap (0..100) + inter-judge agreement
// (0..1) to a 0..1 estimate. Not derived from calibration data — the numbers
// are chosen so small gaps stay humble; treat as a UI signal only.
function heuristicConfidence(gap: number, agreement: number): number {
  const gapC = Math.min(1, gap / 30); // gap=30 => 1.0
  return Math.max(0, Math.min(1, 0.35 + 0.5 * gapC + 0.15 * agreement)) ;
}

function isScoredJudge(judge: JudgedVerdict): boolean {
  return judge.scoreStatus !== "insufficient_evidence" && judge.observableAssessment?.status !== "insufficient_evidence";
}

/** Combine 1-2 judge verdicts into an ensemble with uncertainty. Pure function — no I/O. */
export function ensembleVerdicts(judges: JudgedVerdict[]): EnsembleResult {
  if (!judges.length) throw new Error("ensembleVerdicts: need at least one judge");
  const scoredJudges = judges.filter(isScoredJudge);
  if (!scoredJudges.length) {
    const first = judges[0];
    return {
      winner: "tie",
      playerAScore: 0,
      playerBScore: 0,
      scoreGap: 0,
      confidence: 0,
      isTie: true,
      tieReason: "Insufficient evidence: no judge returned a scoreable argument graph.",
      judges,
      scoreGapEstimate: { lo: 0, hi: 0 },
      judgeSplit: { a: 0, b: 0, tie: 1 },
      argGraph: first.argGraph,
      rationale: first.rationale,
      decidingFactor: "Insufficient evidence: no judge returned a scoreable argument graph.",
      scoreStatus: "insufficient_evidence",
      observableAssessment: first.observableAssessment,
    };
  }
  if (judges.length === 1) {
    const j = judges[0];
    const gap = Math.abs(j.playerAScore - j.playerBScore);
    const conf = heuristicConfidence(gap, 1);
    const isTie = gap < TIE_THRESHOLD;
    return {
      winner: isTie ? "tie" : j.winner,
      playerAScore: j.playerAScore,
      playerBScore: j.playerBScore,
      scoreGap: gap,
      confidence: isTie ? 0.5 : conf,
      isTie,
      tieReason: isTie ? `Score gap ${gap} < tie threshold ${TIE_THRESHOLD}` : undefined,
      judges,
      scoreGapEstimate: gapBand([{ a: j.playerAScore, b: j.playerBScore }]),
      judgeSplit: { a: j.winner === "a" ? 1 : 0, b: j.winner === "b" ? 1 : 0, tie: j.winner === "tie" ? 1 : 0 },
      argGraph: j.argGraph,
      rationale: j.rationale,
      decidingFactor: j.decidingFactor,
      scoreStatus: j.scoreStatus ?? j.observableAssessment?.status ?? "scored",
      observableAssessment: j.observableAssessment,
    };
  }
  // Multi-judge
  const avgA = Math.round(scoredJudges.reduce((s, j) => s + j.playerAScore, 0) / scoredJudges.length);
  const avgB = Math.round(scoredJudges.reduce((s, j) => s + j.playerBScore, 0) / scoredJudges.length);
  const gap = Math.abs(avgA - avgB);
  const post = judgeVoteShare(scoredJudges);
  const agree = Math.max(post.a, post.b, post.tie);
  const conf = heuristicConfidence(gap, agree);
  // Winner by majority vote; if no majority and gap small, tie.
  let winner: "a" | "b" | "tie";
  let tieReason: string | undefined;
  if (post.tie >= 0.5) { winner = "tie"; tieReason = `Judges split toward tie (${Math.round(post.tie * 100)}%)`; }
  else if (post.a > post.b && post.a > post.tie) winner = "a";
  else if (post.b > post.a && post.b > post.tie) winner = "b";
  else {
    // No majority and not tie-majority: fall back to score winner but mark low confidence
    winner = winnerFromScores(avgA, avgB);
    if (winner !== "tie" && gap < TIE_THRESHOLD) { winner = "tie"; tieReason = `No majority and gap ${gap} < ${TIE_THRESHOLD}`; }
    else if (conf < MIN_CONFIDENCE_FOR_WIN) { winner = "tie"; tieReason = `Confidence ${conf.toFixed(2)} < ${MIN_CONFIDENCE_FOR_WIN}`; }
  }
  if (gap < TIE_THRESHOLD && !tieReason) { winner = "tie"; tieReason = `Score gap ${gap} < tie threshold ${TIE_THRESHOLD}`; }
  // Pick graph from majority winner (or first judge if tie)
  const graphOwner = winner === "tie" ? scoredJudges[0].judgeId : scoredJudges.find((j) => j.winner === winner)?.judgeId ?? scoredJudges[0].judgeId;
  const graph = judges.find((j) => j.judgeId === graphOwner)?.argGraph ?? judges[0].argGraph;
  // Rationale: prefer the majority's rationale, else concatenate
  const majorityRationale = judges.find((j) => j.winner === winner)?.rationale;
  const rationale = majorityRationale ?? judges.map((j) => `[${j.judgeId}] ${j.rationale}`).join(" | ");

  return {
    winner,
    playerAScore: avgA,
    playerBScore: avgB,
    scoreGap: gap,
    confidence: winner === "tie" ? 0.5 : conf,
    isTie: winner === "tie",
    tieReason,
    judges,
    scoreGapEstimate: gapBand(scoredJudges.map((j) => ({ a: j.playerAScore, b: j.playerBScore }))),
    judgeSplit: post,
    argGraph: graph,
    rationale,
    decidingFactor: judges.find((j) => j.winner === winner)?.decidingFactor ?? judges[0].decidingFactor,
    scoreStatus: "scored",
    observableAssessment: judges.find((j) => j.judgeId === graphOwner)?.observableAssessment,
  };
}

// ---------------------------------------------------------------------------
// Live harness: call both judges with retries and timeout
// ---------------------------------------------------------------------------

const JUDGE_TIMEOUT_MS = 25_000;

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(t!);
  }
}

/** Live ensemble: runs OpenRouter and Anthropic judges in parallel (best-effort). Returns whatever succeeded. */
export async function liveEnsembleJudge(params: {
  topicTitle: string;
  topicPrompt: string;
  playerASide: "for" | "against";
  transcript: string;
}): Promise<EnsembleResult> {
  const settled = await Promise.allSettled([
    (async (): Promise<JudgedVerdict> => {
      // Primary chat transport: NVIDIA when its key is set, else OpenRouter.
      const primary = await import("./openrouter");
      const { makeFingerprint } = await import("./judgeVersioning");
      const t0 = Date.now();
      const r = await withTimeout(primary.judgePvpMatch(params), JUDGE_TIMEOUT_MS, primary.activeProviderLabel());
      return {
        ...r,
        judgeId: primary.activeProviderLabel(),
        latencyMs: Date.now() - t0,
        fingerprint: makeFingerprint(primary.activeProviderLabel(), process.env.NVIDIA_MODEL || process.env.OPENROUTER_MODEL || "default"),
      };
    })(),
    (async (): Promise<JudgedVerdict> => {
      const anthropic = await import("./anthropic");
      const { makeFingerprint } = await import("./judgeVersioning");
      const t0 = Date.now();
      const r = await withTimeout(anthropic.judgePvpMatch(params), JUDGE_TIMEOUT_MS, "anthropic");
      return {
        ...r,
        judgeId: "anthropic" as const,
        latencyMs: Date.now() - t0,
        fingerprint: makeFingerprint("anthropic", process.env.ANTHROPIC_MODEL || "claude-sonnet-5"),
      };
    })(),
  ]);
  const ok = settled.filter((r): r is PromiseFulfilledResult<JudgedVerdict> => r.status === "fulfilled").map((r) => r.value);
  if (!ok.length) {
    const reasons = settled.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason?.message ?? r));
    throw new Error(`All judges failed: ${reasons.join(" | ")}`);
  }
  return ensembleVerdicts(ok);
}

/**
 * Map an ensemble result onto the stored PvpVerdict shape, preserving the
 * uncertainty fields so the UI can show confidence, CIs, "too close to call",
 * and per-judge agreement. Pure function — no I/O.
 */
export function verdictFromEnsemble(e: EnsembleResult): PvpVerdict {
  // Surface the breakdown of a judge that actually scored the debate —
  // judges[0] may have returned insufficient_evidence while another scored.
  const breakdownSource = e.judges.find(isScoredJudge) ?? e.judges[0];
  return {
    winner: e.winner,
    playerAScore: e.playerAScore,
    playerBScore: e.playerBScore,
    rationale: e.rationale,
    decidingFactor: e.decidingFactor,
    argGraph: e.argGraph,
    breakdown: breakdownSource?.breakdown,
    confidence: e.confidence,
    scoreGapEstimate: e.scoreGapEstimate,
    judgeSplit: e.judgeSplit,
    isTie: e.isTie,
    tieReason: e.tieReason,
    judges: e.judges.map((j) => ({
      judgeId: j.judgeId,
      winner: j.winner,
      playerAScore: j.playerAScore,
      playerBScore: j.playerBScore,
      scoreStatus: j.scoreStatus ?? j.observableAssessment?.status,
      latencyMs: j.latencyMs,
    })),
    scoreStatus: e.scoreStatus,
    observableAssessment: e.observableAssessment,
    fingerprint: e.judges.length
      ? (() => {
          const fps = e.judges
            .filter((j) => j.fingerprint)
            .map((j) => j.fingerprint!) as JudgeFingerprint[];
          return fps.length ? makeEnsembleFingerprint(fps) : undefined;
        })()
      : undefined,
  };
}

