// Rhetorical-role evaluation tests: dataset integrity, metric math, tier
// behaviour, and shadow-route agreement. All offline and deterministic —
// remote calls are replaced by stub fetch implementations, so no test spends
// classifier.dev quota or depends on the network.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ARGUMENT_ROLE_EVAL_DATASET } from "./debateEvaluation";
import {
  ARGUMENT_ROLE_LABELS,
  ARGUMENT_TAXONOMY_VERSION,
  type ArgumentClassification,
  type ArgumentRole,
  type SubmittedArgument,
} from "./argumentTaxonomy";
import { classifyArgumentBatch } from "./argumentRouting";
import { resetAiTelemetry } from "./aiTelemetry";
import { routeClassifiedArguments } from "./argumentRouting";
import {
  buildConfusionMatrix,
  calibrationReport,
  compareClassifierTiers,
  describeDatasetCoverage,
  evaluateMixedRoleDetection,
  evaluateRhetoricalRoles,
  measureShadowRouteAgreement,
  summariseLatencies,
  type RolePredictionMap,
} from "./rhetoricalRoleEvaluation";

const NEUTRALITY_BLOCKLIST = [
  "abortion",
  "gun control",
  "second amendment",
  "immigration",
  "deport",
  "election fraud",
  "stolen election",
  "vaccine mandate",
  "climate hoax",
  "democrat",
  "republican",
  "left-wing",
  "right-wing",
  "socialist",
  "fascist",
  "maga",
  "woke",
  "groomer",
  "trump",
  "biden",
];

describe("labelled rhetorical-role dataset", () => {
  it("covers all ten taxonomy roles plus mixed-role paragraphs", () => {
    const coverage = describeDatasetCoverage();
    expect(coverage.cases).toBe(60);
    for (const label of ARGUMENT_ROLE_LABELS) {
      expect(coverage.perRole[label], `gold items for ${label}`).toBeGreaterThanOrEqual(5);
    }
    // The eleventh evaluation class: paragraphs carrying two roles.
    expect(coverage.mixedRoleCases).toBe(10);
  });

  it("has unique ids, valid labels, topics for off-topic items, and honest provenance", () => {
    const ids = ARGUMENT_ROLE_EVAL_DATASET.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of ARGUMENT_ROLE_EVAL_DATASET) {
      expect(item.expected.length).toBeGreaterThanOrEqual(1);
      for (const label of item.expected) {
        expect(ARGUMENT_ROLE_LABELS as readonly string[]).toContain(label);
      }
      if (item.expected.includes("off-topic")) {
        expect(item.topic, `${item.id} needs motion context`).toBeTruthy();
      }
      expect(["verified_human", "unverified_fixture", "synthetic"]).toContain(item.provenance);
    }
    const offTopicGold = ARGUMENT_ROLE_EVAL_DATASET.filter((item) => item.expected.includes("off-topic"));
    expect(describeDatasetCoverage().offTopicWithTopic).toBe(offTopicGold.length);
  });

  it("stays structurally neutral: no partisan or wedge-issue vocabulary", () => {
    for (const item of ARGUMENT_ROLE_EVAL_DATASET) {
      const lower = `${item.text} ${item.topic ?? ""}`.toLowerCase();
      for (const term of NEUTRALITY_BLOCKLIST) {
        expect(lower, `${item.id} contains "${term}"`).not.toContain(term);
      }
    }
  });
});

describe("evaluation metric math", () => {
  const perfect: RolePredictionMap = new Map(ARGUMENT_ROLE_EVAL_DATASET.map((item) => [item.id, [...item.expected]]));

  it("scores a perfect run at full marks with zero calibration error", () => {
    const confidences = new Map(ARGUMENT_ROLE_EVAL_DATASET.map((item) => [item.id, 1]));
    const report = evaluateRhetoricalRoles({ predictions: perfect, confidences, latenciesMs: [12, 18] });
    expect(report.taxonomyCoverage.cases).toBe(60);
    expect(report.labels.taxonomyVersion).toBe(ARGUMENT_TAXONOMY_VERSION);
    expect(report.labels.microF1).toBe(1);
    expect(report.labels.macroF1).toBe(1);
    expect(report.labels.exactMatch).toBe(1);
    expect(report.mixedRole.f1).toBe(1);
    expect(report.mixedRole.tp).toBe(10);
    expect(report.calibration.n).toBe(60);
    expect(report.calibration.ece).toBe(0);
    expect(report.latency.n).toBe(2);
    expect(report.tiers).toBeNull();
    expect(report.shadowRouteAgreement).toBeNull();
    // Confusion is diagonal: every gold primary lands on itself. The diagonal
    // counts items whose FIRST expected label is the row label — mixed items
    // contribute to their primary's row only (perRole would double-count).
    const expectedDiagonal: Record<ArgumentRole, number> = {
      claim: 9,
      evidence: 7,
      reasoning: 5,
      rebuttal: 6,
      counterexample: 6,
      concession: 6,
      qualification: 5,
      question: 6,
      "off-topic": 5,
      other: 5,
    };
    expect(Object.values(expectedDiagonal).reduce((s, v) => s + v, 0)).toBe(60);
    report.confusion.matrix.forEach((row, i) => {
      row.forEach((count, j) => expect(count).toBe(i === j ? expectedDiagonal[report.confusion.labels[i]] : 0));
    });
  });

  it("builds the confusion matrix over primary roles", () => {
    const matrix = buildConfusionMatrix(
      [
        { id: "a", text: "t", expected: ["claim"], provenance: "synthetic" },
        { id: "b", text: "t", expected: ["claim"], provenance: "synthetic" },
        { id: "c", text: "t", expected: ["evidence"], provenance: "synthetic" },
      ],
      { a: ["claim"], b: ["rebuttal"], c: ["evidence"] },
    );
    const at = (gold: ArgumentRole, pred: ArgumentRole) =>
      matrix.matrix[matrix.labels.indexOf(gold)][matrix.labels.indexOf(pred)];
    expect(at("claim", "claim")).toBe(1);
    expect(at("claim", "rebuttal")).toBe(1);
    expect(at("evidence", "evidence")).toBe(1);
    // Missing predictions count as "other".
    const missing = buildConfusionMatrix(
      [{ id: "a", text: "t", expected: ["question"], provenance: "synthetic" }],
      {},
    );
    expect(missing.matrix[missing.labels.indexOf("question")][missing.labels.indexOf("other")]).toBe(1);
  });

  it("measures expected calibration error over confidence bins", () => {
    const cases = [
      { id: "a", text: "t", expected: ["claim"] as ArgumentRole[], provenance: "synthetic" as const },
      { id: "b", text: "t", expected: ["claim"] as ArgumentRole[], provenance: "synthetic" as const },
      { id: "c", text: "t", expected: ["claim"] as ArgumentRole[], provenance: "synthetic" as const },
      { id: "d", text: "t", expected: ["claim"] as ArgumentRole[], provenance: "synthetic" as const },
    ];
    // Two right at 0.9, two wrong at 0.9: accuracy 0.5 vs confidence 0.9.
    const report = calibrationReport(cases, { a: ["claim"], b: ["claim"], c: ["evidence"], d: ["evidence"] }, { a: 0.9, b: 0.9, c: 0.9, d: 0.9 }, 10);
    expect(report.n).toBe(4);
    expect(report.ece).toBeCloseTo(0.4);
    expect(report.maxGap).toBeCloseTo(0.4);
    // Withheld confidences are excluded, never treated as zero.
    const empty = calibrationReport(cases, { a: ["claim"] }, undefined);
    expect(empty.n).toBe(0);
    expect(empty.ece).toBeNull();
  });

  it("summarises latency honestly, with nulls on no data", () => {
    expect(summariseLatencies([])).toEqual({ n: 0, meanMs: null, p50Ms: null, p95Ms: null, maxMs: null });
    const summary = summariseLatencies([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(summary.n).toBe(10);
    expect(summary.meanMs).toBe(55);
    expect(summary.p50Ms).toBe(50);
    expect(summary.p95Ms).toBe(100);
    expect(summary.maxMs).toBe(100);
  });

  it("scores mixed-role detection as its own binary class", () => {
    const cases = [
      { id: "a", text: "t", expected: ["claim", "evidence"] as ArgumentRole[], provenance: "synthetic" as const },
      { id: "b", text: "t", expected: ["claim"] as ArgumentRole[], provenance: "synthetic" as const },
      { id: "c", text: "t", expected: ["rebuttal"] as ArgumentRole[], provenance: "synthetic" as const },
    ];
    const found = evaluateMixedRoleDetection(cases, { a: ["claim", "evidence"], b: ["claim", "question"], c: ["rebuttal"] });
    expect(found).toMatchObject({ tp: 1, fp: 1, fn: 0, precision: 0.5, recall: 1 });
    const missed = evaluateMixedRoleDetection(cases, { a: ["claim"], b: ["claim"], c: ["rebuttal"] });
    expect(missed).toMatchObject({ tp: 0, fp: 0, fn: 1, precision: 0, recall: 0, f1: 0 });
  });

  it("compares fast-vs-smart tiers on agreement, escalation, and latency", () => {
    const comparison = compareClassifierTiers(
      { tier: "fast", labels: { a: ["claim"], b: ["other"] }, latencyMs: [100], escalatedCount: 0 },
      { tier: "smart", labels: { a: ["claim"], b: ["evidence"] }, latencyMs: [300], escalatedCount: 1 },
    );
    expect(comparison.ids).toBe(2);
    expect(comparison.labelAgreement).toBe(0.5);
    expect(comparison.primaryAgreement).toBe(0.5);
    expect(comparison.meanLatencyDeltaMs).toBe(200);
    expect(comparison.smartEscalated).toBe(1);
    expect(comparison.flips).toEqual([{ id: "b", fast: ["other"], smart: ["evidence"] }]);
  });
});

describe("tier behaviour through the client (stubbed transport)", () => {
  beforeEach(() => {
    resetAiTelemetry();
    vi.restoreAllMocks();
  });

  function tierStub(tier: "fast" | "smart", flipOdd: boolean): typeof fetch {
    return (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { inputs: string[]; tier: string };
      expect(body.tier).toBe(tier);
      const gold = new Map(ARGUMENT_ROLE_EVAL_DATASET.map((item) => [item.text, item.expected]));
      return new Response(JSON.stringify({
        tier,
        model: `${tier}-test`,
        results: body.inputs.map((text, i) => {
          const expected = gold.get(text) ?? ["other"];
          const labels = flipOdd && i % 2 === 1 ? ["other"] : [...expected];
          return {
            label: labels[0],
            labels,
            confidence: 0.9,
            scores: Object.fromEntries(labels.map((label) => [label, 0.9])),
            escalated: tier === "smart" && i % 2 === 1,
          };
        }),
        usage: { classifications: body.inputs.length, escalated: 0, escalation_failed: 0, ms: 10 },
      }), { status: 200 });
    }) as typeof fetch;
  }

  it("measures fast-vs-smart agreement, escalation, and tier echo end to end", async () => {
    const texts = ARGUMENT_ROLE_EVAL_DATASET.map((item) => item.text);
    const timed = async (tier: "fast" | "smart", flipOdd: boolean) => {
      const startedAt = Date.now();
      const rows = await classifyArgumentBatch(texts, { fetchImpl: tierStub(tier, flipOdd), tier });
      return { rows, latencyMs: Date.now() - startedAt };
    };
    const fast = await timed("fast", true);
    const smart = await timed("smart", false);
    expect(fast.rows).toHaveLength(60);
    expect(smart.rows).toHaveLength(60);
    // Tier echo and model attribution survive the client.
    expect(new Set(fast.rows.map((r) => r.tier))).toEqual(new Set(["fast"]));
    expect(new Set(smart.rows.map((r) => r.tier))).toEqual(new Set(["smart"]));
    expect(smart.rows[1].escalated).toBe(true);

    const comparison = compareClassifierTiers(
      {
        tier: "fast",
        labels: Object.fromEntries(fast.rows.map((r, i) => [ARGUMENT_ROLE_EVAL_DATASET[i].id, r.labels])),
        latencyMs: [fast.latencyMs],
        escalatedCount: fast.rows.filter((r) => r.escalated).length,
      },
      {
        tier: "smart",
        labels: Object.fromEntries(smart.rows.map((r, i) => [ARGUMENT_ROLE_EVAL_DATASET[i].id, r.labels])),
        latencyMs: [smart.latencyMs],
        escalatedCount: smart.rows.filter((r) => r.escalated).length,
      },
    );
    // Fast flips every odd item to "other"; smart keeps gold. Odd items whose
    // gold is already exactly ["other"] are unaffected, so derive the flip
    // count from the dataset instead of hardcoding it.
    const oddChanged = ARGUMENT_ROLE_EVAL_DATASET.filter(
      (item, i) => i % 2 === 1 && !(item.expected.length === 1 && item.expected[0] === "other"),
    ).length;
    expect(oddChanged).toBeGreaterThan(0);
    expect(comparison.labelAgreement).toBe((60 - oddChanged) / 60);
    expect(comparison.flips).toHaveLength(oddChanged);
    expect(comparison.smartEscalated).toBe(30);
    expect(comparison.fastEscalated).toBe(0);
  });
});

describe("shadow-route agreement between gold and predicted labels", () => {
  function goldClassification(index: number, text: string, labels: ArgumentRole[]): ArgumentClassification {
    return {
      index,
      text,
      labels,
      scores: { [labels[0]]: 0.9 },
      primaryRole: labels[0],
      confidence: 0.9,
      status: labels[0] === "other" ? "unknown" : "high_confidence",
      source: "classifier.dev",
    };
  }

  function fallbackClassification(index: number, text: string): ArgumentClassification {
    return {
      index,
      text,
      labels: ["other"],
      scores: {},
      primaryRole: "other",
      confidence: 0,
      status: "fallback",
      source: "fallback",
      errorCode: "classifier_unavailable",
    };
  }

  function debate(id: string, items: Array<{ text: string; expected: ArgumentRole[] }>, predicted: (index: number, text: string, expected: ArgumentRole[]) => ArgumentClassification) {
    const args: SubmittedArgument[] = items.map((item, i) => ({
      id: `${id}-${i}`,
      text: item.text,
      owner: (i % 2 === 0 ? "a" : "b") as "a" | "b",
      round: 1,
    }));
    const gold = routeClassifiedArguments(
      args,
      items.map((item, i) => goldClassification(i, item.text, item.expected)),
    );
    const predictedPlan = routeClassifiedArguments(
      args,
      items.map((item, i) => predicted(i, item.text, item.expected)),
    );
    return { id, gold, predicted: predictedPlan };
  }

  it("detects when predicted labels would route differently from gold", () => {
    const claimItems = [
      { text: "The library should extend its evening hours.", expected: ["claim"] as ArgumentRole[] },
      { text: "A community garden would give residents fresh produce.", expected: ["claim"] as ArgumentRole[] },
    ];
    const questionItems = [
      { text: "When does the farmers market move outdoors?", expected: ["question"] as ArgumentRole[] },
      { text: "Who maintains the trail markers after storms?", expected: ["question"] as ArgumentRole[] },
    ];
    const mixedKnownItems = [
      { text: "The library should extend its evening hours.", expected: ["claim"] as ArgumentRole[] },
      { text: "Hello everyone, glad to be here.", expected: ["other"] as ArgumentRole[] },
    ];
    const pairs = [
      debate("deterministic-vs-ensemble", claimItems, (i, text) => fallbackClassification(i, text)),
      debate("response-vs-ensemble", questionItems, (i, text) => fallbackClassification(i, text)),
      debate("ensemble-agrees", mixedKnownItems, (i, text) => fallbackClassification(i, text)),
    ];
    expect(pairs[0].gold.route).toBe("deterministic");
    expect(pairs[1].gold.route).toBe("response-generation");
    expect(pairs[2].gold.route).toBe("ensemble");
    const agreement = measureShadowRouteAgreement(pairs);
    expect(agreement.pairs).toBe(3);
    // Only the already-ensemble debate agrees; the other two would route
    // away from the judge while gold would avoid it.
    expect(agreement.routeAgreement).toBeCloseTo(1 / 3);
    expect(agreement.judgePathAgreement).toBeCloseTo(1 / 3);
    expect(agreement.disagreements.map((d) => d.id).sort()).toEqual(
      ["deterministic-vs-ensemble", "response-vs-ensemble"],
    );
  });

  it("reports full agreement when predictions match gold", () => {
    const items = [
      { text: "The library should extend its evening hours.", expected: ["claim"] as ArgumentRole[] },
      { text: "A community garden would give residents fresh produce.", expected: ["claim"] as ArgumentRole[] },
    ];
    const args: SubmittedArgument[] = items.map((item, i) => ({ id: `g-${i}`, text: item.text, owner: "a", round: 1 }));
    const plan = routeClassifiedArguments(args, items.map((item, i) => goldClassification(i, item.text, item.expected)));
    const agreement = measureShadowRouteAgreement([{ id: "same", gold: plan, predicted: plan }]);
    expect(agreement.routeAgreement).toBe(1);
    expect(agreement.judgePathAgreement).toBe(1);
    expect(agreement.disagreements).toEqual([]);
    const empty = measureShadowRouteAgreement([]);
    expect(empty.routeAgreement).toBeNull();
    expect(empty.judgePathAgreement).toBeNull();
  });
});

describe("local fallback baseline over the labelled dataset", () => {
  beforeEach(() => {
    resetAiTelemetry();
    vi.restoreAllMocks();
  });

  it("pins the deterministic fallback report so heuristic drift is visible", async () => {
    const failing: typeof fetch = async () =>
      new Response(JSON.stringify({ code: "timeout" }), { status: 504 });
    const rows = await classifyArgumentBatch(
      ARGUMENT_ROLE_EVAL_DATASET.map((item) => item.text),
      { fetchImpl: failing },
    );
    expect(rows.every((row) => row.source === "fallback")).toBe(true);
    const predictions = new Map(rows.map((row, i) => [ARGUMENT_ROLE_EVAL_DATASET[i].id, row.labels]));
    const confidences = new Map(rows.map((row, i) => [ARGUMENT_ROLE_EVAL_DATASET[i].id, row.confidence]));
    const report = evaluateRhetoricalRoles({ predictions, confidences });
    // Deterministic pins: the local fallback is the safety net for skipped
    // and failed debates, so any drift in its heuristics must fail loudly.
    expect(report.labels.cases).toBe(60);
    expect(report.labels.exactMatch).toBeCloseTo(0.6166666666666667, 10);
    expect(report.labels.microF1).toBeCloseTo(0.6567164179104478, 10);
    expect(report.labels.macroF1).toBeCloseTo(0.579053544494721, 10);
    expect(report.labels.unknownPredictions).toBe(16);
    expect(report.mixedRole.f1).toBeCloseTo(0.4285714285714285, 10);
    expect(report.calibration.ece).toBeCloseTo(0.2758333333333331, 10);
  });
});
