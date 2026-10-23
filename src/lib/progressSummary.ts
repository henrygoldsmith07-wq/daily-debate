// Progress summary — the consumer-friendly view of the skill ledger.
//
// Turns coach-profile dims + slopes into the seven-skill display: current
// score, a simple trend, strongest/weakest area. Pure; the Progress page
// renders it directly. Reuses the shared coach profile (no second pipeline).

import { buildCoachProfile, type CoachDim, type CoachDimension } from "./adaptiveCoach";
import { DIMENSION_LABELS } from "./adaptiveCoach";
import type { SkillMetricPoint } from "./skillLedger";

export type Trend = "up" | "down" | "flat" | "no-data";

export interface ProgressSkill {
  key: CoachDimension;
  label: string;
  score: number | null;
  trend: Trend;
  trendLabel: string;
}

export interface ProgressSummary {
  skills: ProgressSkill[];
  strongest: { key: CoachDimension; label: string; score: number } | null;
  weakest: { key: CoachDimension; label: string; score: number } | null;
  debatesAnalysed: number;
  /** Below this, scores move around too much to read as signal. */
  minDebatesForStableScores: number;
}

const TREND_THRESHOLD = 0.01;

/**
 * A direction needs at least this many debates in which the skill was
 * actually observable. A line through 3 noisy points is not a trend; below
 * this the row says how far along the evidence is instead of an arrow.
 */
export const MIN_OBSERVATIONS_FOR_TREND = 4;

/** Simple trend from a per-debate goodness slope. */
export function trendFor(slope: number | null): { trend: Trend; label: string } {
  if (slope === null) return { trend: "no-data", label: "not enough debates yet" };
  if (slope > TREND_THRESHOLD) return { trend: "up", label: "improving" };
  if (slope < -TREND_THRESHOLD) return { trend: "down", label: "slipping" };
  return { trend: "flat", label: "steady" };
}

export function buildProgressSummary(points: SkillMetricPoint[]): ProgressSummary {
  const { dims, slopes, observations } = buildCoachProfile(points);

  const skills: ProgressSkill[] = dims.map((d: CoachDim) => {
    const seen = observations[d.key] ?? 0;
    const gated = seen < MIN_OBSERVATIONS_FOR_TREND;
    const { trend, label } = gated
      ? {
          trend: "no-data" as Trend,
          label:
            seen === 0
              ? "not observed yet"
              : `early read — seen in ${seen} of ${MIN_OBSERVATIONS_FOR_TREND} debates needed for a direction`,
        }
      : trendFor(slopes[d.key] ?? null);
    return { key: d.key, label: DIMENSION_LABELS[d.key], score: d.score, trend, trendLabel: label };
  });

  const scored = skills.filter((s): s is ProgressSkill & { score: number } => s.score !== null);
  const strongest = scored.length
    ? scored.reduce((best, s) => (s.score > best.score ? s : best))
    : null;
  const weakest = scored.length
    ? scored.reduce((worst, s) => (s.score < worst.score ? s : worst))
    : null;

  return {
    skills,
    strongest: strongest ? { key: strongest.key, label: strongest.label, score: strongest.score } : null,
    weakest: weakest ? { key: weakest.key, label: weakest.label, score: weakest.score } : null,
    debatesAnalysed: points.length,
    minDebatesForStableScores: 3,
  };
}
