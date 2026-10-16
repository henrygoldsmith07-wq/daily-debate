import { describe, it, expect } from "vitest";
import { healthMemoFresh } from "./route";

describe("healthMemoFresh", () => {
  it("treats a fresh cache as fresh regardless of the request clock reading", () => {
    // Regression pin: the memo used to compare the cached ISO timestamp
    // against the current request's ISO timestamp (millisecond precision),
    // which could never be equal — so the memo never hit and every
    // /api/health request paid the full DB + GitHub scan.
    expect(healthMemoFresh(1_000, 1_000)).toBe(true);
    expect(healthMemoFresh(1_000, 15_999)).toBe(true);
  });

  it("expires at the memo boundary", () => {
    expect(healthMemoFresh(1_000, 16_000)).toBe(false);
    expect(healthMemoFresh(1_000, 60_000)).toBe(false);
  });
});
