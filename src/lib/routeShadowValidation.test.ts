import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  DEFAULT_ROUTE_LIFECYCLE,
  JUDGE_AVOIDANCE_ROUTES,
  PREREGISTERED_ROUTE_GATES,
  ROUTE_GATE_VERSION,
  bucketTranscriptChars,
  buildShadowRecord,
  classifyShadowAttemptStatus,
  confidenceBand,
  evaluateRouteGate,
  hashRouteGate,
  mixedRoleBucket,
  monitorAdoptedRoute,
  roundCountBucket,
  routeGateRegistration,
  scoreGapBand,
  segmentByRoute,
  segmentKeyFns,
  segmentShadowRecords,
  type RouteShadowRecord,
} from "./routeShadowValidation";
import type { ArgumentRoutingSummary } from "./argumentTaxonomy";
import { emptyArgumentRoleCounts } from "./argumentTaxonomy";

function routing(over: Partial<ArgumentRoutingSummary> = {}): ArgumentRoutingSummary {
  return {
    taxonomyVersion: "argument-roles-v1",
    route: "deterministic",
    specializedPath: "deterministic",
    classifierSource: "classifier.dev",
    argumentCount: 10,
    batchCount: 1,
    roleCounts: { ...emptyArgumentRoleCounts(), claim: 6, rebuttal: 4 },
    roleCountsByOwner: { a: emptyArgumentRoleCounts(), b: emptyArgumentRoleCounts(), ai: emptyArgumentRoleCounts() },
    highConfidenceCount: 9,
    ambiguousCount: 1,
    unknownCount: 0,
    fallbackCount: 0,
    mixedRoleCount: 1,
    expensiveJudgeCallsAvoided: 0,
    reason: "structural route",
    ...over,
  };
}

const side = (winner: "a" | "b" | "tie", a: number, b: number, scoreStatus = "scored") => ({
  winner,
  playerAScore: a,
  playerBScore: b,
  scoreGap: Math.abs(a - b),
  scoreStatus,
});

function record(over: Partial<Parameters<typeof buildShadowRecord>[0]> = {}): RouteShadowRecord {
  return buildShadowRecord({
    routing: routing(),
    ensemble: side("a", 70, 40),
    shadow: side("a", 68, 42),
    ...over,
  });
}

describe("route lifecycle defaults", () => {
  it("every route starts in shadow — nothing is adopted on arrival", () => {
    for (const route of JUDGE_AVOIDANCE_ROUTES) {
      expect(DEFAULT_ROUTE_LIFECYCLE[route]).toBe("shadow");
    }
  });

  it("only judge-avoidance routes are gated for adoption", () => {
    expect(JUDGE_AVOIDANCE_ROUTES).not.toContain("response-generation");
    expect(Object.keys(PREREGISTERED_ROUTE_GATES)).toContain("response-generation");
  });
});

describe("preregistered gates are immutable", () => {
  it("the gate set is frozen so thresholds cannot be tuned after seeing results", () => {
    expect(Object.isFrozen(PREREGISTERED_ROUTE_GATES)).toBe(true);
    for (const route of JUDGE_AVOIDANCE_ROUTES) {
      expect(Object.isFrozen(PREREGISTERED_ROUTE_GATES[route])).toBe(true);
    }
  });

  it("hashes are stable and tamper-evident", () => {
    const gate = PREREGISTERED_ROUTE_GATES.deterministic;
    expect(hashRouteGate("deterministic", gate)).toBe(hashRouteGate("deterministic", gate));
    // A changed threshold must change the hash.
    expect(hashRouteGate("deterministic", { ...gate, minN: gate.minN + 1 })).not.toBe(
      hashRouteGate("deterministic", gate),
    );
  });

  it("the registration exposes a SHA-256 hash for every gate", () => {
    const reg = routeGateRegistration();
    expect(reg.version).toBe(ROUTE_GATE_VERSION);
    for (const route of Object.keys(PREREGISTERED_ROUTE_GATES)) {
      expect(reg.gates[route].hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("human agreement on too few items keeps the route in shadow", () => {
    const records = Array.from({ length: 200 }, () => record());
    const verdict = evaluateRouteGate({
      route: "deterministic", records, sideSwapStability: 0.99, humanAgreement: 0.95, humanItems: 12,
    });
    expect(verdict.passed).toBe(false);
    expect(verdict.state).toBe("shadow");
    expect(verdict.failures.some((f) => f.includes("human-grounded items"))).toBe(true);
  });

  it("judge-avoidance gates require substantial evidence", () => {
    for (const route of JUDGE_AVOIDANCE_ROUTES) {
      const gate = PREREGISTERED_ROUTE_GATES[route];
      expect(gate.minN).toBeGreaterThanOrEqual(200);
      expect(gate.minWinnerAgreement).toBeGreaterThanOrEqual(0.9);
      expect(gate.minHumanAgreement).not.toBeNull();
    }
  });
});

describe("gate evaluation", () => {
  it("refuses to judge a route below the minimum sample", () => {
    const verdict = evaluateRouteGate({ route: "deterministic", records: [record(), record()] });
    expect(verdict.passed).toBe(false);
    expect(verdict.state).toBe("shadow");
    expect(verdict.failures.some((f) => f.includes("insufficient shadow debates"))).toBe(true);
  });

  it("a route that agrees with the ensemble becomes eligible, never adopted", () => {
    const records = Array.from({ length: 200 }, () => record());
    const verdict = evaluateRouteGate({
      route: "deterministic", records, sideSwapStability: 0.99, humanAgreement: 0.8, humanItems: 200,
    });
    expect(verdict.passed).toBe(true);
    expect(verdict.state).toBe("eligible");
    expect(verdict.metrics.winnerAgreement).toBe(1);
  });

  it("a route that disagrees with the ensemble never becomes eligible", () => {
    const records = Array.from({ length: 200 }, () =>
      record({ shadow: side("b", 40, 70) }),
    );
    const verdict = evaluateRouteGate({
      route: "deterministic", records, sideSwapStability: 0.99, humanAgreement: 0.8, humanItems: 200,
    });
    expect(verdict.passed).toBe(false);
    expect(verdict.state).toBe("shadow");
    expect(verdict.metrics.winnerAgreement).toBe(0);
  });

  it("unmeasured side-swap stability fails rather than passing by default", () => {
    const records = Array.from({ length: 200 }, () => record());
    const verdict = evaluateRouteGate({ route: "deterministic", records, humanAgreement: 0.9 });
    expect(verdict.passed).toBe(false);
    expect(verdict.failures.some((f) => f.includes("side-swap stability not measured"))).toBe(true);
  });

  it("human-grounded agreement is required once the gate declares it", () => {
    const records = Array.from({ length: 200 }, () => record());
    const verdict = evaluateRouteGate({ route: "deterministic", records, sideSwapStability: 0.99 });
    expect(verdict.passed).toBe(false);
    expect(verdict.failures.some((f) => f.includes("human-grounded agreement not measured"))).toBe(true);
  });

  it("a shadow path that calls decisive where the ensemble ties is refused", () => {
    const records = Array.from({ length: 200 }, () =>
      record({ ensemble: side("tie", 50, 52), shadow: side("a", 70, 30) }),
    );
    const verdict = evaluateRouteGate({
      route: "deterministic", records, sideSwapStability: 0.99, humanAgreement: 0.9, humanItems: 200,
    });
    expect(verdict.passed).toBe(false);
    expect(verdict.metrics.falseDecisiveRate).toBe(1);
  });

  it("insufficient-evidence disagreement is counted and capped", () => {
    const records = Array.from({ length: 200 }, (_, i) =>
      i < 40 ? record({ shadow: null }) : record(),
    );
    const verdict = evaluateRouteGate({
      route: "deterministic", records, sideSwapStability: 0.99, humanAgreement: 0.9, humanItems: 200,
    });
    expect(verdict.metrics.insufficientEvidenceRate).toBeCloseTo(0.2);
    expect(verdict.passed).toBe(false);
  });
});

describe("adopted-route monitoring", () => {
  it("an adopted route that later violates its gate returns to the ensemble", () => {
    const bad = evaluateRouteGate({
      route: "deterministic",
      records: Array.from({ length: 200 }, () => record({ shadow: side("b", 40, 70) })),
      sideSwapStability: 0.99, humanAgreement: 0.9, humanItems: 200,
    });
    expect(monitorAdoptedRoute({ ...bad, state: "adopted" })).toBe("suspended");
  });

  it("an adopted route that still passes stays adopted", () => {
    const good = evaluateRouteGate({
      route: "deterministic",
      records: Array.from({ length: 200 }, () => record()),
      sideSwapStability: 0.99, humanAgreement: 0.9, humanItems: 200,
    });
    expect(monitorAdoptedRoute({ ...good, state: "adopted" })).toBe("adopted");
  });
});

describe("shadow records", () => {
  it("captures agreement, scores and score-gap difference without any transcript text", () => {
    const r = record();
    expect(r.winnerAgreement).toBe(true);
    expect(r.ensembleScores).toEqual({ a: 70, b: 40, gap: 30 });
    expect(r.shadowScores).toEqual({ a: 68, b: 42, gap: 26 });
    expect(r.scoreGapDifference).toBe(4);
    expect(r.absoluteScoreDifference).toBe(2);
    expect(JSON.stringify(r)).not.toMatch(/transcript|prompt|argument text/i);
  });

  it("marks a null shadow result as insufficient evidence, not agreement", () => {
    const r = record({ shadow: null });
    expect(r.insufficientEvidence).toBe(true);
    expect(r.winnerAgreement).toBe(false);
    expect(r.shadowScoreStatus).toBe("insufficient");
  });

  it("keeps classifier confidence separate from score confidence", () => {
    const r = record({ routing: routing({ highConfidenceCount: 2, argumentCount: 10 }) });
    expect(r.confidence.highConfidenceShare).toBeCloseTo(0.2);
    // Classification confidence says nothing about the score status fields.
    expect(r.ensembleScoreStatus).toBe("scored");
    expect(r).not.toHaveProperty("scoreConfidence");
  });
});

describe("dashboards and bands", () => {
  it("segments by route and reports per-route agreement", () => {
    const records = [
      record(),
      record({ routing: routing({ route: "lightweight", specializedPath: "lightweight" }) }),
      record({ routing: routing({ route: "lightweight", specializedPath: "lightweight" }), shadow: side("b", 40, 70) }),
    ];
    const segments = segmentByRoute(records);
    const byRoute = Object.fromEntries(segments.map((s) => [s.route, s]));
    expect(byRoute.deterministic.n).toBe(1);
    expect(byRoute.lightweight.n).toBe(2);
    expect(byRoute.lightweight.winnerAgreement).toBe(0.5);
  });

  it("confidence and score-gap bands stay distinct and ordered", () => {
    expect(confidenceBand(0.2)).toBe("low");
    expect(confidenceBand(0.7)).toBe("medium");
    expect(confidenceBand(0.95)).toBe("high");
    expect(scoreGapBand(1)).toBe("tie");
    expect(scoreGapBand(10)).toBe("narrow");
    expect(scoreGapBand(20)).toBe("clear");
    expect(scoreGapBand(40)).toBe("decisive");
  });
});

describe("shadow attempt states (item 16)", () => {
  it("classifies scored, insufficient, ineligible and classifier-failed attempts", () => {
    const plan = { route: "deterministic" as const, argumentCount: 4, fallbackCount: 0 };
    expect(classifyShadowAttemptStatus(plan, true)).toBe("scored");
    expect(classifyShadowAttemptStatus(plan, false)).toBe("insufficient-evidence");
    expect(classifyShadowAttemptStatus({ ...plan, fallbackCount: 4 }, false)).toBe("classifier-failure");
    // A partially-fallback plan that still fails to score is insufficient
    // evidence, not a classifier failure.
    expect(classifyShadowAttemptStatus({ ...plan, fallbackCount: 2 }, false)).toBe("insufficient-evidence");
    expect(classifyShadowAttemptStatus({ route: "ensemble" as const, argumentCount: 4, fallbackCount: 0 }, true)).toBe(
      "routing-not-eligible",
    );
  });

  it("failed scoring still creates a validation record that counts toward N", () => {
    const failed = record({ shadow: null, status: "insufficient-evidence" });
    expect(failed.insufficientEvidence).toBe(true);
    expect(failed.shadowAttemptStatus).toBe("insufficient-evidence");
    const failedClassifier = record({ shadow: null, status: "classifier-failure" });
    expect(failedClassifier.shadowAttemptStatus).toBe("classifier-failure");
    const records = [...Array.from({ length: 198 }, () => record()), failed, failedClassifier];
    const verdict = evaluateRouteGate({
      route: "deterministic", records, sideSwapStability: 0.99, humanAgreement: 0.9, humanItems: 200,
    });
    // N counts every eligible attempt, including the two failures.
    expect(verdict.n).toBe(200);
    expect(verdict.metrics.insufficientEvidenceRate).toBeCloseTo(0.01);
  });

  it("routing-not-eligible rows never enter the adoption denominator", () => {
    const ineligible = record({ status: "routing-not-eligible" });
    const verdict = evaluateRouteGate({
      route: "deterministic",
      records: [...Array.from({ length: 200 }, () => record()), ineligible],
      sideSwapStability: 0.99, humanAgreement: 0.9, humanItems: 200,
    });
    expect(verdict.n).toBe(200);
    expect(verdict.passed).toBe(true);
  });
});

describe("tie disagreement (item 17)", () => {
  const tie = (w: "a" | "b" | "tie") => (w === "tie" ? side("tie", 50, 52) : side(w, 70, 40));
  function gateOf(pairs: Array<["a" | "b" | "tie", "a" | "b" | "tie"]>) {
    const records = pairs.map(([ensembleWinner, shadowWinner]) =>
      record({ ensemble: tie(ensembleWinner), shadow: tie(shadowWinner) }),
    );
    return evaluateRouteGate({
      route: "deterministic", records, sideSwapStability: 0.99, humanAgreement: 0.9, humanItems: 200,
    });
  }

  it("tie/tie is agreement, single-sided ties disagree, A/B is not tie disagreement", () => {
    expect(gateOf([["tie", "tie"]]).metrics.tieDisagreement).toBe(0);
    expect(gateOf([["tie", "a"]]).metrics.tieDisagreement).toBe(1);
    expect(gateOf([["a", "tie"]]).metrics.tieDisagreement).toBe(1);
    expect(gateOf([["a", "a"]]).metrics.tieDisagreement).toBe(0);
    expect(gateOf([["a", "b"]]).metrics.tieDisagreement).toBe(0);
  });

  it("segment roll-ups use the same strict definition", () => {
    const records = [
      record({ ensemble: tie("tie"), shadow: tie("tie") }),
      record({ ensemble: tie("a"), shadow: tie("tie") }),
    ];
    const [segment] = segmentByRoute(records).filter((s) => s.route === "deterministic");
    expect(segment.tieDisagreement).toBe(0.5);
    expect(segment.scoredCount).toBe(2);
    expect(segment.insufficientCount).toBe(0);
    expect(segment.scoreMae).not.toBeNull();
  });
});

describe("bounded segmentation metadata (item 19)", () => {
  it("buckets stay bounded and carry no raw text", () => {
    expect(bucketTranscriptChars(500)).toBe("<1k");
    expect(bucketTranscriptChars(2000)).toBe("1k-4k");
    expect(bucketTranscriptChars(9000)).toBe("4k-16k");
    expect(bucketTranscriptChars(20000)).toBe(">=16k");
    expect(mixedRoleBucket(null)).toBe("unknown");
    expect(mixedRoleBucket(0)).toBe("0");
    expect(mixedRoleBucket(2)).toBe("1-2");
    expect(mixedRoleBucket(9)).toBe(">2");
    expect(roundCountBucket(null)).toBe("unknown");
    expect(roundCountBucket(5)).toBe("3-5");
    const r = record({ sizeBucket: "1k-4k", roundCount: 4 });
    expect(r.sizeBucket).toBe("1k-4k");
    expect(r.roundCount).toBe(4);
    expect(JSON.stringify(r)).not.toMatch(/transcript|prompt|argument text/i);
  });

  it("segments pool eligible records with denominators attached", () => {
    const records = [record(), record({ sizeBucket: ">=16k", roundCount: 8 })];
    const slices = segmentShadowRecords(records, segmentKeyFns().size, "size");
    expect(slices).toHaveLength(2);
    for (const slice of slices) {
      expect(slice.n).toBe(1);
      expect(slice.winnerAgreement).toBe(1);
    }
  });
});

/**
 * The safety property that matters most: while routes are shadow-only, a
 * classifier mistake must not be able to produce a decisive production winner.
 */
describe("shadow-only guarantee (static)", () => {
  const source = readFileSync(
    path.resolve(__dirname, "ensembleJudge.ts"),
    "utf8",
  );

  it("the live judge path never returns the deterministic route as authoritative", () => {
    // The removed shortcut looked like: `const routed = ...; if (routed) return routed;`
    expect(source).not.toMatch(/if\s*\(\s*routed\s*\)\s*\{\s*recordRoutingTelemetry/);
    expect(source).not.toMatch(/return\s+routed\s*;/);
  });

  it("the deterministic route is computed only as shadow evidence", () => {
    const calls = source.match(/deterministicRoutedResult\(/g) ?? [];
    // One definition + exactly one call site (the shadow computation).
    expect(calls.length).toBe(2);
    expect(source).toMatch(/const shadow = candidateRoute \? deterministicRoutedResult\(plan, baselineJudgeLegs\) : null;/);
    // Only judge-avoidance candidate routes are attempted; ensemble and
    // response-generation routing never enter the adoption denominator.
    expect(source).toMatch(/!plan\.requiresExpensiveJudge/);
    expect(source).toMatch(/JUDGE_AVOIDANCE_ROUTES/);
  });

  it("the ensemble result is always returned, with the shadow attached", () => {
    expect(source).toMatch(/const ensemble = ensembleVerdicts\(ok\);/);
    expect(source).toMatch(/shadowRouting:/);
    expect(source).toMatch(/\.\.\.ensemble,/);
  });
});
