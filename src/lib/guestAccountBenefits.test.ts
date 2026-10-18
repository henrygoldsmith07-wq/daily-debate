import { describe, expect, it } from "vitest";
import { guestAccountBenefits } from "./guestAccountBenefits";

// The guest home's "With an account" cards are promises a first-time visitor
// reads before signing up. They must match what a new account gets today.

describe("guestAccountBenefits", () => {
  it("does not advertise parked PvP when the experimental flag is off", () => {
    const text = JSON.stringify(guestAccountBenefits(false)).toLowerCase();
    expect(text).not.toContain("player vs player");
    expect(text).not.toContain("other people");
    expect(text).not.toContain("another player");
  });

  it("advertises PvP only when the experimental flag is on", () => {
    const kickers = guestAccountBenefits(true).map((b) => b.kicker);
    expect(kickers).toContain("Player vs Player");
  });

  it("never claims validated measurement or unbounded history", () => {
    for (const flag of [false, true]) {
      const text = JSON.stringify(guestAccountBenefits(flag)).toLowerCase();
      // docs/status.md: no judge currently passes the gates.
      expect(text).not.toContain("real skill measurement");
      // History lists the latest debates, not all of them.
      expect(text).not.toMatch(/\bevery (rep|debate)\b/);
      expect(text).not.toContain("any past debate");
    }
  });

  it("keeps internal jargon off the guest page", () => {
    const text = JSON.stringify(guestAccountBenefits(true)).toLowerCase();
    expect(text).not.toContain("argument graph");
    expect(text).not.toContain("trajectory");
  });
});
