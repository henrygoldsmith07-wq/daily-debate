import { describe, expect, it } from "vitest";
import { buildFinishPreview } from "./finishPreview";

describe("buildFinishPreview", () => {
  it("returns null when no answered turn has an assessment", () => {
    expect(buildFinishPreview([], "full")).toBeNull();
    expect(buildFinishPreview([{ user_message: "hi", assessment: null }], "full")).toBeNull();
    expect(buildFinishPreview([{ user_message: null, assessment: { graph: {} } }], "full")).toBeNull();
  });

  it("matches the final result's weakness for the same stored turns", () => {
    const graph = {
      nodes: [
        { id: "c1", kind: "claim", owner: "a", text: "Tuition caps always lower inequality.", round: 1 },
        { id: "c2", kind: "claim", owner: "a", text: "Enrolment rises because of the caps.", round: 2 },
        { id: "o1", kind: "counterclaim", owner: "ai", text: "Subsidies mostly benefit wealthier households.", round: 1 },
      ],
      edges: [], dropped: [], contradictions: [], concessions: [], fallacies: [],
      evidenceStats: { total: 0, byOwner: { a: 0, b: 0, ai: 0 }, byStrength: { anecdotal: 0, general: 0, cited: 0, strong: 0 }, unsupportedClaimIds: ["c1", "c2"] },
      impactComparison: null,
    };
    const preview = buildFinishPreview([{ user_message: "my turn", assessment: { graph } }], "full");
    expect(preview?.weakness?.headline).toBe("2 important claims had no supporting evidence");
    expect(preview?.weakness?.repairLabel).toBeTruthy();
  });
});
