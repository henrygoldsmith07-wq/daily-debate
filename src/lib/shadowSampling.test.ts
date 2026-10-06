import { describe, expect, it } from "vitest";
import {
  SHADOW_SAMPLE_ENV_VAR,
  SHADOW_SAMPLE_RATE_DEFAULT,
  resolveShadowSampleRate,
  shadowSampleBucket,
  shadowSampleDecision,
} from "./shadowSampling";

describe("shadow sampling", () => {
  it("defaults to a quarter of debates and reads the env override", () => {
    expect(SHADOW_SAMPLE_RATE_DEFAULT).toBe(0.25);
    expect(SHADOW_SAMPLE_ENV_VAR).toBe("CLASSIFIER_SHADOW_SAMPLE_RATE");
    expect(resolveShadowSampleRate(undefined)).toBe(0.25);
    expect(resolveShadowSampleRate("")).toBe(0.25);
    expect(resolveShadowSampleRate("0.5")).toBe(0.5);
    expect(resolveShadowSampleRate("0")).toBe(0);
    expect(resolveShadowSampleRate("1")).toBe(1);
    expect(resolveShadowSampleRate("2")).toBe(1);
    expect(resolveShadowSampleRate("-0.1")).toBe(0);
    // Unparseable fails open to classify-all, never to a silent traffic change.
    expect(resolveShadowSampleRate("quarter")).toBe(1);
  });

  it("is deterministic per key and stable across calls", () => {
    const first = shadowSampleDecision("match-abc-123", 0.25);
    const second = shadowSampleDecision("match-abc-123", 0.25);
    expect(second).toEqual(first);
    expect(first.key).toBe("match-abc-123");
    expect(first.rate).toBe(0.25);
  });

  it("hits the rate boundaries exactly without hashing", () => {
    expect(shadowSampleDecision("any-key", 1).sampled).toBe(true);
    expect(shadowSampleDecision("any-key", 0).sampled).toBe(false);
    // No key means no identity to sample on: never selected remotely.
    expect(shadowSampleDecision("", 0.25).sampled).toBe(false);
    expect(shadowSampleDecision("", 1).sampled).toBe(true);
  });

  it("buckets keys uniformly in [0, 1)", () => {
    const buckets = Array.from({ length: 2_000 }, (_, i) => shadowSampleBucket(`match-${i}`));
    expect(buckets.every((b) => b >= 0 && b < 1)).toBe(true);
    const mean = buckets.reduce((s, b) => s + b, 0) / buckets.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });

  it("samples close to the configured rate over many keys", () => {
    for (const rate of [0.1, 0.25, 0.5]) {
      const sampled = Array.from({ length: 4_000 }, (_, i) => shadowSampleDecision(`debate-${rate}-${i}`, rate).sampled)
        .filter(Boolean).length / 4_000;
      expect(Math.abs(sampled - rate)).toBeLessThan(0.03);
    }
  });

  it("a higher rate is a superset of a lower rate for the same keys (nested samples)", () => {
    // Nested samples keep historical comparisons fair: raising the rate only
    // ever ADDS debates, it never swaps the sample composition.
    for (let i = 0; i < 500; i++) {
      const key = `nested-${i}`;
      const low = shadowSampleDecision(key, 0.25).sampled;
      const high = shadowSampleDecision(key, 0.5).sampled;
      if (low) expect(high).toBe(true);
    }
  });
});
