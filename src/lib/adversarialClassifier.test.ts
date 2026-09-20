// Adversarial classifier cases.
//
// The structural classifier is a heuristic over messy human text, so the
// dangerous scenario is not "it is sometimes wrong" — it is "it is confidently
// wrong and that decides a winner". These tests cover the specific failure
// modes called out for this pass and assert the safety property that matters:
// while every judge-avoidance route is in `shadow`, a classifier mistake can
// never produce a decisive production winner, because the established ensemble
// remains authoritative.

import { describe, it, expect } from "vitest";

import { parseDebateTranscript, routeClassifiedArguments } from "./argumentRouting";
import { buildDeterministicArgumentGraph } from "./argumentEvaluation";
import {
  DEFAULT_ROUTE_LIFECYCLE,
  JUDGE_AVOIDANCE_ROUTES,
  buildShadowRecord,
  evaluateRouteGate,
} from "./routeShadowValidation";
import { ARGUMENT_TAXONOMY_VERSION } from "./argumentTaxonomy";
import type { ArgumentRole, ArgumentClassification, SubmittedArgument } from "./argumentTaxonomy";

// The classified role vocabulary. Note `impact` is NOT here: impacts are
// derived from reasoning/qualification text, never a classified role.
const ROLES: ArgumentRole[] = [
  "claim", "rebuttal", "evidence", "reasoning", "counterexample",
  "concession", "qualification", "question", "off-topic", "other",
];

function classification(
  index: number,
  text: string,
  labels: ArgumentRole[],
  over: Partial<ArgumentClassification> = {},
): ArgumentClassification {
  return {
    index,
    text,
    labels,
    scores: {},
    primaryRole: labels[0] ?? "other",
    // "high confidence but wrong" is the interesting adversarial case.
    confidence: 0.99,
    status: "high_confidence",
    source: "classifier.dev",
    ...over,
  };
}

function submitted(id: string, owner: "a" | "b" | "ai", round: number, text: string): SubmittedArgument {
  return { id, owner, round, text };
}

const substantive = "The policy should change because the evidence shows measurable harm to residents.";

describe("misclassified rhetorical roles", () => {
  it("a question mislabelled as a claim still produces no answerable claim to attack", () => {
    const args = [submitted("a1", "a", 1, "Should the council adopt this policy?")];
    const plan = routeClassifiedArguments(args, [classification(0, args[0].text, ["question"])]);
    expect(plan.roleCounts.claim).toBe(0);
    // A question is not an opportunity, so nothing downstream can rebut it.
    const graph = buildDeterministicArgumentGraph(
      args.map((a) => ({ ...a, classification: classification(0, a.text, ["question"]) })),
    );
    expect(graph.nodes.filter((n) => n.kind === "claim")).toHaveLength(0);
  });

  it("a claim mislabelled as a question yields no opportunity and cannot score a rebuttal", () => {
    const args = [
      submitted("a1", "a", 1, substantive),
      submitted("b1", "b", 2, "That is mistaken because the opposite holds in practice."),
    ];
    const classifications = [
      classification(0, args[0].text, ["question"]),
      classification(1, args[1].text, ["rebuttal"]),
    ];
    const graph = buildDeterministicArgumentGraph(
      args.map((a, i) => ({ ...a, classification: classifications[i] })),
    );
    // No claim node exists for side A, so the rebuttal has nothing canonical
    // to target: the mistake loses the rebuttal credit rather than inventing it.
    expect(graph.nodes.filter((n) => n.owner === "a" && n.kind === "claim")).toHaveLength(0);
    expect(graph.nodes.filter((n) => n.kind === "rebuttal").every((n) => (n.targets ?? []).length === 0)).toBe(true);
  });
});

describe("fake evidence", () => {
  it("a fabricated citation labelled evidence is dropped by URL validation", () => {
    const args = [
      submitted("a1", "a", 1, "Cited: javascript:alert('x')"),
      submitted("a2", "a", 1, "Cited: not-a-url-at-all"),
      submitted("a3", "a", 1, "Cited: https://localhost/internal"),
      submitted("a4", "a", 1, "Cited: https://127.0.0.1/admin"),
      submitted("a5", "a", 1, "Cited: https://10.0.0.5/report"),
      submitted("a6", "a", 1, "Cited: https://192.168.1.4/report"),
      submitted("a7", "a", 1, "Cited: https://intranet/report"),
    ];
    const graph = buildDeterministicArgumentGraph(
      args.map((a) => ({ ...a, classification: classification(0, a.text, ["claim", "evidence"]) })),
    );
    for (const node of graph.nodes.filter((n) => n.kind === "evidence")) {
      // None of these may borrow the authority of a real source.
      expect(node.citations ?? []).toHaveLength(0);
    }
  });

  it("a genuine public citation is still accepted", () => {
    const args = [submitted("a1", "a", 1, "Cited: https://www.nrel.gov/research/report")];
    const graph = buildDeterministicArgumentGraph(
      args.map((a) => ({ ...a, classification: classification(0, a.text, ["claim", "evidence"]) })),
    );
    const evidence = graph.nodes.find((n) => n.kind === "evidence")!;
    expect(evidence.citations).toHaveLength(1);
    expect(evidence.citations![0].homepage).toBe("https://www.nrel.gov/research/report");
  });

  it("evidence-shaped text with no citation cannot become an evidence node's support", () => {
    const args = [submitted("a1", "a", 1, "Studies show this is true, trust me.")];
    const graph = buildDeterministicArgumentGraph(
      args.map((a) => ({ ...a, classification: classification(0, a.text, ["claim", "evidence"]) })),
    );
    const evidence = graph.nodes.find((n) => n.kind === "evidence")!;
    expect(evidence.citations ?? []).toHaveLength(0);
    // It also must not manufacture a support edge to the opponent.
    for (const edge of graph.edges.filter((e) => e.relation === "supports")) {
      const from = graph.nodes.find((n) => n.id === edge.from)!;
      const to = graph.nodes.find((n) => n.id === edge.to)!;
      expect(from.owner).toBe(to.owner);
    }
  });
});

describe("mixed and stacked roles", () => {
  it("rebuttal + evidence on one argument keeps both roles without duplicating the position", () => {
    const args = [
      submitted("a1", "a", 1, substantive),
      submitted("b1", "b", 2, "That fails because cited data shows otherwise: https://example.org/x"),
    ];
    const classifications = [
      classification(0, args[0].text, ["claim"]),
      classification(1, args[1].text, ["rebuttal", "evidence"]),
    ];
    const graph = buildDeterministicArgumentGraph(
      args.map((a, i) => ({ ...a, classification: classifications[i] })),
    );
    // Both stacked roles are represented exactly once for that argument.
    expect(graph.nodes.filter((n) => n.id.startsWith("b1") && n.kind === "rebuttal")).toHaveLength(1);
    expect(graph.nodes.filter((n) => n.id.startsWith("b1") && n.kind === "evidence")).toHaveLength(1);
    // No role is duplicated, and the rebuttal still targets only the opponent.
    const ids = graph.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    const rebuttal = graph.nodes.find((n) => n.id.startsWith("b1") && n.kind === "rebuttal")!;
    for (const targetId of (rebuttal.targets ?? [])) {
      expect(graph.nodes.find((n) => n.id === targetId)!.owner).toBe("a");
    }
  });

  it("counterclaim + concession on one argument still targets only the opponent", () => {
    const args = [
      submitted("a1", "a", 1, substantive),
      submitted("b1", "b", 2, "I accept the cost point, but the benefit still outweighs it."),
    ];
    const classifications = [
      classification(0, args[0].text, ["claim"]),
      classification(1, args[1].text, ["counterexample", "concession"]),
    ];
    const graph = buildDeterministicArgumentGraph(
      args.map((a, i) => ({ ...a, classification: classifications[i] })),
    );
    for (const c of graph.concessions) {
      const node = graph.nodes.find((n) => n.id === c.nodeId)!;
      expect(node.owner).not.toBe(c.by);
    }
  });
});

describe("degenerate input", () => {
  it("short non-substantive text produces no scoreable graph", () => {
    const args = [submitted("a1", "a", 1, "ok")];
    const graph = buildDeterministicArgumentGraph(
      args.map((a) => ({ ...a, classification: classification(0, a.text, ["other"]) })),
    );
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });

  it("a structurally richer side does not by itself create a rebuttal target", () => {
    // Side B has four labelled arguments; side A has one. Richness must not
    // fabricate an opportunity for B to answer.
    const args = [
      submitted("a1", "a", 1, substantive),
      submitted("b1", "b", 2, "One reason to reject this is the fiscal cost involved."),
      submitted("b2", "b", 2, "Another reason is the administrative burden it creates."),
      submitted("b3", "b", 2, "A third is the unequal impact on smaller districts."),
      submitted("b4", "b", 2, "A fourth is that the timeline is unrealistic in practice."),
    ];
    const classifications = args.map((a, i) =>
      classification(i, a.text, i === 0 ? ["claim"] : ["rebuttal"]),
    );
    const graph = buildDeterministicArgumentGraph(
      args.map((a, i) => ({ ...a, classification: classifications[i] })),
    );
    for (const node of graph.nodes.filter((n) => n.kind === "rebuttal")) {
      for (const targetId of (node.targets ?? [])) {
        const target = graph.nodes.find((n) => n.id === targetId)!;
        expect(target.owner).toBe("a");
        expect(target.round).toBeLessThan(node.round);
      }
    }
  });

  it("an empty transcript routes to no arguments and no graph", () => {
    expect(parseDebateTranscript("")).toEqual([]);
    expect(buildDeterministicArgumentGraph([]).nodes).toEqual([]);
  });
});

describe("classifier transport and result failures", () => {
  it("a timeout degrades to fallback classification, never a judge-avoidance route", () => {
    const args = [submitted("a1", "a", 1, substantive)];
    const plan = routeClassifiedArguments(
      args,
      [classification(0, args[0].text, ["claim"], { confidence: 0, status: "fallback", source: "fallback", errorCode: "timeout" })],
    );
    // Fallback classifications must never take a judge-avoidance path.
    expect(plan.route).toBe("ensemble");
  });

  it("a malformed classifier result degrades to fallback classification", () => {
    const args = [submitted("a1", "a", 1, substantive)];
    const plan = routeClassifiedArguments(
      args,
      [classification(0, args[0].text, ["other"], { confidence: 0, status: "unknown", source: "fallback", errorCode: "malformed_response" })],
    );
    expect(plan.route).toBe("ensemble");
  });

  it("a classifier that returns fewer classifications than arguments falls back", () => {
    const args = [
      submitted("a1", "a", 1, substantive),
      submitted("b1", "b", 2, "That is mistaken for several practical reasons."),
    ];
    const plan = routeClassifiedArguments(args, [classification(0, args[0].text, ["claim"])]);
    expect(plan.route).toBe("ensemble");
  });

  it("an unsupported role keeps the established ensemble available", () => {
    const args = [submitted("a1", "a", 1, substantive)];
    const plan = routeClassifiedArguments(
      args,
      [classification(0, args[0].text, ["other"], { status: "ambiguous" })],
    );
    expect(plan.route).toBe("ensemble");
  });
});

/**
 * The safety property: a confidently wrong classifier may still produce a
 * shadow result, but that result cannot be promoted or served while every
 * route is in `shadow`.
 */
describe("shadow-only containment of adversarial mistakes", () => {
  it("every judge-avoidance route remains shadow, so no mistake can decide a winner", () => {
    for (const route of JUDGE_AVOIDANCE_ROUTES) {
      expect(DEFAULT_ROUTE_LIFECYCLE[route]).toBe("shadow");
    }
  });

  it("a high-confidence but wrong shadow winner is recorded as disagreement, not adopted", () => {
    const args = [
      submitted("a1", "a", 1, substantive),
      submitted("b1", "b", 2, "The opposite is true for reasons of simple arithmetic."),
    ];
    const plan = routeClassifiedArguments(args, [
      classification(0, args[0].text, ["claim"]),
      classification(1, args[1].text, ["rebuttal"]),
    ]);
    const record = buildShadowRecord({
      routing: {
        taxonomyVersion: ARGUMENT_TAXONOMY_VERSION,
        route: plan.route,
        specializedPath: plan.specializedPath,
        classifierSource: plan.classifierSource,
        argumentCount: plan.arguments.length,
        batchCount: plan.batchCount,
        roleCounts: plan.roleCounts,
        roleCountsByOwner: plan.roleCountsByOwner,
        highConfidenceCount: plan.arguments.length,
        ambiguousCount: 0,
        unknownCount: 0,
        fallbackCount: 0,
        mixedRoleCount: 0,
        expensiveJudgeCallsAvoided: 0,
        reason: plan.reason,
      },
      ensemble: { winner: "a", playerAScore: 72, playerBScore: 45, scoreGap: 27, scoreStatus: "scored" },
      // The classifier is confident and the shadow route says B won.
      shadow: { winner: "b", playerAScore: 30, playerBScore: 80, scoreGap: 50, scoreStatus: "scored" },
    });
    expect(record.winnerAgreement).toBe(false);
    // Recorded as evidence for validation, and it fails the gate.
    const verdict = evaluateRouteGate({
      route: "deterministic",
      records: Array.from({ length: 200 }, () => record),
      sideSwapStability: 0.99,
      humanAgreement: 0.9,
    });
    expect(verdict.passed).toBe(false);
    expect(verdict.state).toBe("shadow");
  });

  it("a side-swapped transcript cannot produce a decisive shadow winner that passes", () => {
    const args = [
      submitted("a1", "a", 1, substantive),
      submitted("b1", "b", 2, "The reverse holds because of the long-run cost involved."),
    ];
    const plan = routeClassifiedArguments(args, [
      classification(0, args[0].text, ["claim"]),
      classification(1, args[1].text, ["rebuttal"]),
    ]);
    const routingSummary = {
      taxonomyVersion: ARGUMENT_TAXONOMY_VERSION,
      route: plan.route,
      specializedPath: plan.specializedPath,
      classifierSource: plan.classifierSource,
      argumentCount: plan.arguments.length,
      batchCount: plan.batchCount,
      roleCounts: plan.roleCounts,
      roleCountsByOwner: plan.roleCountsByOwner,
      highConfidenceCount: plan.arguments.length,
      ambiguousCount: 0,
      unknownCount: 0,
      fallbackCount: 0,
      mixedRoleCount: 0,
      expensiveJudgeCallsAvoided: 0,
      reason: plan.reason,
    };
    // Under a side swap the shadow route flips its winner, which shows up as
    // poor side-swap stability and fails the gate.
    const swapped = buildShadowRecord({
      routing: routingSummary,
      ensemble: { winner: "b", playerAScore: 45, playerBScore: 72, scoreGap: 27, scoreStatus: "scored" },
      shadow: { winner: "a", playerAScore: 80, playerBScore: 30, scoreGap: 50, scoreStatus: "scored" },
    });
    expect(swapped.winnerAgreement).toBe(false);
    const verdict = evaluateRouteGate({
      route: "deterministic",
      records: Array.from({ length: 200 }, () => swapped),
      sideSwapStability: 0.4,
      humanAgreement: 0.9,
    });
    expect(verdict.passed).toBe(false);
    expect(verdict.failures.some((f) => f.includes("side-swap stability"))).toBe(true);
  });
});

describe("role vocabulary sanity", () => {
  it("the adversarial role list stays within the taxonomy vocabulary", () => {
    expect(ROLES).toContain("question");
    expect(ROLES).toContain("counterexample");
    expect(ROLES).toContain("concession");
  });
});
