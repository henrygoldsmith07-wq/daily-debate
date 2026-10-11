// PvP outcome framing: what a finished match may call its result.
//
// The judge that scores PvP verdicts has not cleared the validation gates
// (docs/latest-judge-benchmark.json, config/judge-gates.json). Until one does,
// a match outcome is the judge's reading of ONE debate — not a win, not a
// result, and not a competitive ranking input.
//
// judgeValidation.ts already computes the gate and `allowsCompetitiveClaims`
// is documented as "the single gate the UI reads". Before this module the only
// consumer of that gate was /metrics, an experimental surface filtered out of
// production navigation, while the result screen a player actually lands on
// headlined "You won" / "Opponent won" unconditionally. This is the decision
// that closes that hole, kept pure so it can be pinned by tests.
//
// Honesty rules it must never break:
//   - never hide or suppress the outcome — the judge's reading stays visible
//     with its scores; only the claim of victory is withheld;
//   - a forfeit is a recorded structural outcome, not a judged one, and is
//     described as such;
//   - `competitiveClaimsAllowed === false` covers `unknown` (unreadable
//     artifact) as well as `gated-off` — an unreadable benchmark must never
//     unlock result framing.

export interface PvpOutcomeFramingInput {
  /** The match's recorded winner, or null when there is none. */
  winnerId: string | null;
  currentUserId: string;
  /** Display name resolver for the winner's player id. */
  nameFor: (playerId: string) => string;
  /** True only when a benchmarked model cleared every validation gate. */
  competitiveClaimsAllowed: boolean;
  /**
   * True when the verdict is an explicit insufficient_evidence structural
   * outcome (a forfeit) rather than a judged score.
   */
  isForfeit: boolean;
  /** True when the judge could not separate the two cases. */
  isTie: boolean;
}

export interface PvpOutcomeFraming {
  /** The headline the result screen may show. */
  headline: string;
  /**
   * One sentence stating what actually produced this outcome, or null when
   * the outcome needs no qualifying explanation.
   */
  attribution: string | null;
}

export function framePvpOutcome(input: PvpOutcomeFramingInput): PvpOutcomeFraming {
  const { winnerId, currentUserId, nameFor, competitiveClaimsAllowed, isForfeit, isTie } = input;

  if (winnerId === null) {
    return {
      headline: isTie ? "Too close to call" : "Tie",
      attribution: null,
    };
  }

  const iWon = winnerId === currentUserId;
  const winnerName = winnerId === currentUserId ? "you" : nameFor(winnerId);

  // A forfeit is not a judgement about either case: the opponent simply did not
  // move. Naming it plainly keeps it honest whether or not competitive claims
  // are unlocked, and it must never be presented as the judge's decision.
  if (isForfeit) {
    return {
      headline: competitiveClaimsAllowed ? "Won by forfeit" : "Match completed by forfeit",
      attribution:
        "The other player did not respond within the abandon window. No judge score was produced and no points were awarded.",
    };
  }

  if (competitiveClaimsAllowed) {
    return {
      headline: iWon ? "You won" : `${nameFor(winnerId)} won`,
      attribution: null,
    };
  }

  return {
    headline: "Judge outcome",
    attribution: `The judge scored this debate for ${winnerName}.`,
  };
}
