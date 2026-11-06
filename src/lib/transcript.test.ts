import { describe, expect, it } from "vitest";
import { transcriptFilename, transcriptText } from "./transcript";

describe("transcriptText", () => {
  it("writes the motion, sides and each round in order, and nothing else", () => {
    const text = transcriptText({
      topicTitle: "Should cities ban cars?",
      side: "against",
      day: "2026-11-06",
      turns: [
        { round: 2, opponent: "Second point.", learner: null },
        { round: 1, opponent: " Opening. ", learner: "My answer." },
        { round: 3, opponent: "", learner: "  " },
      ],
    });
    expect(text).toBe(
      [
        "Daily Debate · 2026-11-06",
        "Motion: Should cities ban cars?",
        "You: Against · Opponent (AI): For",
        "",
        "Round 1",
        "Opponent: Opening.",
        "You: My answer.",
        "",
        "Round 2",
        "Opponent: Second point.",
        "",
      ].join("\n"),
    );
  });
});

describe("transcriptFilename", () => {
  it("is dated and never carries free text", () => {
    expect(transcriptFilename("2026-11-06")).toBe("daily-debate-2026-11-06.txt");
    expect(transcriptFilename("../etc")).toBe("daily-debate-transcript.txt");
  });
});
