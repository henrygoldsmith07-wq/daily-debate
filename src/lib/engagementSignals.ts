// Engagement signals — the surface patterns that say "this answer engages the
// move the opponent actually made".
//
// The `clarity` coach dimension and the `clarity` repair kind both back the
// ENGAGEMENT metric (the per-round argumentResponses rate: did the side
// validly answer at least one of the opponent's moves on the round they were
// made). Before this module both sites scored sentence-length readability
// instead, which no product metric observes — so a drill or repair could never
// move the score it was supposed to train.
//
// This module is deliberately dependency-free so both `adaptiveCoach.ts` (the
// drill rubric) and `argumentRepair.ts` (the repair rubric) can share one
// definition without an import cycle. `types.ts` already imports
// `argumentRepair`, and `adaptiveCoach` reaches `types` through `skillLedger`.

/**
 * Does the text explicitly name the opposing move it is answering?
 *
 * These markers are deliberately narrow: they require a reference to the
 * OTHER side's argument, not merely a contrastive conjunction. "However, my
 * policy is better" engages nothing; "their claim assumes a fixed budget"
 * engages a specific move.
 */
export const NAMES_OPPOSING_MOVE_RE =
  /\b(their (?:claim|argument|point|mechanism|assumption|objection|concern|case|evidence|position)|that (?:claim|argument|point|objection|assumption|concern)|the (?:objection|claim|argument|concern|counterargument)|you (?:say|argue|claim|suggest)|this assumes|as they put it|the opposing (?:claim|argument|case|view))\b/i;

/**
 * Does the text explain why the answer to that move follows?
 *
 * The engagement metric requires a VALID answer, not just a mention of the
 * opposing move, so the rewrite must also carry the reasoning step.
 */
export const EXPLAINS_ANSWER_RE =
  /\b(because|since|therefore|which means|this means|as a result|leads? to|results? in|so that|does not hold|does not follow|does not settle|fails|misses|overlooks|ignores|assumes|even if|granting)\b/i;

export interface EngagementReading {
  /** The response named the move it is answering. */
  namesMove: boolean;
  /** The response explains why its answer follows. */
  explainsAnswer: boolean;
  /** Both — the minimum for a defensible engagement move. */
  engaged: boolean;
}

/**
 * Read the two engagement signals out of one piece of text.
 *
 * Honest by construction: this is a surface proxy for "answered the move",
 * not the measurement itself. The metric reads the argument graph; this reads
 * the words a learner typed in a 2–3 minute drill, and every caller labels the
 * result formative practice rather than a skill score.
 */
export function readEngagementSignals(text: string): EngagementReading {
  const namesMove = NAMES_OPPOSING_MOVE_RE.test(text);
  const explainsAnswer = EXPLAINS_ANSWER_RE.test(text);
  return { namesMove, explainsAnswer, engaged: namesMove && explainsAnswer };
}
