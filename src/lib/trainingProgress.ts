import type { DebateModeId } from "./debateModes";
import type { SkillMetricPoint } from "./skillLedger";
import type { TrainingModeSummary } from "./types";

export const MIN_MODE_TREND_DEBATES = 3;
export const MIN_MODE_TREND_TURNS = 5;

export interface ModeTrainingProgress {
  debates: number;
  turns: number;
  speechTurns: number;
  avgSpeechQuality: number | null;
  avgPaceWpm: number | null;
  avgFillerDensity: number | null;
  avgStructureDensity: number | null;
  avgResponseSeconds: number | null;
  speechQualityChange: number | null;
  responseTimeChangeSeconds: number | null;
  speechTrendReady: boolean;
  responseTrendReady: boolean;
}

export interface TrainingProgressSummary {
  modeTurns: Partial<Record<DebateModeId, number>>;
  perMode: Partial<Record<DebateModeId, ModeTrainingProgress>>;
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

function trendReady(rows: TrainingModeSummary[], weightKey: "speechTurns" | "timedTurns"): boolean {
  return rows.length >= MIN_MODE_TREND_DEBATES
    && rows.reduce((sum, row) => sum + row[weightKey], 0) >= MIN_MODE_TREND_TURNS;
}

function observedChange(
  rows: TrainingModeSummary[],
  key: "avgSpeechQuality" | "avgElapsedSeconds",
  weightKey: "speechTurns" | "timedTurns",
): number | null {
  if (!trendReady(rows, weightKey)) return null;
  const values = rows
    .map((row) => row[key])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length < MIN_MODE_TREND_DEBATES) return null;
  return Math.round((values[values.length - 1] - values[0]) * 10) / 10;
}

export function buildTrainingProgress(points: SkillMetricPoint[]): TrainingProgressSummary {
  const withTraining = points.filter((point) => point.training && point.training.totalTurns > 0);
  const modeTurns: Partial<Record<DebateModeId, number>> = {};
  for (const point of withTraining) {
    for (const [mode, count] of Object.entries(point.training?.modeCounts ?? {})) {
      modeTurns[mode as DebateModeId] = (modeTurns[mode as DebateModeId] ?? 0) + (count ?? 0);
    }
  }

  const perMode: Partial<Record<DebateModeId, ModeTrainingProgress>> = {};
  for (const mode of Object.keys(modeTurns) as DebateModeId[]) {
    const rows = withTraining
      .map((point) => point.training?.byMode?.[mode] ?? null)
      .filter((row): row is TrainingModeSummary => !!row && row.turns > 0);
    if (!rows.length) continue;

    const speechReady = trendReady(rows, "speechTurns");
    const responseReady = trendReady(rows, "timedTurns");
    perMode[mode] = {
      debates: rows.length,
      turns: rows.reduce((sum, row) => sum + row.turns, 0),
      speechTurns: rows.reduce((sum, row) => sum + row.speechTurns, 0),
      avgSpeechQuality: weightedAverage(rows.map((row) => ({ value: row.avgSpeechQuality, weight: row.speechTurns }))),
      avgPaceWpm: weightedAverage(rows.map((row) => ({ value: row.avgPaceWpm, weight: row.speechTurns }))),
      avgFillerDensity: weightedAverage(rows.map((row) => ({ value: row.avgFillerDensity, weight: row.speechTurns }))),
      avgStructureDensity: weightedAverage(rows.map((row) => ({ value: row.avgStructureDensity, weight: row.speechTurns }))),
      avgResponseSeconds: weightedAverage(rows.map((row) => ({ value: row.avgElapsedSeconds, weight: row.timedTurns }))),
      speechQualityChange: observedChange(rows, "avgSpeechQuality", "speechTurns"),
      responseTimeChangeSeconds: observedChange(rows, "avgElapsedSeconds", "timedTurns"),
      speechTrendReady: speechReady,
      responseTrendReady: responseReady,
    };
  }

  const spoken = withTraining.filter((point) => (point.training?.speechTurns ?? 0) > 0);
  const spokenTurns = spoken.reduce((sum, point) => sum + (point.training?.speechTurns ?? 0), 0);

  return {
    modeTurns,
    perMode,
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
