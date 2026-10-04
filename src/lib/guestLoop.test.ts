import { describe, expect, it } from "vitest";
import { encodeGuestLoopSummary, parseGuestLoopSummary, type GuestLoopSummary } from "./guestLoop";

const valid: GuestLoopSummary = {
  motion: "Should every school day include a phone-free hour?",
  weaknessKind: "evidence",
  weaknessLabel: "Unsupported claim",
  repairState: "repair_demonstrated",
  repairSucceeded: true,
  retestOutcome: "observed",
  completedAt: "2026-10-04T00:00:00.000Z",
};

describe("parseGuestLoopSummary", () => {
  it("accepts a well-formed payload from either shape", () => {
    expect(parseGuestLoopSummary(valid)).not.toBeNull();
    expect(parseGuestLoopSummary(encodeGuestLoopSummary(valid))).toEqual(valid);
  });

  it("drops payloads with invalid enum values", () => {
    expect(parseGuestLoopSummary({ ...valid, weaknessKind: "pvp" })).toBeNull();
    expect(parseGuestLoopSummary({ ...valid, repairState: "mastered" })).toBeNull();
    expect(parseGuestLoopSummary({ ...valid, retestOutcome: "mastery" })).toBeNull();
  });

  it("drops malformed JSON and non-objects", () => {
    expect(parseGuestLoopSummary("{not json")).toBeNull();
    expect(parseGuestLoopSummary(42)).toBeNull();
    expect(parseGuestLoopSummary(null)).toBeNull();
  });

  it("bounds free-text fields and tolerates missing ones", () => {
    const longMotion = "m".repeat(5000);
    const parsed = parseGuestLoopSummary({ ...valid, motion: longMotion, weaknessLabel: 7 });
    expect(parsed).not.toBeNull();
    expect(parsed!.motion.length).toBe(200);
    expect(parsed!.weaknessLabel).toBe("");
    expect(parsed!.completedAt).toMatch(/^\d{4}-/);
  });

  it("drops payloads over the wire-size cap", () => {
    expect(parseGuestLoopSummary("x".repeat(4001))).toBeNull();
  });
});
