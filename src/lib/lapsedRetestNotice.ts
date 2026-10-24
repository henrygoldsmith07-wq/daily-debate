// Honest copy for a retest that expired without ever getting a valid
// opportunity. It is neither a pass nor a failure and is never scored; the
// skill is no longer under silent test, so naming it breaks no disclosure rule
// (retestDisclosure.ts governs only PENDING retests).
export function lapsedRetestNotice(skillLabel: string, count: number): string {
  const more = count > 1 ? ` (and ${count - 1} other${count > 2 ? "s" : ""})` : "";
  return `Your ${skillLabel} repair${more} was never tested: no debate in two weeks gave a valid chance to use it, so the retest is closed as insufficient evidence, not a pass or a fail. It does not count toward your progress. Repair it again from a debate result whenever you like.`;
}
