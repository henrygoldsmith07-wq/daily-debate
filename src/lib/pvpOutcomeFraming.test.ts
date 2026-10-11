import { describe, expect, it } from "vitest";

import { framePvpOutcome, type PvpOutcomeFramingInput } from "./pvpOutcomeFraming";

// The judge that scores PvP has not cleared the validation gates, so a match
// outcome is the judge's reading of one debate — not a win. These tests pin
// that wording contract, because the result screen a player actually lands on
// used to headline "You won" / "Opponent won" with no reference to the
// validation state at all.

const NAMES = (id: string) => (id === "me" ? "Me" : id === "them" ? "Them" : id);

function input(overrides: Partial<PvpOutcomeFramingInput> = {}): PvpOutcomeFramingInput {
  return {
    winnerId: "me",
    currentUserId: "me",
    nameFor: (id) => NAMES(id),
    competitiveClaimsAllowed: false,
    isForfeit: false,
    isTie: false,
    ...overrides,
  };
}

describe("pvpOutcomeFraming — competitive claims withheld", () => {
  it("does not claim victory for the player the judge scored as ahead", () => {
    const result = framePvpOutcome(input({ winnerId: "me" }));
    expect(result.headline).toBe("Judge outcome");
    expect(result.headline.toLowerCase()).not.toContain("won");
    expect(result.attribution).toBe("The judge scored this debate for you.");
  });

  it("does not claim victory against the player either", () => {
    const result = framePvpOutcome(input({ winnerId: "them" }));
    expect(result.headline).toBe("Judge outcome");
    expect(result.attribution).toBe("The judge scored this debate for Them.");
  });

  it("attributes the reading to the judge rather than asserting a result", () => {
    const result = framePvpOutcome(input({ winnerId: "me" }));
    expect(result.attribution).toContain("The judge scored");
    // The outcome itself is never hidden — it stays visible and specific.
    expect(result.attribution).toContain("for you");
  });

  it("still reports a tie without win framing", () => {
    expect(framePvpOutcome(input({ winnerId: null, isTie: true }))).toEqual({
      headline: "Too close to call",
      attribution: null,
    });
    expect(framePvpOutcome(input({ winnerId: null, isTie: false }))).toEqual({
      headline: "Tie",
      attribution: null,
    });
  });
});

describe("pvpOutcomeFraming — forfeit is a structural outcome, not a verdict", () => {
  it("names the forfeit and states no judge score existed", () => {
    const result = framePvpOutcome(input({ winnerId: "me", isForfeit: true }));
    expect(result.headline).toBe("Match completed by forfeit");
    expect(result.attribution).toContain("No judge score was produced");
    expect(result.attribution).toContain("no points were awarded");
  });

  it("does not attribute a forfeit to the judge", () => {
    const result = framePvpOutcome(input({ winnerId: "me", isForfeit: true }));
    expect(result.attribution).not.toContain("The judge scored");
  });

  it("uses forfeit framing for either outcome, withheld or not", () => {
    for (const competitiveClaimsAllowed of [false, true]) {
      const result = framePvpOutcome(input({ winnerId: "them", isForfeit: true, competitiveClaimsAllowed }));
      expect(result.attribution).toContain("No judge score was produced");
    }
  });
});

describe("pvpOutcomeFraming — validated judge", () => {
  it("restores ordinary win framing only once every gate is cleared", () => {
    expect(framePvpOutcome(input({ winnerId: "me", competitiveClaimsAllowed: true }))).toEqual({
      headline: "You won",
      attribution: null,
    });
    expect(framePvpOutcome(input({ winnerId: "them", competitiveClaimsAllowed: true }))).toEqual({
      headline: "Them won",
      attribution: null,
    });
  });

  it("does not attach a withheld-claims caveat to a validated result", () => {
    const result = framePvpOutcome(input({ winnerId: "me", competitiveClaimsAllowed: true }));
    expect(result.attribution).toBeNull();
  });
});
