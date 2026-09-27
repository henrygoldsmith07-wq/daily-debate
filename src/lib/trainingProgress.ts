import type { DebateModeId } from "./debateModes";
import type { SkillMetricPoint } from "./skillLedger";

export interface TrainingProgressSummary {
  modeTurns: Partial<Record<DebateModeId, number>>;
  debatesWithTrainingData: number;
  spokenDebates: number;
  spokenTurns: number;
  avgSpeechQuality: number | null;
  avgPaceWpm: number | null;
  avgFillerDensity: number | null;
  avgStructureDensity: number | null;
  avgResponseSeconds: number | null;
}

function weightedAverage(rows: Array<{ value: number | null; weight: number }>): number | null {
  const usable = rows.filter((row) => row.value !== null && row.weight > 0) as Array<{ value: number; weight: number }>;
  const weight = usable.reduce((sum, row) => sum + row.weight, 0);
  if (!weight) return null;
  return Math.round((usable.reduce((sum, row) => sum + row.value * row.weight, 0) / weight) * 10) / 10;
}

export function buildTrainingProgress(points: SkillMetricPoint[]): TrainingProgressSummary {
  const withTraining = points.filter((point) => point.training && point.training.totalTurns > 0);
  const modeTurns: Partial<Record<DebateModeId, number>> = {};
  for (const point of withTraining) {
    for (const [mode, count] of Object.entries(point.training?.modeCounts ?? {})) {
      modeTurns[mode as DebateModeId] = (modeTurns[mode as DebateModeId] ?? 0) + (count ?? 0);
    }
  }

  const spoken = withTraining.filter((point) => (point.training?.speechTurns ?? 0) > 0);
  const spokenTurns = spoken.reduce((sum, point) => sum + (point.training?.speechTurns ?? 0), 0);

  return {
    modeTurns,
    debatesWithTrainingData: withTraining.length,
    spokenDebates: spoken.length,
    spokenTurns,
    avgSpeechQuality: weightedAverage(spoken.map((point) => ({ value: point.training?.avgSpeechQuality ?? null, weight: point.training?.speechTurns ?? 0 }))),
    avgPaceWpm: weightedAverage(spoken.map((point) => ({ value: point.training?.avgPaceWpm ?? null, weight: point.training?.speechTurns ?? 0 }))),
    avgFillerDensity: weightedAverage(spoken.map((point) => ({ value: point.training?.avgFillerDensity ?? null, weight: point.training?.speechTurns ?? 0 }))),
    avgStructureDensity: weightedAverage(spoken.map((point) => ({ value: point.training?.avgStructureDensity ?? null, weight: point.training?.speechTurns ?? 0 }))),
    avgResponseSeconds: weightedAverage(withTraining.map((point) => ({ value: point.training?.avgElapsedSeconds ?? null, weight: point.training?.timedTurns ?? 0 }))),
  };
}
