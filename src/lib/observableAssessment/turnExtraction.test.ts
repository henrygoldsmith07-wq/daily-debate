import { describe, expect, it } from "vitest";
import { graphFromTurn, NODE_TEXT_CAP } from "./turnExtraction";

// Regression test for the measurement-fidelity truncation bug.
//
// graphFromTurn previously sliced every node's text to 240 chars, which meant
// fallacy / contradiction / concession detection (which runs on node.text
// during enrichment) could never see content past char 240. The accepted input
// boundary is 6000 chars (see isSuspiciousLength + aiSchema), so the node text
// cap must cover it — otherwise a fallacy written after the 240-char mark was
// silently invisible to the scorer.

describe("graphFromTurn — extraction fidelity", () => {
  it("stores the full accepted message length on nodes (no 240-char blind spot)", () => {
    // A message longer than 240 that still fits under the API input cap.
    const longMessage = "This is a claim that has a " + "very ".repeat(200) + "long setup before the fallacy.";
    // The fallacy match lands well past char 240.
    const withFallacy =
      longMessage + " " + "This is clearly an ad hominem attack on the arguer rather than addressing their point.";

    const graph = graphFromTurn({
      userMessage: withFallacy,
      opponentMessage: "Opponent counterclaim here.",
      round: 1,
    });

    // The longest node must carry more than the old 240-char blind spot.
    const longest = graph.nodes.reduce((max, node) => Math.max(max, node.text.length), 0);
    expect(longest).toBeGreaterThan(240);
    // And it must not exceed the documented cap (no unbounded growth).
    expect(longest).toBeLessThanOrEqual(NODE_TEXT_CAP);
  });

  it("detects fallacies that only appear past the old 240-char boundary", () => {
    const longSetup = "Claim about policy. ".repeat(15); // ~285 chars before the fallacy
    const message = longSetup + " You are a liar and should not be trusted.";

    const graph = graphFromTurn({ userMessage: message, opponentMessage: "", round: 1 });

    // The enrichment step runs classifyFallacies on the node text. With the old
    // 240-char cap the ad-hominem pattern was invisible and the graph had zero
    // fallacies; with the fix it is detected.
    expect(graph.fallacies.length).toBeGreaterThan(0);
    expect(graph.fallacies.some((f) => f.fallacy === "ad_hominem")).toBe(true);
  });

  it("truncates to NODE_TEXT_CAP only, never the old 240", () => {
    // Build a message exactly at the input cap + overflow; the node must be
    // capped at NODE_TEXT_CAP (6000), not at 240.
    const msg = "x".repeat(NODE_TEXT_CAP + 500);
    const graph = graphFromTurn({ userMessage: msg, opponentMessage: "", round: 1 });
    for (const node of graph.nodes) {
      expect(node.text.length).toBeLessThanOrEqual(NODE_TEXT_CAP);
    }
  });
});
