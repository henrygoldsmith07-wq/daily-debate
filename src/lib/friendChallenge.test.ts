import { describe, expect, it } from "vitest";
import {
  challengeExpiry,
  CHALLENGE_EXPIRY_DAYS,
  describeChallengeState,
  effectiveInviteStatus,
  generateChallengeCode,
  isValidChallengeCode,
  opponentSideOf,
} from "./friendChallenge";

// `describeChallengeState` had no tests at all while it sat unimported. It is
// now the single source of the invite page's turn-state copy, so its expiry
// rule and its turn-awareness are pinned here.

const NOW = new Date("2026-10-14T12:00:00Z");
const FUTURE = new Date(NOW.getTime() + 3 * 86_400_000).toISOString();
const PAST = new Date(NOW.getTime() - 3 * 86_400_000).toISOString();

describe("describeChallengeState", () => {
  it("tells an open recipient that the challenger opened the argument, and by when", () => {
    const state = describeChallengeState("open", FUTURE, null, "viewer", "Ada", NOW);
    expect(state.status).toBe("open");
    expect(state.accepted).toBe(false);
    expect(state.turnNote).toBe("Ada has made their opening argument. Accept to respond — you have until 17 Oct.");
  });

  it("expires an OPEN invite past its window", () => {
    const state = describeChallengeState("open", PAST, null, "viewer", "Ada", NOW);
    expect(state.status).toBe("expired");
    expect(state.turnNote).toBe("This challenge has expired.");
  });

  // The database never flips an accepted invite to expired
  // (`where status = 'open' and expires_at <= now()`), so neither may this.
  // Labelling a live match's participant "expired" would be a dead end.
  it("does NOT expire an ACCEPTED challenge past its invite window", () => {
    const state = describeChallengeState("accepted", PAST, "someone", "viewer", "Ada", NOW);
    expect(state.status).toBe("accepted");
    expect(state.accepted).toBe(true);
    expect(state.turnNote).not.toMatch(/expired/i);
  });

  it("respects an explicit expired status regardless of the clock", () => {
    const state = describeChallengeState("expired", FUTURE, null, "viewer", "Ada", NOW);
    expect(state.status).toBe("expired");
  });

  it("reports a cancelled challenge as cancelled", () => {
    const state = describeChallengeState("cancelled", FUTURE, null, "viewer", "Ada", NOW);
    expect(state.status).toBe("cancelled");
    expect(state.turnNote).toBe("This challenge was cancelled.");
  });

  it("says whose move it is in an accepted match", () => {
    const mine = describeChallengeState("accepted", FUTURE, "me", "me", "Ada", NOW);
    expect(mine.turnNote).toBe("Your move — it's your turn to argue.");
    const theirs = describeChallengeState("accepted", FUTURE, "them", "me", "Ada", NOW);
    expect(theirs.turnNote).toBe("Waiting on your opponent to make their move.");
  });

  it("falls back to a neutral in-progress line when no turn is recorded", () => {
    const state = describeChallengeState("accepted", FUTURE, null, "me", "Ada", NOW);
    expect(state.turnNote).toBe("The match is in progress.");
  });
});

describe("challenge codes", () => {
  it("generates codes the validator accepts, over the whole alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateChallengeCode(() => i % 31);
      expect(code).toHaveLength(12);
      expect(isValidChallengeCode(code)).toBe(true);
    }
  });

  it("rejects codes with ambiguous characters or the wrong shape", () => {
    for (const bad of ["0", "O", "1", "I", "l", "", "abc", "abc123", "a".repeat(33), "ABCdefghi123"]) {
      expect(isValidChallengeCode(bad)).toBe(false);
    }
    expect(isValidChallengeCode(null)).toBe(false);
    expect(isValidChallengeCode(12)).toBe(false);
  });

  it("mirrors the side", () => {
    expect(opponentSideOf("for")).toBe("against");
    expect(opponentSideOf("against")).toBe("for");
    // Anything unrecognised is treated as "against".
    expect(opponentSideOf("nonsense")).toBe("for");
  });

  it("puts the expiry a fixed number of days out", () => {
    const expiry = challengeExpiry(NOW);
    expect(expiry.getTime() - NOW.getTime()).toBe(CHALLENGE_EXPIRY_DAYS * 86_400_000);
  });
});

describe("effectiveInviteStatus", () => {
  const now = new Date("2026-10-26T12:00:00Z");
  it("lapses only open invites past expiry", () => {
    expect(effectiveInviteStatus("open", "2026-10-26T11:59:00Z", now)).toBe("expired");
    expect(effectiveInviteStatus("open", "2026-10-27T00:00:00Z", now)).toBe("open");
    expect(effectiveInviteStatus("accepted", "2026-10-01T00:00:00Z", now)).toBe("accepted");
    expect(effectiveInviteStatus("cancelled", "2026-10-01T00:00:00Z", now)).toBe("cancelled");
  });
  it("fails closed on an unparseable expiry", () => {
    expect(effectiveInviteStatus("open", "garbage", now)).toBe("expired");
  });
});
