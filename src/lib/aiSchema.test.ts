import { describe, it, expect } from "vitest";
import { isValidGeneratedTopic, isValidOpening, isValidDebateTurn, isValidSummary } from "./aiSchema";

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
});
