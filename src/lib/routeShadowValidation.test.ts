import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  DEFAULT_ROUTE_LIFECYCLE,
  JUDGE_AVOIDANCE_ROUTES,
  PREREGISTERED_ROUTE_GATES,
  ROUTE_GATE_VERSION,
  buildShadowRecord,
  confidenceBand,
  evaluateRouteGate,
  hashRouteGate,
  monitorAdoptedRoute,
  routeGateRegistration,
  scoreGapBand,
  segmentByRoute,
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

  it("the registration exposes a hash for every gate", () => {
    const reg = routeGateRegistration();
    expect(reg.version).toBe(ROUTE_GATE_VERSION);
    for (const route of Object.keys(PREREGISTERED_ROUTE_GATES)) {
      expect(reg.gates[route].hash).toMatch(/^[0-9a-f]{8}$/);
    }
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
      route: "deterministic", records, sideSwapStability: 0.99, humanAgreement: 0.8,
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
      route: "deterministic", records, sideSwapStability: 0.99, humanAgreement: 0.8,
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
      route: "deterministic", records, sideSwapStability: 0.99, humanAgreement: 0.9,
    });
    expect(verdict.passed).toBe(false);
    expect(verdict.metrics.falseDecisiveRate).toBe(1);
  });

  it("insufficient-evidence disagreement is counted and capped", () => {
    const records = Array.from({ length: 200 }, (_, i) =>
      i < 40 ? record({ shadow: null }) : record(),
    );
    const verdict = evaluateRouteGate({
      route: "deterministic", records, sideSwapStability: 0.99, humanAgreement: 0.9,
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
      sideSwapStability: 0.99, humanAgreement: 0.9,
    });
    expect(monitorAdoptedRoute({ ...bad, state: "adopted" })).toBe("suspended");
  });

  it("an adopted route that still passes stays adopted", () => {
    const good = evaluateRouteGate({
      route: "deterministic",
      records: Array.from({ length: 200 }, () => record()),
      sideSwapStability: 0.99, humanAgreement: 0.9,
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
    expect(source).toMatch(/const shadow = plan\.requiresExpensiveJudge \? null : deterministicRoutedResult\(/);
  });

  it("the ensemble result is always returned, with the shadow attached", () => {
    expect(source).toMatch(/const ensemble = ensembleVerdicts\(ok\);/);
    expect(source).toMatch(/shadowRouting:/);
    expect(source).toMatch(/\.\.\.ensemble,/);
  });
});
