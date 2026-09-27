import { describe, expect, it } from "vitest";
import { buildTrainingProgress, MIN_MODE_TREND_DEBATES, MIN_MODE_TREND_TURNS } from "./trainingProgress";
import type { SkillMetricPoint } from "./skillLedger";
import type { TrainingSummary } from "./types";

function point(completedAt: string, training: TrainingSummary): SkillMetricPoint {
  return { debateId: crypto.randomUUID(), completedAt, metrics: {} as SkillMetricPoint["metrics"], training };
}

function speechSummary(turns: number, quality: number, elapsed: number): TrainingSummary {
  return {
    modeCounts: { speech: turns },
    byMode: {
      speech: {
        turns,
        timedTurns: turns,
        speechTurns: turns,
        avgElapsedSeconds: elapsed,
        avgPaceWpm: 130,
        avgFillerDensity: 1,
        avgStructureDensity: 2,
        avgSpeechQuality: quality,
      },
    },
    totalTurns: turns,
    timedTurns: turns,
    limitBreaches: 0,
    speechTurns: turns,
    avgElapsedSeconds: elapsed,
    avgPaceWpm: 130,
    avgFillerDensity: 1,
    avgStructureDensity: 2,
    avgSpeechQuality: quality,
    paceChangeWpm: null,
  };
}

describe("buildTrainingProgress", () => {
  it("withholds within-mode change until enough debates and turns exist", () => {
    const summary = buildTrainingProgress([
      point("2026-09-20T08:00:00Z", speechSummary(2, 70, 70)),
      point("2026-09-27T08:00:00Z", speechSummary(1, 82, 55)),
    ]);

    expect(MIN_MODE_TREND_DEBATES).toBe(3);
    expect(MIN_MODE_TREND_TURNS).toBe(5);
    expect(summary.perMode.speech?.speechTrendReady).toBe(false);
    expect(summary.perMode.speech?.responseTrendReady).toBe(false);
    expect(summary.perMode.speech?.speechQualityChange).toBeNull();
    expect(summary.perMode.speech?.responseTimeChangeSeconds).toBeNull();
  });

  it("shows within-mode change only after the evidence threshold is met", () => {
    const summary = buildTrainingProgress([
      point("2026-09-13T08:00:00Z", speechSummary(2, 70, 70)),
      point("2026-09-20T08:00:00Z", speechSummary(1, 76, 63)),
      point("2026-09-27T08:00:00Z", speechSummary(2, 82, 55)),
    ]);

    expect(summary.modeTurns).toEqual({ speech: 5 });
    expect(summary.perMode.speech?.debates).toBe(3);
    expect(summary.perMode.speech?.speechTrendReady).toBe(true);
    expect(summary.perMode.speech?.responseTrendReady).toBe(true);
    expect(summary.perMode.speech?.speechQualityChange).toBe(12);
    expect(summary.perMode.speech?.responseTimeChangeSeconds).toBe(-15);
    expect(summary.avgPaceWpm).toBe(130);
  });
});
