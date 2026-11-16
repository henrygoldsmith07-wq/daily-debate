/** Kicker for the "Continue training" card. A pending retest is the loop's payoff, so it leads as a hero. */
export function continueKicker(kind: string): string {
  return kind === "retest" ? "Your retest is ready" : "Continue training";
}

export function isRetestHero(kind: string): boolean {
  return kind === "retest";
}
