import { describe, expect, it } from "vitest";
import { buildTrainingSummary } from "./trainingSummary";

describe("buildTrainingSummary", () => {
  it("aggregates mode and speech observations without mixing per-mode profiles", () => {
    const summary = buildTrainingSummary([
      {
        training_meta: {
          modeId: "rapid-rebuttal",
          elapsedSeconds: 42,
          modeWarnings: [],
          speechTiming: null,
          speechAnalysis: { paceWpm: 130, fillerDensity: 2, structureDensity: 1, fillerCount: 1, pauseCount: 0, pauseRatio: 0, hasContrastiveMove: true, repetitionScore: null, wordCount: 50 },
          speechQuality: { overall: 78, breakdown: { paceScore: 90, fillerScore: 60, structureScore: 25, repetitionPenalty: 0, contrastiveBonus: 10 } },
        },
      },
      {
        training_meta: {
          modeId: "speech",
          elapsedSeconds: 70,
          modeWarnings: [],
          speechTiming: null,
          speechAnalysis: { paceWpm: 150, fillerDensity: 1, structureDensity: 2, fillerCount: 1, pauseCount: 0, pauseRatio: 0, hasContrastiveMove: true, repetitionScore: null, wordCount: 100 },
          speechQuality: { overall: 86, breakdown: { paceScore: 90, fillerScore: 80, structureScore: 50, repetitionPenalty: 0, contrastiveBonus: 10 } },
        },
      },
    ]);

    expect(summary.modeCounts).toEqual({ "rapid-rebuttal": 1, speech: 1 });
    expect(summary.byMode?.["rapid-rebuttal"]?.avgPaceWpm).toBe(130);
    expect(summary.byMode?.speech?.avgPaceWpm).toBe(150);
    expect(summary.byMode?.["rapid-rebuttal"]?.avgElapsedSeconds).toBe(42);
    expect(summary.speechTurns).toBe(2);
    expect(summary.avgPaceWpm).toBe(140);
    expect(summary.avgSpeechQuality).toBe(82);
    expect(summary.paceChangeWpm).toBe(20);
  });

  it("returns null speech averages when no speech metadata exists", () => {
    const summary = buildTrainingSummary([{ training_meta: { modeId: "text", elapsedSeconds: 95, modeWarnings: [], speechTiming: null, speechAnalysis: null, speechQuality: null } }]);
    expect(summary.speechTurns).toBe(0);
    expect(summary.avgPaceWpm).toBeNull();
    expect(summary.avgSpeechQuality).toBeNull();
    expect(summary.timedTurns).toBe(0);
    expect(summary.avgElapsedSeconds).toBeNull();
    expect(summary.byMode?.text?.avgElapsedSeconds).toBeNull();
  });
});
