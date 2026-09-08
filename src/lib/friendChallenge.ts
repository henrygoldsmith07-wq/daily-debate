// Async friend challenges — foundation for shareable, turn-based matches.
//
// A challenge is a pre-created PvP match with a shareable invite code. The
// challenger opens a match against a placeholder seat; the friend accepts the
// link later (no simultaneity requirement), takes the opposite side, and both
// play through the normal PvP turn system. Pure helpers here; routes persist.

import type { DebateSide } from "./types";

export const CHALLENGE_EXPIRY_DAYS = 7;

/** URL-safe, unambiguous invite code (no 0/O, 1/I/l). */
const CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

export function generateChallengeCode(random: () => number = Math.random): string {
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return code;
}

export function isValidChallengeCode(value: unknown): value is string {
  return typeof value === "string" && /^[2-9a-hj-km-np-z]{6,32}$/.test(value);
}

export function challengeExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + CHALLENGE_EXPIRY_DAYS * 24 * 60 * 60_000);
}

export function opponentSideOf(side: DebateSide | string): DebateSide {
  return side === "for" ? "against" : "for";
}

export interface ChallengeTurnState {
  status: "open" | "accepted" | "expired" | "cancelled";
  expiresAt: string;
  accepted: boolean;
  /** Plain-language state for the recipient. */
  turnNote: string;
}

/** Human turn-state for the invite page — honest about expiry. */
export function describeChallengeState(
  status: string,
  expiresAt: string,
  currentTurnPlayer: string | null,
  viewerId: string | null,
  challengerName: string,
  now: Date = new Date(),
): ChallengeTurnState {
  const expired = new Date(expiresAt).getTime() < now.getTime();
  if (status === "cancelled") {
    return { status: "cancelled", expiresAt, accepted: false, turnNote: "This challenge was cancelled." };
  }
  if (expired || status === "expired") {
    return { status: "expired", expiresAt, accepted: false, turnNote: "This challenge has expired." };
  }
  if (status === "open") {
    return {
      status: "open",
      expiresAt,
      accepted: false,
      turnNote: `${challengerName} has made their opening argument. Accept to respond — you have until ${new Date(expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}.`,
    };
  }
  // accepted / in progress
  if (currentTurnPlayer && viewerId && currentTurnPlayer === viewerId) {
    return { status: "accepted", expiresAt, accepted: true, turnNote: "Your move — it's your turn to argue." };
  }
  if (currentTurnPlayer) {
    return { status: "accepted", expiresAt, accepted: true, turnNote: `Waiting on ${challengerName === "your opponent" ? "them" : "your opponent"} to make their move.` };
  }
  return { status: "accepted", expiresAt, accepted: true, turnNote: "The match is in progress." };
}
