// Per-dimension validation module.
//
// Separates four distinct validity questions so strong winner agreement
// cannot masquerade as skill-measurement validity:
//   A. Winner classification agreement
//   B. Rubric-score correlation / MAE per dimension
//   C. Evidence-grounding metric accuracy
//   D. Coaching-target identification accuracy

import { SAMPLE_GATES, gateBinomial, wilsonInterval, type GatedMetric } from "./evidenceState";

// --- types -------------------------------------------------------------------

export interface ValidationResult {
  n: number;
  state: "insufficient" | "early" | "reportable";
  estimate: number | null;
  ciLower: number | null;
  ciUpper: number | null;
  detail: string;
}

export interface DimensionValidation {
  dimension: string;
  humanIRR: number | null; // inter-rater reliability
  systemHumanCorrelation: number | null;
  mae: number | null;
  n: number;
  state: "insufficient" | "early" | "reportable";
}

// --- A. Winner validity --------------------------------------------------------

export function validateWinnerAgreement(
  agreements: Array<{ judgeWinner: string; humanConsensus: string }>,
): ValidationResult {
  const n = agreements.length;
  const agree = agreements.filter((a) => a.judgeWinner === a.humanConsensus).length;
  const gated = gateBinomial(agree, n, SAMPLE_GATES.judgeVsConsensus);
  return {
    ...gated,
    detail: `${agree}/${n} winner classifications match human consensus`,
  };
}

// --- B. Per-dimension score validity -------------------------------------------

/**
 * Compare system scores against mean human rubric scores per dimension.
 * Reports Pearson correlation and MAE when enough paired observations exist.
 */
export function validateDimensionScores(
  pairs: Array<{ dimension: string; systemScore: number; humanMeanScore: number }>,
): DimensionValidation[] {
  const byDim = new Map<string, Array<{ sys: number; hum: number }>>();
  for (const p of pairs) {
    const list = byDim.get(p.dimension) ?? [];
    list.push({ sys: p.systemScore, hum: p.humanMeanScore });
    byDim.set(p.dimension, list);
  }

  return [...byDim.entries()].map(([dimension, obs]) => {
    if (obs.length < 10) {
      return { dimension, humanIRR: null, systemHumanCorrelation: null, mae: null, n: obs.length, state: "insufficient" };
    }

    // Pearson correlation
    const n = obs.length;
    const meanS = obs.reduce((s, o) => s + o.sys, 0) / n;
    const meanH = obs.reduce((s, o) => s + o.hum, 0) / n;
    let cov = 0, varS = 0, varH = 0;
    for (const o of obs) {
      const ds = o.sys - meanS, dh = o.hum - meanH;
      cov += ds * dh; varS += ds * ds; varH += dh * dh;
    }
    const denom = Math.sqrt(varS * varH);
    const corr = denom > 0 ? Math.round((cov / denom) * 1000) / 1000 : null;

    // MAE
    const mae = Math.round(obs.reduce((s, o) => s + Math.abs(o.sys - o.hum), 0) / n * 1000) / 1000;

    const reportable = obs.length >= SAMPLE_GATES.judgeVsConsensus.minReportable;

    return {
      dimension,
      humanIRR: null, // requires multi-rater data per observation
      systemHumanCorrelation: corr,
      mae,
      n: obs.length,
      state: reportable ? "reportable" : obs.length >= SAMPLE_GATES.judgeVsConsensus.minEarly ? "early" : "insufficient",
    };
  });
}

// --- C. Coaching-target validity -------------------------------------------------

/**
 * Does the coach identify the same weakness humans would identify?
 * Compares coach-selected focus against human-rated weakest dimension.
 */
export function validateCoachingTarget(
  cases: Array<{ coachFocus: string; humanWeakestDimension: string }>,
): ValidationResult {
  const n = cases.length;
  const correct = cases.filter((c) => c.coachFocus === c.humanWeakestDimension).length;
  const gated = gateBinomial(correct, n, {
    minReportable: SAMPLE_GATES.judgeVsConsensus.minReportable,
    minEarly: SAMPLE_GATES.judgeVsConsensus.minEarly,
  });
  return {
    ...gated,
    detail: `${correct}/${n} coaching targets match human-identified weakest dimension`,
  };
}
