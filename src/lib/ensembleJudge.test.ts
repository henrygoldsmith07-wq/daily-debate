import { describe, it, expect } from "vitest";
import { ensembleVerdicts, verdictFromEnsemble } from "./ensembleJudge";
import type { JudgedVerdict } from "./ensembleJudge";

function judge(judgeId: "openrouter" | "anthropic", winner: "a" | "b" | "tie", a: number, b: number): JudgedVerdict {
  return { judgeId, winner, playerAScore: a, playerBScore: b, rationale: `${judgeId} rationale` };
}

describe("ensembleVerdicts — uncertainty", () => {
  it("single judge with a close gap is 'too close to call' (tie, not a forced win)", () => {
    const e = ensembleVerdicts([judge("openrouter", "a", 50, 52)]);
    expect(e.winner).toBe("tie");
    expect(e.isTie).toBe(true);
    expect(e.tieReason).toMatch(/tie threshold/);
    expect(e.confidence).toBe(0.5);
  });

  it("single judge with a clear gap keeps the winner and sets confidence", () => {
    const e = ensembleVerdicts([judge("openrouter", "a", 70, 40)]);
    expect(e.winner).toBe("a");
    expect(e.isTie).toBe(false);
    expect(e.confidence).toBeGreaterThan(0.5);
    expect(e.scoreGapEstimate.lo).toBeLessThanOrEqual(e.scoreGapEstimate.hi);
  });

  it("agreeing judges raise confidence; the majority winner holds", () => {
    const e = ensembleVerdicts([judge("openrouter", "a", 60, 40), judge("anthropic", "a", 58, 42)]);
    expect(e.winner).toBe("a");
    expect(e.judgeSplit.a).toBe(1);
    expect(e.confidence).toBeGreaterThan(0.6);
  });

  it("split judges collapse to a tie rather than a false winner", () => {
    const e = ensembleVerdicts([judge("openrouter", "a", 60, 40), judge("anthropic", "b", 40, 60)]);
    expect(e.winner).toBe("tie");
    expect(e.isTie).toBe(true);
    expect(e.tieReason).toBeDefined();
  });

  it("does not turn an insufficient graph into a zero-score vote", () => {
    const insufficient = { ...judge("openrouter", "tie", 0, 0), scoreStatus: "insufficient_evidence" as const };
    const e = ensembleVerdicts([insufficient]);
    expect(e.scoreStatus).toBe("insufficient_evidence");
    expect(e.winner).toBe("tie");
    expect(e.confidence).toBe(0);
  });

  it("ignores an insufficient judge when another judge has observable evidence", () => {
    const insufficient = { ...judge("openrouter", "tie", 0, 0), scoreStatus: "insufficient_evidence" as const };
    const e = ensembleVerdicts([insufficient, judge("anthropic", "a", 72, 45)]);
    expect(e.scoreStatus).toBe("scored");
    expect(e.playerAScore).toBe(72);
    expect(e.playerBScore).toBe(45);
    expect(e.winner).toBe("a");
  });
});

describe("verdictFromEnsemble — persists uncertainty onto the stored verdict", () => {
  it("maps scores, confidence, CIs, tie flag, and per-judge detail", () => {
    const e = ensembleVerdicts([judge("openrouter", "a", 61, 39), judge("anthropic", "a", 59, 41)]);
    const v = verdictFromEnsemble(e);

    expect(v.winner).toBe("a");
    expect(v.playerAScore).toBe(60);
    expect(v.playerBScore).toBe(40);
    expect(v.confidence).toBe(e.confidence);
    expect(v.scoreGapEstimate).toEqual(e.scoreGapEstimate);
    expect(v.judgeSplit).toEqual(e.judgeSplit);
    expect(v.isTie).toBe(e.isTie);
    expect(v.tieReason).toBe(e.tieReason);
    expect(v.judges).toHaveLength(2);
    expect(v.judges!.map((j) => j.judgeId)).toEqual(["openrouter", "anthropic"]);
  });

  it("marks a too-close-to-call result with isTie + tieReason", () => {
    const v = verdictFromEnsemble(ensembleVerdicts([judge("anthropic", "a", 51, 49)]));
    expect(v.winner).toBe("tie");
    expect(v.isTie).toBe(true);
    expect(v.tieReason).toBeDefined();
  });

  it("takes the breakdown from a judge that scored, not from judges[0]", () => {
    const scoredBreakdown = { a: { claims: 4, evidence: 3, rebuttals: 2, impacts: 1, fallacies: 0, droppedSuffered: 0 }, b: { claims: 2, evidence: 1, rebuttals: 0, impacts: 0, fallacies: 1, droppedSuffered: 2 } };
    const insufficient = { ...judge("openrouter", "tie", 0, 0), scoreStatus: "insufficient_evidence" as const };
    const scored = { ...judge("anthropic", "a", 72, 45), breakdown: scoredBreakdown };
    const e = ensembleVerdicts([insufficient, scored]);
    const v = verdictFromEnsemble(e);
    expect(v.breakdown).toEqual(scoredBreakdown);
  });
});

describe("verdictFromEnsemble — shadow record is telemetry, never authority", () => {
  it("carries shadowRouting through while winner/scores stay ensemble-owned", async () => {
    const { buildShadowRecord } = await import("./routeShadowValidation");
    const { emptyArgumentRoleCounts, ARGUMENT_TAXONOMY_VERSION } = await import("./argumentTaxonomy");
    const e = ensembleVerdicts([judge("openrouter", "a", 61, 39), judge("anthropic", "a", 59, 41)]);
    const roleCounts = emptyArgumentRoleCounts();
    roleCounts.claim = 1;
    roleCounts.question = 1;
    const shadow = buildShadowRecord({
      routing: {
        route: "deterministic",
        specializedPath: "deterministic",
        taxonomyVersion: ARGUMENT_TAXONOMY_VERSION,
        classifierSource: "fallback",
        argumentCount: 2,
        batchCount: 1,
        roleCounts,
        roleCountsByOwner: { a: roleCounts, b: emptyArgumentRoleCounts(), ai: emptyArgumentRoleCounts() },
        highConfidenceCount: 1,
        ambiguousCount: 0,
        unknownCount: 1,
        fallbackCount: 1,
        mixedRoleCount: 0,
        expensiveJudgeCallsAvoided: 0,
        reason: "test",
      },
      ensemble: { winner: "a", playerAScore: 60, playerBScore: 40, scoreGap: 20, scoreStatus: "scored" },
      shadow: { winner: "b", playerAScore: 40, playerBScore: 60, scoreGap: 20, scoreStatus: "scored" },
    });
    const v = verdictFromEnsemble({ ...e, shadowRouting: shadow });
    // Shadow disagrees with the ensemble here — the stored winner must still
    // be the ensemble's. Shadow can never alter the production winner.
    expect(v.shadowRouting).toEqual(shadow);
    expect(v.shadowRouting!.winnerAgreement).toBe(false);
    expect(v.winner).toBe("a");
    expect(v.playerAScore).toBe(60);
    expect(v.playerBScore).toBe(40);
  });

  it("stores null shadow when no shadow route ran", () => {
    const v = verdictFromEnsemble(ensembleVerdicts([judge("openrouter", "a", 61, 39)]));
    expect(v.shadowRouting).toBeNull();
    expect(v.winner).toBe("a");
  });

  it("an adopted lifecycle state never promotes the shadow route to authority", async () => {
    const { buildShadowRecord, monitorAdoptedRoute } = await import("./routeShadowValidation");
    const { emptyArgumentRoleCounts, ARGUMENT_TAXONOMY_VERSION } = await import("./argumentTaxonomy");
    const e = ensembleVerdicts([judge("openrouter", "a", 61, 39), judge("anthropic", "a", 59, 41)]);
    const roleCounts = emptyArgumentRoleCounts();
    roleCounts.claim = 1;
    roleCounts.question = 1;
    const shadow = buildShadowRecord({
      routing: {
        route: "deterministic",
        specializedPath: "deterministic",
        taxonomyVersion: ARGUMENT_TAXONOMY_VERSION,
        classifierSource: "fallback",
        argumentCount: 2,
        batchCount: 1,
        roleCounts,
        roleCountsByOwner: { a: roleCounts, b: emptyArgumentRoleCounts(), ai: emptyArgumentRoleCounts() },
        highConfidenceCount: 1,
        ambiguousCount: 0,
        unknownCount: 1,
        fallbackCount: 1,
        mixedRoleCount: 0,
        expensiveJudgeCallsAvoided: 0,
        reason: "test",
      },
      ensemble: { winner: "a", playerAScore: 60, playerBScore: 40, scoreGap: 20, scoreStatus: "scored" },
      shadow: { winner: "b", playerAScore: 40, playerBScore: 60, scoreGap: 20, scoreStatus: "scored" },
    });
    // The registry considers this route adopted (gate passing, deliberate act
    // recorded) — production serving must not care: the lifecycle table is
    // display/audit truth, never judging authority.
    const effective = monitorAdoptedRoute({
      route: "deterministic",
      state: "adopted",
      n: 250,
      metrics: {
        winnerAgreement: 0.96, tieDisagreement: 0, scoreMae: 1.5, scoreGapMae: 3,
        insufficientEvidenceRate: 0.01, falseDecisiveRate: 0.01, sideSwapStability: 0.96,
      },
      passed: true,
      failures: [],
    });
    expect(effective).toBe("adopted");
    const v = verdictFromEnsemble({ ...e, shadowRouting: shadow });
    expect(v.winner).toBe("a");
    expect(v.playerAScore).toBe(60);
    expect(v.playerBScore).toBe(40);
  });
});

