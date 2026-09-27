import { describe, expect, it } from "vitest";
import { buildTrainingProgress } from "./trainingProgress";
import type { SkillMetricPoint } from "./skillLedger";

function point(training: SkillMetricPoint["training"]): SkillMetricPoint {
  return { debateId: crypto.randomUUID(), completedAt: "2026-09-27T08:00:00Z", metrics: {} as SkillMetricPoint["metrics"], training };
}

describe("buildTrainingProgress", () => {
  it("weights speech observations by the number of spoken turns", () => {
    const summary = buildTrainingProgress([
      point({ modeCounts: { speech: 2 }, totalTurns: 2, timedTurns: 2, limitBreaches: 0, speechTurns: 2, avgElapsedSeconds: 60, avgPaceWpm: 120, avgFillerDensity: 2, avgStructureDensity: 1, avgSpeechQuality: 70, paceChangeWpm: null }),
      point({ modeCounts: { "rapid-rebuttal": 1 }, totalTurns: 1, timedTurns: 1, limitBreaches: 0, speechTurns: 1, avgElapsedSeconds: 40, avgPaceWpm: 150, avgFillerDensity: 1, avgStructureDensity: 2, avgSpeechQuality: 90, paceChangeWpm: null }),
    ]);
    expect(summary.modeTurns).toEqual({ speech: 2, "rapid-rebuttal": 1 });
    expect(summary.avgSpeechQuality).toBeCloseTo(76.7, 1);
    expect(summary.avgPaceWpm).toBe(130);
  });
});
