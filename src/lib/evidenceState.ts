// Evidence-state gates + uncertainty intervals for published metrics.
//
// Every published metric carries an explicit evidence state so consumers know
// whether to trust the number. A percentage without uncertainty is not a
// validation result.

// --- evidence state ----------------------------------------------------------

export type EvidenceState = "insufficient" | "early" | "reportable";

/** Per-metric minimum sample sizes with documented justification. */
export const SAMPLE_GATES = {
  /** Human consensus needs enough items to detect disagreement patterns. */
  humanConsensus: { minReportable: 30, minEarly: 5 },
  /** Judge-vs-human accuracy is THE headline; needs substantial n before claiming validity. */
  judgeVsConsensus: { minReportable: 50, minEarly: 10 },
  /** Close-debate subset is inherently smaller. */
  closeDebateAccuracy: { minReportable: 20, minEarly: 5 },
  /** Position-swap requires paired runs (2× cost). */
  positionSwapStability: { minReportable: 15, minEarly: 5 },
  /** Calibration bins need spread across confidence ranges. */
  calibration: { minReportable: 40, minEarly: 10 },
  /** Citation verifier error rate needs many cited nodes for stable estimates. */
  citationFlagRate: { minReportable: 50, minEarly: 10 },
} as const;

export type GateKey = keyof typeof SAMPLE_GATES;

/**
 * Wilson score interval for a binomial proportion.
 * Better than normal approximation at small n — never produces bounds
 * outside [0,1] and doesn't collapse to zero-width at low counts.
 *
 * @param successes - number of favourable outcomes
 * @param total     - total trials (n)
 * @param z         - z-score for desired confidence (default 1.96 = 95%)
 * @returns [lower, upper] clamped to [0,1]
 */
export function wilsonInterval(
  successes: number,
  total: number,
  z = 1.96,
): [number, number] {
  if (total <= 0) return [0, 1];
  const p = successes / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const centre = (p + z2 / (2 * total)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denom;
  return [
    Math.max(0, Math.round((centre - margin) * 10000) / 10000),
    Math.min(1, Math.round((centre + margin) * 10000) / 10000),
  ];
}

export interface GatedMetric {
  /** Point estimate 0–100 or null if insufficient */
  estimate: number | null;
  /** Wilson lower bound 0–100 */
  ciLower: number | null;
  /** Wilson upper bound 0–100 */
  ciUpper: number | null;
  /** Sample size backing this metric */
  n: number;
  /** Explicit evidence quality signal */
  state: EvidenceState;
}

/**
 * Produce a gated metric result from raw counts.
 * Returns null estimate when below the early threshold; flags as early
 * between early and reportable thresholds.
 */
export function gateBinomial(
  successes: number,
  total: number,
  gate: { minReportable: number; minEarly: number },
): GatedMetric {
  const state = resolveEvidenceState(total, gate);
  const [lo, hi] = wilsonInterval(successes, total);
  const pctVal = total > 0 ? Math.round((successes / total) * 1000) / 10 : null;
  return {
    estimate: state === "insufficient" ? null : pctVal,
    ciLower: state === "insufficient" ? null : Math.round(lo * 1000) / 10,
    ciUpper: state === "insufficient" ? null : Math.round(hi * 1000) / 10,
    n: total,
    state,
  };
}

function resolveEvidenceState(n: number, gate: { minReportable: number; minEarly: number }): EvidenceState {
  if (n >= gate.minReportable) return "reportable";
  if (n >= gate.minEarly) return "early";
  return "insufficient";
}
