/**
 * What the guest home promises an account adds.
 *
 * Every line here is a promise a first-time visitor reads before signing up,
 * so each one must describe something a new account actually gets today:
 *
 * - PvP is parked behind `NEXT_PUBLIC_EXPERIMENTAL_SURFACES` (docs/status.md),
 *   so it is only advertised when that flag is on. Advertising it with the
 *   flag off sends a new user looking for a feature that is not in the nav.
 * - History is bounded (the list shows the latest debates, not all of them),
 *   so it never claims "every" or "any" past debate.
 * - Skill tracking is real software but an unvalidated instrument
 *   (docs/status.md, "no judge currently passes"), so it never claims to be a
 *   "real skill measurement".
 * - Copy is plain language: no "argument graph", "trajectory" or other
 *   internal vocabulary on the page a casual visitor lands on.
 */
export interface GuestAccountBenefit {
  kicker: string;
  title: string;
  copy: string;
}

export function guestAccountBenefits(experimentalSurfaces: boolean): GuestAccountBenefit[] {
  const benefits: GuestAccountBenefit[] = [
    {
      kicker: "Progress",
      title: "Your progress is kept",
      copy: "Your streak, your skill scores and the weakness you are working on carry over from one day to the next instead of resetting.",
    },
    {
      kicker: "Coaching",
      title: "Tracked across debates",
      copy: "Guest mode shows one weakness from one practice. An account follows the same skill across many debates and tells you how many it is based on. Scores are still early and unvalidated.",
    },
    {
      kicker: "History",
      title: "Look back at recent debates",
      copy: "Reopen your recent debates, reread what you and the opponent said, and see the feedback you got.",
    },
  ];
  if (experimentalSurfaces) {
    benefits.splice(2, 0, {
      kicker: "Player vs Player",
      title: "Debate other people",
      copy: "Take the motion head-to-head against another player and get a judged verdict on the transcript.",
    });
  }
  return benefits;
}
