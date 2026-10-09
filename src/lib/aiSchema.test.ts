import { describe, it, expect } from "vitest";
import {
  isValidGeneratedTopic,
  isValidOpening,
  isValidDebateTurn,
  isValidSummary,
  isValidJudgeExtraction,
  isValidWinner,
  isValidScore,
} from "./aiSchema";

const goodTopic = {
  title: "Should cities ban gas cars?",
  prompt: "Argue for or against municipal combustion-engine bans.",
  category: "Policy",
  sources: [{ name: "Pew Research Center", homepage: "https://www.pewresearch.org", angle: "Polling" }],
};

describe("ai schema validators", () => {
  it("accepts well-formed outputs", () => {
    expect(isValidGeneratedTopic(goodTopic)).toBe(true);
    expect(isValidOpening("Solar costs have fallen ninety percent since 2010, changing the debate entirely.")).toBe(true);
    expect(isValidDebateTurn({ aiMessage: "But grid storage remains expensive at scale today.", feedback: "Good use of data." })).toBe(true);
    expect(isValidSummary({ overallFeedback: "You argued consistently from evidence.", strengths: ["citations"], improvements: ["weigh impacts"] })).toBe(true);
  });

  it("rejects truncated or wrong-typed fields", () => {
    expect(isValidGeneratedTopic({ ...goodTopic, title: "Hi" })).toBe(false);
    expect(isValidGeneratedTopic({ ...goodTopic, sources: [] })).toBe(false);
    expect(isValidOpening("Short.")).toBe(false);
    expect(isValidDebateTurn({ aiMessage: "A perfectly reasonable reply.", feedback: "" })).toBe(false);
    expect(isValidSummary({ overallFeedback: "Solid overall assessment here.", strengths: "not-an-array", improvements: [] })).toBe(false);
    expect(isValidSummary(null)).toBe(false);
  });

  it("rejects a judge extraction whose graph cannot be scored", () => {
    const good = {
      rationale: "A cited a real source and B dropped the rebuttal in round two.",
      argGraph: {
        nodes: [
          { id: "c1", kind: "claim", owner: "a", text: "Claim", round: 1 },
          { id: "e1", kind: "evidence", owner: "b", text: "Evidence", round: 2 },
        ],
        edges: [{ from: "e1", to: "c1", relation: "rebuts" }],
      },
    };
    expect(isValidJudgeExtraction(good)).toBe(true);

    // Not an object / missing graph.
    expect(isValidJudgeExtraction(null)).toBe(false);
    expect(isValidJudgeExtraction({ rationale: "Fine analysis here.", argGraph: {} })).toBe(false);
    // nodes is not an array.
    expect(isValidJudgeExtraction({ rationale: "Fine analysis here.", argGraph: { nodes: {} } })).toBe(false);
    // A node with an unknown kind or owner is not scoreable.
    expect(
      isValidJudgeExtraction({
        rationale: "Fine analysis here.",
        argGraph: { nodes: [{ id: "x", kind: "mystery", owner: "a", round: 1 }] },
      }),
    ).toBe(false);
    expect(
      isValidJudgeExtraction({
        rationale: "Fine analysis here.",
        argGraph: { nodes: [{ id: "x", kind: "claim", owner: "zzz", round: 1 }] },
      }),
    ).toBe(false);
    // Missing rationale means no inspectable diagnosis.
    expect(
      isValidJudgeExtraction({ argGraph: { nodes: [{ id: "x", kind: "claim", owner: "a", round: 1 }] } }),
    ).toBe(false);
  });

  it("guards winner and score at the stored-verdict boundary", () => {
    expect(isValidWinner("a")).toBe(true);
    expect(isValidWinner("tie")).toBe(true);
    expect(isValidWinner("A")).toBe(false);
    expect(isValidWinner("winner")).toBe(false);
    expect(isValidWinner(undefined)).toBe(false);

    expect(isValidScore(51)).toBe(true);
    expect(isValidScore(0)).toBe(true);
    expect(isValidScore(Number.NaN)).toBe(false);
    expect(isValidScore("51")).toBe(false);
  });
});
