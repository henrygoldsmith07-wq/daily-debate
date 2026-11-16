import { describe, expect, it } from "vitest";
import { raterLabelsInOrder } from "./corpusRaterAnonymity";

describe("raterLabelsInOrder", () => {
  it("labels distinct raters Rater 1..N in submission order", () => {
    const labels = raterLabelsInOrder(["user-b", "user-a", "user-b", "user-c"]);
    expect(labels.get("user-b")).toBe("Rater 1");
    expect(labels.get("user-a")).toBe("Rater 2");
    expect(labels.get("user-c")).toBe("Rater 3");
  });

  it("never emits an account id as a label", () => {
    const labels = raterLabelsInOrder(["11111111-1111-4111-8111-111111111111"]);
    expect([...labels.values()]).toEqual(["Rater 1"]);
  });
});
