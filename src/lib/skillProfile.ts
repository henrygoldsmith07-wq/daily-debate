// Argument Skill Profile — persistent 7-dimension view derived from the
// skill ledger's raw metrics. Sample-gated: scores below MIN_PROFILE_DEBATES
// are flagged as low-confidence rather than presented as definitive.
//
// Pure — consumes SkillMetricPoint[] from the ledger, produces display data.

import type { MetricKey, SkillMetricPoint } from "./skillLedger";
import { HIGHER_IS_BETTER } from "./skillLedger";

export type ProfileDimensionKey =
  | "claim-clarity"
  | "evidence"
  | "reasoning"
  | "rebuttal"
  | "weighing"
  | "structure"
  | "delivery";

export const PROFILE_DIMENSIONS: Array<{
  key: ProfileDimensionKey;
  label: string;
  sources: MetricKey[];
}> = [
  { key: "claim-clarity", label: "Claim clarity", sources: ["clarity", "unsupportedClaimRate"] },
  { key: "evidence",      label: "Evidence",       sources: ["evidenceGrounding", "uncitedEvidenceRate"] },
  { key: "reasoning",     label: "Reasoning",      sources: ["fallacyRate", "causalOverclaims"] },
  { key: "rebuttal",      label: "Rebuttal",       sources: ["rebuttalCoverage"] },
  { key: "weighing",      label: "Weighing",       sources: ["impactHandling"] },
  { key: "structure",     label: "Structure",      sources: ["droppedArguments", "contradictions", "steelmanQuality"] },
  { key: "delivery",      label: "Delivery",       sources: ["fakePrecisionHits"] },
];

export const MIN_PROFILE_DEBATES = 3;

function goodness(value: number | null | undefined, metric: MetricKey): number | null {
  if (value === null || value === undefined) return null;
  const v = Math.max(0, Math.min(1, value));
  return HIGHER_IS_BETTER[metric] ? v : 1 - v;
}

export interface ProfileDimension {
  key: ProfileDimensionKey;
  label: string;
  score: number | null;
  lowConfidence: boolean;
  sampleSize: number;
}

export interface ArgumentSkillProfile {
  dimensions: ProfileDimension[];
  debatesAnalysed: number;
  minDebates: number;
  overallScore: number | null;
}

export function computeSkillProfile(points: SkillMetricPoint[]): ArgumentSkillProfile {
  const dims: ProfileDimension[] = PROFILE_DIMENSIONS.map(({ key, label, sources }) => {
    const allValues: number[] = [];
    for (const point of points) {
      for (const src of sources) {
        const g = goodness(point.metrics[src], src);
        if (g !== null) allValues.push(g);
      }
    }
    if (!allValues.length) {
      return { key, label, score: null, lowConfidence: true, sampleSize: 0 };
    }
    const mean = Math.round((allValues.reduce((s, v) => s + v, 0) / allValues.length) * 100);
    return {
      key,
      label,
      score: Math.max(0, Math.min(100, mean)),
      lowConfidence: points.length < MIN_PROFILE_DEBATES,
      sampleSize: points.length,
    };
  });

  const scored = dims.filter((d) => d.score !== null);
  const overallScore = scored.length
    ? Math.round(scored.reduce((s, d) => s + (d.score ?? 0), 0) / scored.length)
    : null;

  return {
    dimensions: dims,
    debatesAnalysed: points.length,
    minDebates: MIN_PROFILE_DEBATES,
    overallScore,
  };
}
