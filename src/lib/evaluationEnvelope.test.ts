import { describe, it, expect } from "vitest";
import {
  EVALUATION_SCHEMA_VERSION,
  POLICY_VERSION,
  evaluationStamp,
  stampVerdict,
  buildEvaluationResult,
} from "./evaluationEnvelope";
import { SCORING_ENGINE_VERSION } from "./judgeVersioning";
import type { PvpVerdict } from "./types";

const baseVerdict: PvpVerdict = {
  winner: "a",
  playerAScore: 70,
  playerBScore: 50,
  rationale: "test",
};

describe("evaluationEnvelope", () => {
  it("policy version mirrors the scoring engine version", () => {
    expect(POLICY_VERSION).toBe(SCORING_ENGINE_VERSION);
  });

  it("builds a complete stamp", () => {
    const at = new Date("2026-09-05T12:00:00Z");
    expect(evaluationStamp(at)).toEqual({
      schemaVersion: EVALUATION_SCHEMA_VERSION,
      policyVersion: SCORING_ENGINE_VERSION,
      evaluatedAt: at.toISOString(),
    });
  });

  it("stampVerdict is additive and pure", () => {
    const at = new Date("2026-09-05T12:00:00Z");
    const stamped = stampVerdict(baseVerdict, at);
    expect(stamped.evaluation).toEqual(evaluationStamp(at));
    expect(stamped.winner).toBe("a");
    // input untouched
    expect(baseVerdict.evaluation).toBeUndefined();
  });

  it("stampVerdict preserves existing fields on failure verdicts too", () => {
    const failure: PvpVerdict = { ...baseVerdict, winner: "tie", scoreStatus: "insufficient_evidence" };
    const stamped = stampVerdict(failure);
    expect(stamped.scoreStatus).toBe("insufficient_evidence");
    expect(stamped.evaluation?.schemaVersion).toBe(EVALUATION_SCHEMA_VERSION);
  });

  it("buildEvaluationResult wraps parts into the canonical envelope", () => {
    const at = new Date("2026-09-05T12:00:00Z");
    const result = buildEvaluationResult({ scoreStatus: "scored", verdict: baseVerdict }, at);
    expect(result.stamp).toEqual(evaluationStamp(at));
    expect(result.scoreStatus).toBe("scored");
    expect(result.verdict).toBe(baseVerdict);
    expect(result.summary).toBeUndefined();
  });
});
