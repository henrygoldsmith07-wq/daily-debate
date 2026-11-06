import { describe, expect, it } from "vitest";
import { rematchOptions } from "./rematch";

describe("rematchOptions", () => {
  it("offers the other side at the same difficulty, and one step harder", () => {
    expect(rematchOptions("for", "easy")).toEqual([
      { id: "other_side", label: "Argue the other side (Against)", side: "against", difficulty: "easy" },
      { id: "harder", label: "Rematch, harder (Challenging)", side: "for", difficulty: "challenging" },
    ]);
    expect(rematchOptions("against", "challenging")[1]).toMatchObject({ side: "against", difficulty: "expert", label: "Rematch, harder (Expert)" });
  });

  it("has nothing harder than expert", () => {
    expect(rematchOptions("against", "expert")).toEqual([
      { id: "other_side", label: "Argue the other side (For)", side: "for", difficulty: "expert" },
    ]);
  });
});
