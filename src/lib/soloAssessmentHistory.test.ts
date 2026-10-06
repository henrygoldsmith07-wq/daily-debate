import { describe, expect, it } from "vitest";
import { assessTurn } from "./observableAssessment";
import { mergeSoloAssessmentsByDebate } from "./soloAssessmentHistory";

describe("mergeSoloAssessmentsByDebate", () => {
  it("rebuilds a whole prior debate instead of keeping only its last turn", () => {
    const first = assessTurn({
      round: 1,
      opponentMessage: "The policy is too expensive.",
      userMessage: "According to Lazard data, costs fell 30%, so the policy is affordable.",
    }).assessment;
    const second = assessTurn({
      round: 2,
      opponentMessage: "Those savings may not reach households.",
      userMessage: "However, household bills still fall because operating costs are lower.",
    }).assessment;

    const merged = mergeSoloAssessmentsByDebate([
      { debate_id: "debate-1", assessment: first },
      { debate_id: "debate-1", assessment: second },
    ]).get("debate-1");

    expect(merged).toBeDefined();
    expect(merged!.features.a.claimsMade.value).toBe(2);
    expect(merged!.graph.nodes.some((node) => node.id === "r1-evidence-1")).toBe(true);
    expect(merged!.graph.nodes.some((node) => node.id === "r2-claim")).toBe(true);

    // The old route used the final turn assessment here, which only sees one
    // claim and loses the first round's evidence entirely.
    expect(second.features.a.claimsMade.value).toBe(1);
    expect(second.graph.nodes.some((node) => node.id === "r1-evidence-1")).toBe(false);
  });

  it("keeps debates separate and ignores rows without an assessment graph", () => {
    const a = assessTurn({
      round: 1,
      opponentMessage: "Opposition A.",
      userMessage: "My first case matters because it reduces harm.",
    }).assessment;
    const b = assessTurn({
      round: 1,
      opponentMessage: "Opposition B.",
      userMessage: "According to WHO research, prevention reduces risk.",
    }).assessment;

    const merged = mergeSoloAssessmentsByDebate([
      { debate_id: "a", assessment: a },
      { debate_id: "missing", assessment: null },
      { debate_id: "b", assessment: b },
    ]);

    expect([...merged.keys()].sort()).toEqual(["a", "b"]);
    expect(merged.get("a")!.graph.nodes.every((node) => !node.text.includes("WHO"))).toBe(true);
    expect(merged.get("b")!.graph.nodes.some((node) => node.text.includes("WHO"))).toBe(true);
  });
});
