import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { pairsFromCoaching } from "./phraseReuseServer";

describe("pairsFromCoaching", () => {
  it("counts only debates with a comparison and flags reuse", () => {
    const pairs = pairsFromCoaching([
      { coaching: { retestOutcome: { comparison: { reusedPhrases: ["a b c"] } } } },
      { coaching: { retestOutcome: { comparison: {} } } },
      { coaching: { retestOutcome: {} } },
      { coaching: null },
    ]);
    expect(pairs).toEqual([{ reused: true }, { reused: false }]);
  });
});
