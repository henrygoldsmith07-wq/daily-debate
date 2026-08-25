// Judge health tracker — benchmark history + gate-based auto-retirement.
//
// Every scheduled judge-benchmark run appends a health entry. When a model's
// recent scores fall below the configured gates, the model is automatically
// retired from judging and the retirement is logged. This prevents a silently
// degraded model from contaminating rankings or skill assessments.

export interface JudgeHealthEntry {
  /** ISO date of the benchmark run */
  date: string;
  /** Judge identifier: "nvidia:nemotron-3-ultra" etc. */
  judgeId: string;
  /** Position-swap mirror stability 0..1 */
  positionMirrorStability: number;
  /** Verbosity stability 0..1 */
  verbosityStability: number;
  /** Fixture-label agreement 0..1 */
  humanAgreement: number;
  /** Expected Calibration Error */
  ece: number;
  /** False-citation influence rate 0..1 */
  falseCitationInfluence: number;
  /** Whether all gates passed on this run */
  gatesPassed: boolean;
}

// --- gates (mirrors config/judge-gates.json defaults) ------------------------

const GATES = {
  positionMirrorMin: 0.97,
  verbosityStabilityMin: 0.95,
  humanAgreementMin: 0.75,
  eceMax: 0.08,
  falseCitationInfluenceMax: 0.05,
};

export interface GateCheck {
  gate: string;
  passed: boolean;
  value: number | null;
  threshold: number;
}

export function checkGates(entry: JudgeHealthEntry): GateCheck[] {
  return [
    { gate: "positionMirror", passed: entry.positionMirrorStability >= GATES.positionMirrorMin, value: entry.positionMirrorStability, threshold: GATES.positionMirrorMin },
    { gate: "verbosityStability", passed: entry.verbosityStability >= GATES.verbosityStabilityMin, value: entry.verbosityStability, threshold: GATES.verbosityStabilityMin },
    { gate: "humanAgreement", passed: entry.humanAgreement >= GATES.humanAgreementMin, value: entry.humanAgreement, threshold: GATES.humanAgreementMin },
    { gate: "ece", passed: entry.ece <= GATES.eceMax, value: entry.ece, threshold: GATES.eceMax },
    { gate: "falseCitationInfluence", passed: entry.falseCitationInfluence <= GATES.falseCitationInfluenceMax, value: entry.falseCitationInfluence, threshold: GATES.falseCitationInfluenceMax },
  ];
}

function passesGates(entry: JudgeHealthEntry): boolean {
  return checkGates(entry).every((c) => c.passed);
}

// --- trend analysis -----------------------------------------------------------

/**
 * Detect degradation over the last N entries for a judge.
 * Returns true when the most recent window is significantly worse than
 * the preceding window (both non-empty).
 */
export function detectDegradation(
  entries: JudgeHealthEntry[],
  windowSize = 2,
): { degraded: boolean; recentMean: number | null; priorMean: number | null } {
  if (entries.length < windowSize * 2) return { degraded: false, recentMean: null, priorMean: null };

  const agreementOf = (e: JudgeHealthEntry) => e.humanAgreement;

  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date)); // newest first
  const recent = sorted.slice(0, windowSize);
  const prior = sorted.slice(windowSize, windowSize * 2);

  const mean = (arr: JudgeHealthEntry[]) =>
    arr.length ? arr.reduce((s, e) => s + agreementOf(e), 0) / arr.length : null;

  const recentMean = mean(recent);
  const priorMean = mean(prior);

  if (recentMean === null || priorMean === null) return { degraded: false, recentMean, priorMean };

  // Degraded when recent mean drops ≥5 percentage points below prior
  return { degraded: recentMean <= priorMean - 0.05, recentMean, priorMean };
}

// --- auto-retirement ----------------------------------------------------------

export interface RetirementDecision {
  shouldRetire: boolean;
  reason: string;
  failedGates: GateCheck[];
}

/**
 * Should this judge be retired from active duty?
 *
 * Rules:
 *   1. Immediate retirement: any single run fails ALL gates simultaneously
 *      (the model is fundamentally broken or misconfigured).
 *   2. Gradual retirement: 3 consecutive runs fail the same primary gate.
 *   3. Drift-based retirement: recent agreement mean is >5pp below prior mean
 *      AND the latest run also fails at least one gate.
 */
export function evaluateRetirement(
  history: JudgeHealthEntry[],
): RetirementDecision {
  if (!history.length) {
    return { shouldRetire: false, reason: "No data.", failedGates: [] };
  }

  const sorted = [...history].sort((a, b) => b.date.localeCompare(a.date));
  const latest = sorted[0];
  const latestChecks = checkGates(latest);
  const latestFailed = latestChecks.filter((c) => !c.passed);

  // Rule 1: all gates failed simultaneously → immediate
  if (latestFailed.length === latestChecks.length) {
    return {
      shouldRetire: true,
      reason: `All ${latestChecks.length} gates failed in latest run (${latest.date}). Model likely broken or misconfigured.`,
      failedGates: latestFailed,
    };
  }

  // Rule 2: same gate failed in last 3 consecutive runs
  if (sorted.length >= 3) {
    const recentThree = sorted.slice(0, 3);
    for (let i = 0; i < latestChecks.length; i++) {
      const gateName = latestChecks[i].gate;
      const allFailSameGate = recentThree.every((entry) => {
        const checks = checkGates(entry);
        const c = checks.find((c2) => c2.gate === gateName);
        return c && !c.passed;
      });
      if (allFailSameGate) {
        return {
          shouldRetire: true,
          reason: `Gate "${gateName}" failed in 3 consecutive runs. Systematic failure, not noise.`,
          failedGates: [latestChecks[i]],
        };
      }
    }
  }

  // Rule 3: drift detected AND latest run has at least one gate failure
  const drift = detectDegradation(history);
  if (drift.degraded && latestFailed.length > 0) {
    return {
      shouldRetire: true,
      reason: `Model drift detected: agreement dropped from ${Math.round((drift.priorMean ?? 0) * 100)}% to ${Math.round((drift.recentMean ?? 0) * 100)}% and latest run still fails ${latestFailed.length} gate(s).`,
      failedGates: latestFailed,
    };
  }

  return { shouldRetire: false, reason: "Within tolerance.", failedGates: [] };
}

/** Generate a text bar chart for the benchmark history (for /metrics page). */
export function healthBarChart(
  entries: JudgeHealthEntry[],
  judgeId?: string,
): string {
  let filtered = judgeId ? entries.filter((e) => e.judgeId === judgeId) : entries;
  filtered = [...filtered].sort((a, b) => a.date.localeCompare(b.date));
  if (!filtered.length) return "No benchmark history.";

  const lines: string[] = [];
  for (const e of filtered.slice(-12)) {
    const pct = Math.round(e.humanAgreement * 100);
    const filled = Math.round(pct / 10);
    const bar = "\u2588".repeat(filled) + "\u2591".repeat(10 - filled);
    const flag = passesGates(e) ? "" : " \u26A0";
    lines.push(`${e.date}  ${bar} ${pct}%${flag}`);
  }
  return lines.join("\n");
}
