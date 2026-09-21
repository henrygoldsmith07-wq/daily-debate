import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLASSIFIER_CONFIDENCE_POLICY,
  CLASSIFIER_DEV_MAX_INPUT_CHARS,
  classifyArgumentBatch,
  classifyArgumentBatchDetailed,
  classifyDebateTranscript,
  recordRoutingTelemetry,
  routeClassifiedArguments,
  routingSummary,
} from "./argumentRouting";
import { ARGUMENT_ROLE_LABELS, ARGUMENT_TAXONOMY_VERSION, type ArgumentClassification, type SubmittedArgument } from "./argumentTaxonomy";
import { recentAiCalls, resetAiTelemetry } from "./aiTelemetry";

function responseFor(inputs: string[]): Response {
  return new Response(JSON.stringify({
    model: "test/structural",
    results: inputs.map((text) => ({
      label: text.includes("However") ? "rebuttal" : "claim",
      labels: text.includes("However") ? ["rebuttal", "evidence"] : ["claim", "reasoning"],
      confidence: 0.93,
      scores: text.includes("However")
        ? { rebuttal: 0.93, evidence: 0.82 }
        : { claim: 0.93, reasoning: 0.84 },
    })),
  }), { status: 200, headers: { "content-type": "application/json" } });
}

describe("classifier.dev structural routing", () => {
  beforeEach(() => {
    resetAiTelemetry();
    vi.restoreAllMocks();
  });

  it("sends the versioned multi-label taxonomy and preserves mixed roles", async () => {
    const captured: { payload: Record<string, unknown> | null } = { payload: null };
    const fetchImpl: typeof fetch = async (_input, init) => {
      captured.payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return responseFor(captured.payload.inputs as string[]);
    };

    const rows = await classifyArgumentBatch([
      "The plan works because access improves.",
      "However, according to NREL data the cost objection remains.",
    ], { endpoint: "https://classifier.test/v1/classify", fetchImpl });

    expect(captured.payload?.multi).toBe(true);
    expect(captured.payload?.max_labels).toBe(CLASSIFIER_CONFIDENCE_POLICY.maxLabels);
    expect(captured.payload?.labels).toEqual(ARGUMENT_ROLE_LABELS);
    expect(rows[0].labels).toEqual(["claim", "reasoning"]);
    expect(rows[1].labels).toEqual(["rebuttal", "evidence"]);
    expect(rows.every((row) => row.status === "high_confidence")).toBe(true);
    expect(recentAiCalls().some((entry) => entry.operation === "classify_argument_structure" && entry.inputCount === 2)).toBe(true);
  });

  it("chunks at the documented one-thousand input limit", async () => {
    const sizes: number[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { inputs: string[] };
      sizes.push(body.inputs.length);
      return responseFor(body.inputs);
    };
    const result = await classifyArgumentBatchDetailed(Array.from({ length: 1_001 }, (_, i) => `Argument ${i}`), { fetchImpl });
    expect(sizes).toEqual([1_000, 1]);
    expect(result.batchCount).toBe(2);
    expect(result.remoteBatches).toBe(2);
    expect(result.classifications).toHaveLength(1_001);
  });

  it("keeps low-confidence rows and classifier failures on the ensemble path", async () => {
    const lowConfidence: typeof fetch = async () => new Response(JSON.stringify({ results: [{ label: "claim", labels: ["claim"], confidence: 0.51, scores: { claim: 0.51, other: 0.49 } }] }), { status: 200 });
    const low = await classifyArgumentBatch(["The proposal should proceed."], { fetchImpl: lowConfidence });
    expect(low[0].status).toBe("ambiguous");

    const unavailable: typeof fetch = async () => new Response(JSON.stringify({ code: "timeout" }), { status: 504 });
    const fallback = await classifyArgumentBatch(["What evidence would change your mind?"], { fetchImpl: unavailable });
    expect(fallback[0].source).toBe("fallback");
    expect(fallback[0].status).toBe("fallback");

    const args: SubmittedArgument[] = [{ id: "a1", owner: "a", round: 1, text: "The proposal should proceed." }];
    const plan = routeClassifiedArguments(args, low);
    expect(plan.route).toBe("ensemble");
    expect(plan.requiresExpensiveJudge).toBe(true);
  });

  it("treats an explicit other label as unknown and keeps judging available", async () => {
    const other: typeof fetch = async () => new Response(JSON.stringify({
      results: [{ label: "other", labels: ["other"], confidence: 0.91, scores: { other: 0.91 } }],
    }), { status: 200 });
    const rows = await classifyArgumentBatch(["I am not sure what role this move has."], { fetchImpl: other });
    expect(rows[0].primaryRole).toBe("other");
    expect(rows[0].status).toBe("unknown");
    const plan = routeClassifiedArguments(
      [{ id: "other-1", owner: "a", round: 1, text: rows[0].text }],
      rows,
    );
    expect(plan.unknownCount).toBe(1);
    expect(plan.route).toBe("ensemble");
  });

  it("routes high-confidence mixed roles to a specialist path without selecting a winner", () => {
    const args: SubmittedArgument[] = [
      { id: "a1", owner: "a", round: 1, text: "The plan lowers cost." },
      { id: "b1", owner: "b", round: 1, text: "However, NREL data shows a grid cost." },
    ];
    const rows: ArgumentClassification[] = [
      { index: 0, text: args[0].text, labels: ["claim", "reasoning"], scores: { claim: 0.91, reasoning: 0.82 }, primaryRole: "claim", confidence: 0.91, status: "high_confidence", source: "classifier.dev" },
      { index: 1, text: args[1].text, labels: ["rebuttal", "evidence"], scores: { rebuttal: 0.94, evidence: 0.81 }, primaryRole: "rebuttal", confidence: 0.94, status: "high_confidence", source: "classifier.dev" },
    ];
    const plan = routeClassifiedArguments(args, rows);
    expect(plan.route).toBe("rebuttal-compare");
    expect(plan.classifiedArguments[1].classification.labels).toContain("evidence");
    expect(plan.requiresExpensiveJudge).toBe(false);
    expect(plan.roleCounts.rebuttal).toBe(1);
    expect(plan.roleCounts.evidence).toBe(1);
  });

  it("keeps opposing viewpoints on the same structural route", async () => {
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { inputs: string[] };
      return responseFor(body.inputs);
    };
    const plan = await classifyDebateTranscript({
      topicTitle: "Should cities expand transit?",
      transcript: "Player A (round 1): Transit expansion improves access.\nPlayer B (round 1): However, transit expansion can raise construction costs.",
      classifier: { fetchImpl },
    });
    expect(plan.taxonomyVersion).toBe("argument-roles-v1");
    expect(plan.arguments).toHaveLength(2);
    expect(plan.route).toBe("rebuttal-compare");
    // The classifier never receives or emits a correctness/winner field.
    expect(Object.keys(plan.classifications[0])).not.toContain("winner");
  });
});

describe("classifier.dev API contract (verified against the live OpenAPI spec)", () => {
  beforeEach(() => {
    resetAiTelemetry();
    vi.restoreAllMocks();
  });

  it("sends exactly the documented request shape with the versioned taxonomy", async () => {
    const captured: { payload: Record<string, unknown> | null } = { payload: null };
    const fetchImpl: typeof fetch = async (_input, init) => {
      captured.payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const inputs = captured.payload.inputs as string[];
      return new Response(JSON.stringify({
        tier: "fast",
        model: "fast-1",
        modelsUsed: ["fast-1"],
        results: inputs.map(() => ({ label: "claim", labels: ["claim"], confidence: 0.9, scores: { claim: 0.9 } })),
        usage: { classifications: inputs.length, escalated: 0, escalation_failed: 0, ms: 42 },
      }), { status: 200, headers: { "content-type": "application/json", "x-api-version": "v1" } });
    };
    const detail = await classifyArgumentBatchDetailed(["The library should open later."], {
      endpoint: "https://classifier.test/v1/classify",
      fetchImpl,
    });
    // Request shape matches POST /v1/classify: inputs, labels, tier,
    // instructions, multi, max_labels — and nothing else (no ids, no scores).
    expect(Object.keys(captured.payload ?? {}).sort()).toEqual(
      ["inputs", "instructions", "labels", "max_labels", "multi", "tier"].sort(),
    );
    expect(captured.payload?.tier).toBe("fast");
    expect(String(captured.payload?.instructions)).toContain(ARGUMENT_TAXONOMY_VERSION);
    expect(String(captured.payload?.instructions)).toMatch(/Ignore truth/);
    // Response attribution is captured for fast-vs-smart evaluation.
    expect(detail.tier).toBe("fast");
    expect(detail.serverLatencyMs).toBe(42);
    expect(detail.escalationFailed).toBeUndefined();
    expect(detail.apiVersion).toBe("v1");
    expect(detail.classifications[0].tier).toBe("fast");
    expect(detail.classifications[0].model).toBe("fast-1");
  });

  it("captures per-result model attribution and smart-tier escalation", async () => {
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { inputs: string[]; tier: string };
      expect(body.tier).toBe("smart");
      return new Response(JSON.stringify({
        tier: "smart",
        model: "smart-1",
        results: body.inputs.map(() => ({
          label: "evidence",
          labels: ["evidence"],
          confidence: 0.88,
          scores: { evidence: 0.88 },
          escalated: true,
          model: "smart-reasoning-1",
        })),
        usage: { classifications: body.inputs.length, escalated: body.inputs.length, escalation_failed: 0, ms: 900 },
      }), { status: 200 });
    };
    const detail = await classifyArgumentBatchDetailed(["City data shows higher use."], { fetchImpl, tier: "smart" });
    expect(detail.tier).toBe("smart");
    expect(detail.classifications[0].model).toBe("smart-reasoning-1");
    expect(detail.classifications[0].escalated).toBe(true);
    expect(detail.serverLatencyMs).toBe(900);
  });

  it("degrades an unscored result to fallback instead of trusting its labels", async () => {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
      model: "fast-1",
      results: [{ label: "claim", labels: ["claim"], confidence: 0.99, scores: { claim: 0.99 }, unscored: "too_short" }],
      usage: { classifications: 1, escalated: 0, escalation_failed: 0, ms: 5 },
    }), { status: 200 });
    const rows = await classifyArgumentBatch(["ok"], { fetchImpl });
    expect(rows[0].source).toBe("fallback");
    expect(rows[0].status).toBe("fallback");
    expect(rows[0].errorCode).toBe("unscored_result");
    const plan = routeClassifiedArguments(
      [{ id: "u1", owner: "a", round: 1, text: "ok" }],
      rows,
    );
    expect(plan.route).toBe("ensemble");
  });

  it("caps transmitted input length to minimise external text exposure", async () => {
    const captured: { inputs: string[] | null } = { inputs: null };
    const fetchImpl: typeof fetch = async (_input, init) => {
      captured.inputs = (JSON.parse(String(init?.body)) as { inputs: string[] }).inputs;
      return responseFor(captured.inputs);
    };
    const long = "x".repeat(CLASSIFIER_DEV_MAX_INPUT_CHARS + 1_000);
    await classifyArgumentBatch([long], { endpoint: "https://classifier.test/v1/classify", fetchImpl });
    expect(CLASSIFIER_DEV_MAX_INPUT_CHARS).toBe(4_000);
    expect(captured.inputs?.[0].length).toBe(CLASSIFIER_DEV_MAX_INPUT_CHARS);
  });

  it("never stores raw debate text in routing telemetry", async () => {
    const secret = "ZebraQuill debate text that must never be telemetered";
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { inputs: string[] };
      return responseFor(body.inputs);
    };
    const plan = await classifyDebateTranscript({
      transcript: `Player A (round 1): ${secret}.`,
      classifier: { fetchImpl },
    });
    recordRoutingTelemetry(routingSummary(plan, 0));
    for (const entry of recentAiCalls(20)) {
      expect(JSON.stringify(entry)).not.toContain("ZebraQuill");
    }
  });
});

describe("shadow sampling of classifier traffic", () => {
  beforeEach(() => {
    resetAiTelemetry();
    vi.restoreAllMocks();
  });

  const transcript = "Player A (round 1): The library should open later.\nPlayer B (round 1): However, costs may rise.";

  it("classifies every debate when no sampling key is supplied (current behaviour)", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async (_input, init) => {
      calls += 1;
      return responseFor((JSON.parse(String(init?.body)) as { inputs: string[] }).inputs);
    };
    const plan = await classifyDebateTranscript({ transcript, classifier: { fetchImpl } });
    expect(calls).toBe(1);
    expect(plan.shadowSampled).toBeNull();
    expect(routingSummary(plan, 0).shadowSampled).toBeUndefined();
  });

  it("skips the remote call for non-sampled debates and stays on the ensemble", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async (_input, init) => {
      calls += 1;
      return responseFor((JSON.parse(String(init?.body)) as { inputs: string[] }).inputs);
    };
    const plan = await classifyDebateTranscript({
      transcript,
      classifier: { fetchImpl },
      shadow: { key: "match-skip", rate: 0 },
    });
    expect(calls).toBe(0);
    expect(plan.shadowSampled).toBe(false);
    expect(plan.batchCount).toBe(0);
    expect(plan.classifierSource).toBe("fallback");
    expect(plan.fallbackCount).toBe(plan.arguments.length);
    expect(plan.route).toBe("ensemble");
    expect(plan.requiresExpensiveJudge).toBe(true);
    const summary = routingSummary(plan, 0);
    expect(summary.shadowSampled).toBe(false);
    // Skipped debates record a routing row with no remote inputs, so traffic
    // accounting stays honest (batchCount 0, fallbacks N).
    expect(summary.batchCount).toBe(0);
    expect(summary.fallbackCount).toBe(plan.arguments.length);
    recordRoutingTelemetry(summary);
    const routingRows = recentAiCalls(10).filter((entry) => entry.operation === "argument_routing");
    expect(routingRows).toHaveLength(1);
    expect(routingRows[0].inputCount).toBe(0);
    expect(routingRows[0].classificationFallbacks).toBe(plan.arguments.length);
  });

  it("classifies sampled debates remotely and marks the decision", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async (_input, init) => {
      calls += 1;
      return responseFor((JSON.parse(String(init?.body)) as { inputs: string[] }).inputs);
    };
    const plan = await classifyDebateTranscript({
      transcript,
      classifier: { fetchImpl },
      shadow: { key: "match-keep", rate: 1 },
    });
    expect(calls).toBe(1);
    expect(plan.shadowSampled).toBe(true);
    expect(routingSummary(plan, 0).shadowSampled).toBe(true);
  });

  it("records the skip reason on skipped classifications, never a winner", async () => {
    const fetchImpl: typeof fetch = async () => { throw new Error("must not be called"); };
    const plan = await classifyDebateTranscript({
      transcript,
      classifier: { fetchImpl },
      shadow: { key: "match-skip-2", rate: 0 },
    });
    expect(plan.classifications.every((c) => c.errorCode === "shadow_not_sampled")).toBe(true);
    expect(Object.keys(plan.classifications[0])).not.toContain("winner");
  });

  it("counts zero remote inputs when the remote is disabled (E2E mode)", async () => {
    const previous = process.env.E2E_MOCK_AI;
    process.env.E2E_MOCK_AI = "1";
    try {
      const detail = await classifyArgumentBatchDetailed(["The library should open later."], {});
      expect(detail.remoteUsed).toBe(false);
      const plan = routeClassifiedArguments(
        [{ id: "e2e-1", owner: "a", round: 1, text: "The library should open later." }],
        detail.classifications,
        detail.batchCount,
      );
      expect(plan.classifierSource).toBe("disabled");
      recordRoutingTelemetry(routingSummary(plan, 0));
      const routingRows = recentAiCalls(10).filter((entry) => entry.operation === "argument_routing");
      expect(routingRows).toHaveLength(1);
      expect(routingRows[0].inputCount).toBe(0);
    } finally {
      if (previous === undefined) delete process.env.E2E_MOCK_AI;
      else process.env.E2E_MOCK_AI = previous;
    }
  });
});
