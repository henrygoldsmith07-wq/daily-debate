import { describe, expect, it } from "vitest";
import { assessTurn } from "./observableAssessment";
import { liveCoachingForTurn } from "./liveCoaching";

function hintsFor(userMessage: string, opponentMessage: string, round: number) {
  const observable = assessTurn({ userMessage, opponentMessage, round });
  return { observable, hints: liveCoachingForTurn({ assessment: observable.assessment, round, userMessage }) };
}

describe("liveCoachingForTurn", () => {
  it("returns no hints for a clean, engaged, grounded turn", () => {
    const { hints } = hintsFor(
      "However, the mechanism you claim breaks down: NREL data shows costs fell while reliability improved, so the tradeoff you assert is weaker than you present it.",
      "Your claim ignores grid reliability. What happens when storage is needed?",
      2,
    );
    expect(hints).toEqual([]);
  });

  it("warns when the opponent's last move went unengaged", () => {
    const { hints } = hintsFor(
      "Solar deployment creates jobs and local tax revenue across the region.",
      "Your claim ignores grid reliability. What happens when storage is needed?",
      2,
    );
    const unanswered = hints.find((h) => h.id === "unanswered-opponent");
    expect(unanswered?.severity).toBe("warning");
  });

  it("tips on substantive claims with no cited evidence, but not on round 1", () => {
    const round2 = hintsFor(
      "Solar deployment creates jobs and local tax revenue across the region.",
      "Deployment costs remain prohibitive for most municipalities.",
      2,
    );
    expect(round2.hints.some((h) => h.id === "no-evidence")).toBe(true);

    const round1 = hintsFor(
      "Solar deployment creates jobs and local tax revenue across the region.",
      "Deployment costs remain prohibitive for most municipalities.",
      1,
    );
    expect(round1.hints.some((h) => h.id === "no-evidence")).toBe(false);
  });

  it("tips on absolute-language overclaims when nothing structural fires", () => {
    const { hints } = hintsFor(
      "However, NREL data shows solar is obviously the best option and it will never fail.",
      "Reliability concerns remain for night-time generation.",
      3,
    );
    expect(hints.some((h) => h.id === "absolute-language")).toBe(true);
  });

  it("caps at one warning and one tip", () => {
    const { hints } = hintsFor(
      "Everyone knows solar is obviously the best option and it will never fail.",
      "Your claim ignores grid reliability entirely.",
      2,
    );
    expect(hints.length).toBeLessThanOrEqual(2);
    const warnings = hints.filter((h) => h.severity === "warning");
    const tips = hints.filter((h) => h.severity === "tip");
    expect(warnings.length).toBeLessThanOrEqual(1);
    expect(tips.length).toBeLessThanOrEqual(1);
    // Structural misses outrank craft nudges.
    if (hints.length === 2) {
      expect(hints[0].severity).toBe("warning");
    }
  });

  it("is deterministic and returns nothing without an assessment", () => {
    const a = hintsFor("Same message about solar policy.", "Opponent point.", 2).hints;
    const b = hintsFor("Same message about solar policy.", "Opponent point.", 2).hints;
    expect(a).toEqual(b);
    expect(liveCoachingForTurn({ assessment: null, round: 2, userMessage: "x" })).toEqual([]);
  });
});
