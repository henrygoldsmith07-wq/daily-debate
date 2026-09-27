import { describe, expect, it } from "vitest";
import { buildTrainingProgress } from "./trainingProgress";
import type { SkillMetricPoint } from "./skillLedger";
import type { TrainingSummary } from "./types";

function point(completedAt: string, training: TrainingSummary): SkillMetricPoint {
  return { debateId: crypto.randomUUID(), completedAt, metrics: {} as SkillMetricPoint["metrics"], training };
}

describe("buildTrainingProgress", () => {
  it("keeps within-mode trends separate while retaining overall weighted summaries", () => {
    const summary = buildTrainingProgress([
      point("2026-09-20T08:00:00Z", {
        modeCounts: { speech: 2 },
        byMode: { speech: { turns: 2, timedTurns: 2, speechTurns: 2, avgElapsedSeconds: 70, avgPaceWpm: 120, avgFillerDensity: 2, avgStructureDensity: 1, avgSpeechQuality: 70 } },
        totalTurns: 2, timedTurns: 2, limitBreaches: 0, speechTurns: 2, avgElapsedSeconds: 70, avgPaceWpm: 120, avgFillerDensity: 2, avgStructureDensity: 1, avgSpeechQuality: 70, paceChangeWpm: null,
      }),
      point("2026-09-27T08:00:00Z", {
        modeCounts: { speech: 1, "rapid-rebuttal": 1 },
        byMode: {
          speech: { turns: 1, timedTurns: 1, speechTurns: 1, avgElapsedSeconds: 55, avgPaceWpm: 135, avgFillerDensity: 1, avgStructureDensity: 2, avgSpeechQuality: 82 },
          "rapid-rebuttal": { turns: 1, timedTurns: 1, speechTurns: 1, avgElapsedSeconds: 40, avgPaceWpm: 150, avgFillerDensity: 1, avgStructureDensity: 2, avgSpeechQuality: 90 },
        },
        totalTurns: 2, timedTurns: 2, limitBreaches: 0, speechTurns: 2, avgElapsedSeconds: 47.5, avgPaceWpm: 142.5, avgFillerDensity: 1, avgStructureDensity: 2, avgSpeechQuality: 86, paceChangeWpm: null,
      }),
    ]);

    expect(summary.modeTurns).toEqual({ speech: 3, "rapid-rebuttal": 1 });
    expect(summary.perMode.speech?.debates).toBe(2);
    expect(summary.perMode.speech?.speechQualityChange).toBe(12);
    expect(summary.perMode.speech?.responseTimeChangeSeconds).toBe(-15);
    expect(summary.perMode["rapid-rebuttal"]?.avgPaceWpm).toBe(150);
    expect(summary.avgPaceWpm).toBe(131.3);
  });
});
