import { describe, expect, it } from "vitest";
import { buildFinishPreview } from "./finishPreview";

describe("buildFinishPreview", () => {
  it("returns null when no answered turn has an assessment", () => {
    expect(buildFinishPreview([], "full")).toBeNull();
    expect(buildFinishPreview([{ user_message: "hi", assessment: null }], "full")).toBeNull();
    expect(buildFinishPreview([{ user_message: null, assessment: { graph: {} } }], "full")).toBeNull();
  });
});
