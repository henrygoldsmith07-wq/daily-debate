import { describe, expect, it } from "vitest";
import { anthropicCallCostUsd, anthropicReservationUsd } from "./anthropicPricing";

describe("anthropicCallCostUsd", () => {
  it("prices the pinned default model from token usage", () => {
    // claude-sonnet-5: $2 / $10 per MTok.
    expect(anthropicCallCostUsd("claude-sonnet-5", 1_000_000, 0)).toBeCloseTo(2);
    expect(anthropicCallCostUsd("claude-sonnet-5", 6_000, 4_096)).toBeCloseTo(0.012 + 0.04096);
  });

  it("does not let a shorter id shadow a longer one", () => {
    expect(anthropicCallCostUsd("claude-opus-5-5", 0, 1_000_000)).toBeCloseTo(20);
    expect(anthropicCallCostUsd("claude-opus-5", 0, 1_000_000)).toBeCloseTo(25);
  });

  it("resolves dated snapshot ids to their family", () => {
    expect(anthropicCallCostUsd("claude-haiku-4-5-20251001", 1_000_000, 0)).toBeCloseTo(1);
  });

  it("returns undefined for unpriced models or missing usage so the declared charge applies", () => {
    expect(anthropicCallCostUsd("claude-unknown-9", 100, 100)).toBeUndefined();
    expect(anthropicCallCostUsd("claude-sonnet-5", undefined, 100)).toBeUndefined();
    expect(anthropicCallCostUsd("claude-sonnet-5-foo", 100, 100)).toBeCloseTo(0.0012);
    expect(anthropicCallCostUsd("claude-sonnet-50", 100, 100)).toBeUndefined();
  });
});

describe("anthropicReservationUsd", () => {
  it("reserves the max_tokens worst case, never below the fallback", () => {
    expect(anthropicReservationUsd("claude-sonnet-5", 4096, 0.02)).toBeCloseTo(0.04096);
    expect(anthropicReservationUsd("claude-sonnet-5", 512, 0.02)).toBe(0.02);
    expect(anthropicReservationUsd("claude-unknown-9", 4096, 0.02)).toBe(0.02);
  });
});
