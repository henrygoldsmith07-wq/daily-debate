import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLASSIFIER_CONFIDENCE_POLICY,
  classifyArgumentBatch,
  classifyArgumentBatchDetailed,
  classifyDebateTranscript,
  routeClassifiedArguments,
} from "./argumentRouting";
import { ARGUMENT_ROLE_LABELS, type ArgumentClassification, type SubmittedArgument } from "./argumentTaxonomy";
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
