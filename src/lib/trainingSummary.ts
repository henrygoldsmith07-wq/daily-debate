import { DEBATE_MODES, isDebateModeId, type DebateModeId } from "./debateModes";
import type { TrainingSummary, TurnTrainingMeta } from "./types";

type TrainingTurn = { training_meta?: unknown };

function asMeta(value: unknown): TurnTrainingMeta | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<TurnTrainingMeta>;
  if (!isDebateModeId(candidate.modeId)) return null;
  return {
    modeId: candidate.modeId,
    elapsedSeconds: typeof candidate.elapsedSeconds === "number" && Number.isFinite(candidate.elapsedSeconds)
      ? candidate.elapsedSeconds
      : null,
    modeWarnings: Array.isArray(candidate.modeWarnings)
      ? candidate.modeWarnings.filter((warning): warning is string => typeof warning === "string")
      : [],
    speechTiming: candidate.speechTiming ?? null,
    speechAnalysis: candidate.speechAnalysis ?? null,
    speechQuality: candidate.speechQuality ?? null,
  };
}

function average(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!valid.length) return null;
  return Math.round((valid.reduce((sum, value) => sum + value, 0) / valid.length) * 10) / 10;
}

export function buildTrainingSummary(turns: TrainingTurn[]): TrainingSummary {
  const metas = turns.map((turn) => asMeta(turn.training_meta)).filter((meta): meta is TurnTrainingMeta => !!meta);
  const modeCounts: Partial<Record<DebateModeId, number>> = {};
  for (const meta of metas) modeCounts[meta.modeId] = (modeCounts[meta.modeId] ?? 0) + 1;

  const spoken = metas.filter((meta) => !!meta.speechAnalysis);
  const timed = metas.filter((meta) => DEBATE_MODES[meta.modeId].hardTimeLimitSecs !== null);
  const paces = spoken
    .map((meta) => meta.speechAnalysis?.paceWpm ?? null)
    .filter((value): value is number => typeof value === "number");

  return {
    modeCounts,
    totalTurns: metas.length,
    timedTurns: timed.filter((meta) => meta.elapsedSeconds !== null).length,
    limitBreaches: metas.filter((meta) => meta.modeWarnings.some((warning) => warning.startsWith("Exceeded "))).length,
    speechTurns: spoken.length,
    avgElapsedSeconds: average(timed.map((meta) => meta.elapsedSeconds)),
    avgPaceWpm: average(spoken.map((meta) => meta.speechAnalysis?.paceWpm)),
    avgFillerDensity: average(spoken.map((meta) => meta.speechAnalysis?.fillerDensity)),
    avgStructureDensity: average(spoken.map((meta) => meta.speechAnalysis?.structureDensity)),
    avgSpeechQuality: average(spoken.map((meta) => meta.speechQuality?.overall)),
    paceChangeWpm: paces.length >= 2 ? Math.round((paces[paces.length - 1] - paces[0]) * 10) / 10 : null,
  };
}
