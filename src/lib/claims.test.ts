import { describe, expect, it } from "vitest";
import { claimCounts, classifyClaim, extractClaims, splitSentences } from "./claims";

describe("splitSentences", () => {
  it("splits on sentence ends without breaking numbers", () => {
    expect(splitSentences("Costs rose 3.5% last year. That matters! Does it?")).toEqual([
      "Costs rose 3.5% last year.",
      "That matters!",
      "Does it?",
    ]);
  });
});

describe("classifyClaim", () => {
  it("tags lookup-able statements as checkable", () => {
    expect(classifyClaim("Leeds saved £2m when it closed two offices.")).toBe("checkable");
    expect(classifyClaim("According to the ONS, commuting fell after lockdown ended.")).toBe("checkable");
    expect(classifyClaim("A recent study found that remote staff take fewer sick days.")).toBe("checkable");
    expect(classifyClaim("Attendance dropped by 12 percent across the county.")).toBe("checkable");
  });

  it("tags value judgements and recommendations as opinion", () => {
    expect(classifyClaim("Councils should keep remote working for most roles.")).toBe("opinion");
    expect(classifyClaim("I think the office culture argument is overrated here.")).toBe("opinion");
    expect(classifyClaim("It is unfair to make carers commute every day.")).toBe("opinion");
  });

  it("leaves a plain assertion unlabelled rather than guessing", () => {
    expect(classifyClaim("Remote staff answer residents' emails from home.")).toBe("claim");
  });

  it("prefers checkable when a sentence has both cues", () => {
    expect(classifyClaim("We should act because 40% of staff already work remotely.")).toBe("checkable");
  });
});

describe("extractClaims", () => {
  const claims = extractClaims([
    { speaker: "You", side: "against", round: 1, text: "Councils should keep remote working for most roles. Leeds saved £2m in 2024. Why not?" },
    { speaker: "Opponent", side: "for", round: 1, text: "Too short. Offices build a shared culture that newer staff rely on." },
    { speaker: "You", side: "against", round: 2, text: null },
  ]);

  it("keeps assertions, drops questions and fragments, and attributes each one", () => {
    expect(claims.map((c) => [c.speaker, c.round, c.kind])).toEqual([
      ["You", 1, "opinion"],
      ["You", 1, "checkable"],
      ["Opponent", 1, "claim"],
    ]);
    expect(new Set(claims.map((c) => c.id)).size).toBe(claims.length);
  });

  it("counts claims by tag", () => {
    expect(claimCounts(claims)).toEqual({ checkable: 1, opinion: 1, claim: 1 });
  });

  it("truncates a run-on sentence", () => {
    const long = `Councils should ${"really ".repeat(80)}keep it.`;
    const [claim] = extractClaims([{ speaker: "You", side: "for", round: 1, text: long }]);
    expect(claim.text.length).toBeLessThanOrEqual(280);
    expect(claim.text.endsWith("…")).toBe(true);
  });
});
