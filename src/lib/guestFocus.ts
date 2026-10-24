// Guest → account carry-over for the FIRST signed-in coaching focus.
//
// A guest who practised (debate → one weakness → repair) and then signed up
// used to start their account with no focus at all: the carry-over card said
// the weakness "stays today's focus", but the debate was started with no
// coaching dimension, so nothing watched for it. This module decides the
// first signed-in focus from that guest repair.
//
// Measurement honesty (docs/roadmap.md): the guest rep is ONE local,
// unauthenticated practice run. It only pre-selects what the learner's first
// own debate coaches; it is labelled unvalidated, never scored, never written
// to the skill ledger, never a deliberate retest and never an improvement.
// The learner can change it or turn it off. Once the account has any
// completed debate or any ledger point, the account's own evidence decides
// the focus and the guest seed is ignored.
//
// Pure: callers supply the parsed guest summary and the account's state.

import type { CoachDimension } from "./adaptiveCoach";
import { COACH_DIMENSIONS } from "./adaptiveCoach";
import { GOAL_HEADLINES } from "./coachingGoal";
import type { GuestLoopSummary } from "./guestLoop";
import { GUEST_FOCUS_LABEL, NO_FIRST_FOCUS, type FirstFocusView } from "./guestFocusCopy";

export { GUEST_FOCUS_LABEL, LEARNER_FOCUS_LABEL, NO_FIRST_FOCUS } from "./guestFocusCopy";
export type { FirstFocusOption, FirstFocusView } from "./guestFocusCopy";

export type FirstFocusSource = "guest-practice" | "learner-choice";

/**
 * Guest weakness kinds → coach dimensions. Only kinds whose coaching headline
 * honestly describes the guest weakness are mapped. "claim" (the position
 * itself was not explicit) has no coach dimension that measures it, so it
 * seeds nothing rather than being mis-filed under a skill it is not.
 */
const GUEST_KIND_TO_DIMENSION: Record<string, CoachDimension> = {
  reasoning: "logic",
  rebuttal: "rebuttal",
  impact: "impact",
  evidence: "evidence",
};

export function guestKindToDimension(kind: string | null | undefined): CoachDimension | null {
  return kind ? GUEST_KIND_TO_DIMENSION[kind] ?? null : null;
}

/**
 * The guest-seeded focus for the account's first debate, or null.
 *
 * Eligible only while the account has no evidence of its own: no completed
 * debate and no skill-ledger point. `excluded` are skills under silent test
 * (retestDisclosure.ts) — never coached, even from a guest seed.
 */
export function guestSeededFocus(input: {
  guestContext: GuestLoopSummary | null;
  hasCompletedDebate: boolean;
  ledgerPointCount: number;
  excluded?: readonly CoachDimension[];
}): CoachDimension | null {
  const { guestContext, hasCompletedDebate, ledgerPointCount, excluded = [] } = input;
  if (!guestContext || hasCompletedDebate || ledgerPointCount > 0) return null;
  const dimension = guestKindToDimension(guestContext.weaknessKind);
  if (!dimension || excluded.includes(dimension)) return null;
  return dimension;
}

export function isCoachDimension(value: unknown): value is CoachDimension {
  return typeof value === "string" && (COACH_DIMENSIONS as readonly string[]).includes(value);
}

/**
 * Resolve the first debate's focus from the guest seed and the learner's
 * (optional) change. The request is honoured ONLY when a guest seed exists —
 * this is the guest carry-over control, not a general focus override — and
 * a skill under silent test can never be chosen.
 */
export function resolveFirstFocus(input: {
  seeded: CoachDimension | null;
  requested: unknown;
  excluded?: readonly CoachDimension[];
}): { dimension: CoachDimension | null; source: FirstFocusSource | null } {
  const { seeded, requested, excluded = [] } = input;
  if (!seeded) return { dimension: null, source: null };
  if (requested === NO_FIRST_FOCUS) return { dimension: null, source: null };
  if (isCoachDimension(requested) && !excluded.includes(requested)) {
    return { dimension: requested, source: requested === seeded ? "guest-practice" : "learner-choice" };
  }
  return { dimension: seeded, source: "guest-practice" };
}

/** Plain data for the home card's focus picker (client component props). */
export function firstFocusView(
  suggested: CoachDimension | null,
  excluded: readonly CoachDimension[] = [],
): FirstFocusView | null {
  if (!suggested) return null;
  return {
    suggested,
    label: GUEST_FOCUS_LABEL,
    options: COACH_DIMENSIONS.filter((d) => !excluded.includes(d)).map((key) => ({
      key,
      headline: GOAL_HEADLINES[key],
    })),
  };
}

/**
 * The focus that steers TODAY'S MOTION choice. The account's own evidence
 * always wins; only when it names no focus at all (a brand-new account whose
 * first debate will be coached on the guest seed) does the guest seed steer
 * the motion, so the motion offered matches the focus the debate is started
 * with. Same eligibility rule as guestSeededFocus (unvalidated, never scored).
 */
export function motionFocusWithGuestSeed(input: {
  accountFocus: CoachDimension | null;
  guestContext: GuestLoopSummary | null;
  completedDebates: number;
  ledgerPointCount: number;
  excluded?: readonly CoachDimension[];
}): CoachDimension | null {
  if (input.accountFocus) return input.accountFocus;
  return guestSeededFocus({
    guestContext: input.guestContext,
    hasCompletedDebate: input.completedDebates > 0,
    ledgerPointCount: input.ledgerPointCount,
    excluded: input.excluded,
  });
}
