import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  HUMAN_GATE_MIN_ITEMS,
  JUDGE_AVOIDANCE_ROUTES,
  PREREGISTERED_ROUTE_GATES,
  ROUTE_GATE_VERSION,
} from "./routeShadowValidation";
import { plannedRouteTransition } from "./routeLifecycle";

/**
 * IMMUTABLE ROUTE PREREGISTRATION (item 20).
 *
 * Each judge-avoidance route carries a versioned registration artifact whose
 * canonical SHA-256 seal covers every threshold. These tests re-derive the
 * seal from the file bytes (minus the seal itself) and pin the artifact
 * thresholds to the in-code gates, so neither side can drift or be tuned
 * after shadow evidence exists.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROUTES = ["deterministic", "rebuttal-compare", "evidence-verification", "lightweight"] as const;

function readRegistration(route: string): Record<string, unknown> {
  const raw = readFileSync(path.join(ROOT, "docs", "route-registrations", "v1", `${route}.json`), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("route registration artifacts", () => {
  it("exist for every judge-avoidance route with the required fields", () => {
    expect(JUDGE_AVOIDANCE_ROUTES).toEqual([...ROUTES]);
    for (const route of ROUTES) {
      const reg = readRegistration(route);
      for (const field of [
        "schemaVersion", "registrationVersion", "registeredAt", "commitSha", "route",
        "thresholds", "sampleRequirements", "humanGate", "metricDefinitions", "status", "sha256",
      ]) {
        expect(reg[field], `${route}.${field}`).toBeDefined();
      }
      expect(reg.route).toBe(route);
      expect(reg.status).toBe("registered");
      expect(reg.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("carry a valid canonical SHA-256 seal (re-derived from file bytes)", () => {
    for (const route of ROUTES) {
      const reg = readRegistration(route);
      const { sha256, ...body } = reg;
      // Key order is preserved through parse/stringify, so re-serialising
      // the body reproduces the exact sealed bytes.
      const recomputed = createHash("sha256").update(JSON.stringify(body), "utf8").digest("hex");
      expect(recomputed, `${route} seal`).toBe(sha256);
    }
  });

  it("mirror the in-code preregistered gates exactly (neither side may drift)", () => {
    for (const route of ROUTES) {
      const reg = readRegistration(route);
      const thresholds = reg.thresholds as Record<string, number>;
      const gate = PREREGISTERED_ROUTE_GATES[route as keyof typeof PREREGISTERED_ROUTE_GATES];
      expect(thresholds.minN).toBe(gate.minN);
      expect(thresholds.minWinnerAgreement).toBe(gate.minWinnerAgreement);
      expect(thresholds.minSideSwapStability).toBe(gate.minSideSwapStability);
      expect(thresholds.maxFalseDecisiveRate).toBe(gate.maxFalseDecisiveRate);
      expect(thresholds.maxScoreGapMae).toBe(gate.maxScoreGapMae);
      expect(thresholds.maxInsufficientEvidenceRate).toBe(gate.maxInsufficientEvidenceRate);
      expect(thresholds.minHumanAgreement).toBe(gate.minHumanAgreement);
      const humanGate = reg.humanGate as { minAgreement: number; minItems: number };
      expect(humanGate.minAgreement).toBe(gate.minHumanAgreement);
      expect(humanGate.minItems).toBe(HUMAN_GATE_MIN_ITEMS);
    }
  });

  it("pins the preregistered thresholds to their exact adopted values — never loosen", () => {
    // The mirror test above keeps code and artifacts in sync; this test pins
    // the absolute values so neither side can be loosened in step. Any
    // threshold change — tightening included — starts a new registration
    // version; weakening one fails here first.
    expect(ROUTE_GATE_VERSION).toBe("route-adoption-gates-v1");
    expect(HUMAN_GATE_MIN_ITEMS).toBe(30);
    expect(PREREGISTERED_ROUTE_GATES.deterministic).toEqual({
      minN: 200, minWinnerAgreement: 0.95, minSideSwapStability: 0.95,
      maxFalseDecisiveRate: 0.02, maxScoreGapMae: 4, maxInsufficientEvidenceRate: 0.02,
      minHumanAgreement: 0.7,
    });
    expect(PREREGISTERED_ROUTE_GATES["rebuttal-compare"]).toEqual({
      minN: 200, minWinnerAgreement: 0.92, minSideSwapStability: 0.92,
      maxFalseDecisiveRate: 0.03, maxScoreGapMae: 6, maxInsufficientEvidenceRate: 0.03,
      minHumanAgreement: 0.65,
    });
    expect(PREREGISTERED_ROUTE_GATES["evidence-verification"]).toEqual({
      minN: 200, minWinnerAgreement: 0.92, minSideSwapStability: 0.92,
      maxFalseDecisiveRate: 0.03, maxScoreGapMae: 6, maxInsufficientEvidenceRate: 0.03,
      minHumanAgreement: 0.65,
    });
    expect(PREREGISTERED_ROUTE_GATES.lightweight).toEqual({
      minN: 300, minWinnerAgreement: 0.97, minSideSwapStability: 0.97,
      maxFalseDecisiveRate: 0.01, maxScoreGapMae: 3, maxInsufficientEvidenceRate: 0.01,
      minHumanAgreement: 0.75,
    });
  });
});

describe("deliberate lifecycle transitions (item 22)", () => {
  it("never auto-adopts on a passing gate — eligible is the evidence ceiling", () => {
    expect(plannedRouteTransition({ current: "shadow", gatePassed: true }).next).toBe("eligible");
    expect(plannedRouteTransition({ current: "shadow", gatePassed: true }).deliberate).toBe(false);
    expect(plannedRouteTransition({ current: "eligible", gatePassed: true }).next).toBe("eligible");
  });

  it("adoption requires an explicit deliberate act", () => {
    const adopted = plannedRouteTransition({ current: "eligible", gatePassed: true, adopt: true });
    expect(adopted.next).toBe("adopted");
    expect(adopted.deliberate).toBe(true);
    // No adoption without evidence, even when asked.
    expect(plannedRouteTransition({ current: "eligible", gatePassed: false, adopt: true }).next).toBe("shadow");
  });

  it("monitoring failure suspends an adopted route immediately (item 23)", () => {
    expect(plannedRouteTransition({ current: "adopted", gatePassed: false }).next).toBe("suspended");
    expect(plannedRouteTransition({ current: "adopted", gatePassed: true }).next).toBe("adopted");
    expect(plannedRouteTransition({ current: "suspended", gatePassed: true }).next).toBe("eligible");
    expect(plannedRouteTransition({ current: "suspended", gatePassed: true }).deliberate).toBe(false);
  });
});
