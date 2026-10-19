import { describe, expect, it } from "vitest";
import { guestChallengeSide } from "./guestSide";

describe("guestChallengeSide", () => {
  it("is stable within a UTC day", () => {
    const a = guestChallengeSide(new Date("2026-10-19T00:00:00Z"));
    expect(guestChallengeSide(new Date("2026-10-19T23:59:00Z"))).toBe(a);
  });
  it("alternates between consecutive days", () => {
    const a = guestChallengeSide(new Date("2026-10-19T12:00:00Z"));
    const b = guestChallengeSide(new Date("2026-10-20T12:00:00Z"));
    expect(a).not.toBe(b);
  });
});
