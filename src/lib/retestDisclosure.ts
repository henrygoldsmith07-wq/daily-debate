// THE DISCLOSURE POLICY.
//
// A deliberate retest is a MEASUREMENT, and a measurement the subject can see
// is not a measurement.
//
// Daily Debate's only durable advantage over every AI debate-practice product
// surveyed for the product audit is the closed loop: find one weakness, repair
// it, then find out whether the repair transfers when the learner is NOT told
// what to watch for. That advantage exists only if the retest is genuinely
// un-signalled.
//
// The product's own copy already promised this — "no reminder, no cue"
// (retest.ts), "use it without a cue and the loop closes" (loopThread.ts),
// "Only a later, unprompted, different-topic debate closes the loop"
// (learnerModel.ts) — while every pre-debate surface named the skill under
// test, printed that skill's instruction as the day's coaching goal, and
// announced that today was the test. The claim and the implementation
// disagreed, and the disagreement was the defect.
//
// This module states the rule once, so the rule can be TESTED instead of
// asserted:
//
//   While a deliberate retest is pending, no PRE-DEBATE surface may
//   (1) name the skill under test,
//   (2) give that skill's instruction or observable as the day's coaching,
//   (3) tie the test to a specific debate or a specific day.
//
// The method itself stays public. "A repair is waiting to be tested" is not a
// cue: it says what the product is for, it names no skill, and it tells the
// learner nothing they could not work out from their own memory. A loop the
// learner cannot see is a loop the learner cannot value — so the product says
// that a loop is open, and says nothing about what to watch for.
//
// How the rule is enforced:
//   - the skill under test is EXCLUDED from the visible coaching focus, so the
//     learner is coached on a different skill (the Khan model: a mixed-skill
//     session in which one skill is silently assessed) and an ordinary day
//     looks like an ordinary day;
//   - the announcing copy is replaced by copy that states the loop without
//     stating the skill or the day;
//   - the live-coaching hints that cue the skill under test are suppressed for
//     the duration of the retest debate (liveCoaching.ts);
//   - the verdict is revealed after the debate, in the result card.
//
// THE HONEST LIMIT: the product controls what it SHOWS, not what the learner
// remembers. A learner who knows what they repaired can combine "a loop is
// open" with their own memory and guess that a given debate is the test. The
// product cannot remove that knowledge, and no claim in the product may
// pretend otherwise. What it guarantees — and what the copy says — is that it
// gives no instruction for that skill, never names that skill before the
// debate, and never ties the test to a day. The product claims "without a
// prompt", not "unprompted".

import type { CoachDimension } from "./adaptiveCoach";

/** What the product is allowed to know about, but not to say, before a debate. */
export interface RetestDisclosure {
  /**
   * The skill currently under silent test. Never rendered on a pre-debate
   * surface; revealed only after the debate it belongs to.
   */
  skillUnderTest: CoachDimension | null;
}

/** The disclosure state for a given skill under test (null = none pending). */
export function retestDisclosureFor(
  skillUnderTest: CoachDimension | null | undefined,
): RetestDisclosure {
  return { skillUnderTest: skillUnderTest ?? null };
}

/** True when this dimension is the skill currently under silent test. */
export function isUnderTest(
  dimension: CoachDimension | null | undefined,
  disclosure: RetestDisclosure | null | undefined,
): boolean {
  if (!dimension || !disclosure?.skillUnderTest) return false;
  return dimension === disclosure.skillUnderTest;
}

/**
 * The skill a pending deliberate retest is measuring.
 *
 * This is the OLDEST PENDING retest, not the oldest *topic-eligible* one.
 *
 * A pre-debate surface cannot know the final motion, and the eligible retest
 * depends on it: when the day's motion is the very topic the learner
 * repaired, the app retargets the motion to a different topic so the debate
 * can carry the test. Excluding only the topic-eligible retest would
 * therefore leak the skill on exactly the day the retest is about to happen.
 *
 * Over-excluding is the safe direction: a pending retest means the skill is
 * being measured, so it must not be named or coached, and every focus
 * selector falls back to the next real weakness rather than to nothing.
 *
 * `pending` must be ordered oldest-first, which is how the server orders it
 * (`pendingRepairRetests` sorts by attempt time).
 */
export function skillUnderTest(
  pending: ReadonlyArray<{ dimension: CoachDimension }> | null | undefined,
): CoachDimension | null {
  return pending?.[0]?.dimension ?? null;
}

/**
 * Copy used wherever the product used to announce that a retest was due.
 * It states the loop without stating the skill or the day.
 */
export const RETEST_PENDING_HEADLINE = "Loop open: a repair is waiting to be tested.";
export const RETEST_PENDING_DETAIL =
  "A repair is practice, not proof. A later debate, on a different topic, is the test — and the skill and the day are never signposted.";

/**
 * The product's actual guarantee, in the words the learner sees.
 *
 * It is deliberately narrower than "unprompted": the product controls what it
 * SHOWS, not what the learner remembers. It never shows an instruction for the
 * skill under test, never names that skill before the debate, and never ties
 * the test to a day or a specific debate.
 */
export const RETEST_GUARANTEE = "the skill and the day are never signposted";

/**
 * The title of the single "continue training" card on a day when a retest is
 * pending. It keeps the loop visible without naming the skill under test and
 * without announcing that today is the test day.
 */
export const RETEST_PENDING_CARD_TITLE = "A repair is waiting to be tested.";

/**
 * The goal line used when no dimension can be focused. Deliberately
 * skill-agnostic, so it can never cue a skill that is under silent test.
 */
export const NEUTRAL_GOAL_LINE = "Make the strongest case you can for your side.";

/**
 * The reason shown when the day's motion is a different topic from the one the
 * learner repaired. Honest (it IS a different motion) and non-announcing: it
 * does not say a transfer test is happening.
 */
export const RETEST_MOTION_REASON =
  "A different motion today, so you meet a fresh argument instead of re-running your last one.";
