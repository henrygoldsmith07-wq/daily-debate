// Today's single priority action — one unfinished learning action, chosen
// deliberately. Users must never unknowingly abandon a learning episode, and
// Today must never show several competing resume cards.
//
// Priority order (product rule):
//   1. unresolved repair  (a finished debate with a weakness and no repair)
//   2. due repair retest  (a successful repair whose deliberate retest hasn't run)
//   3. active drill       (today's assignment, unattempted)
//   4. today's normal debate
//
// Pure — the Today page feeds it rows and renders the single winner.
//
// A pending retest changes the ORDER (the debate stays at the top of the
// queue) but not the COPY: naming the skill under test, or announcing that
// today is the test, would prompt the behaviour the retest is meant to
// measure. See retestDisclosure.ts.

import { RETEST_PENDING_CARD_TITLE } from "./retestDisclosure";

export type PriorityKind = "repair" | "retest" | "drill" | "debate";

export interface PriorityInputs {
  /** A debate whose weakness is not yet successfully repaired. */
  unfinishedRepair: {
    debateId: string;
    label: string;
    nextCue: string | null;
  } | null;
  /** A successful repair whose deliberate retest is due on a different topic. */
  dueRetest: {
    label: string;
    /**
     * When the repaired rewrite was completed (the repair_results.created_at the
     * retest anchors to). Optional: when present, the priority detail can say how
     * long the retest has been waiting so the nudge is auditable rather than
     * arbitrary. Callers that omit it (e.g. synthetic test inputs) get the
     * existing label-only detail, unchanged.
     */
    attemptedAt?: string | null;
  } | null;
  /** Today's drill assignment, when unattempted. */
  openDrill: {
    title: string;
    /**
     * Drill minutes and the exact prompt, when the caller holds the full
     * assignment row. Optional so existing synthetic/test inputs keep the
     * label-only detail; when present the dashboard can render the drill
     * inline instead of sending the user elsewhere first.
     */
    minutes?: number;
    prompt?: string;
    /** Assignment id, when the caller wants the attempt to submit inline. */
    assignmentId?: string;
  } | null;
  /** Whether today's debate still awaits the user. */
  debateAvailable: boolean;
}

export interface PriorityAction {
  kind: PriorityKind;
  /** One-line headline for the Continue training card. */
  title: string;
  /** What the user will do, in one sentence. */
  detail: string;
  /** Call-to-action label. */
  action: string;
  /** Where the action goes: a debate id, or "/" for today's debate. */
  href: string;
}

/**
 * Whole calendar days between a repair's completion and "today", in the caller's
 * local calendar frame. Used only to make a due retest nudge auditable
 * ("repaired N days ago") — never to gate or delay selection, so an unparseable
 * timestamp degrades to the label-only detail rather than misnudging.
 *
 * Returns -1 when no attempt timestamp was supplied (callers that build
 * synthetic inputs) so the caller can fall back to the generic detail line.
 */
export function retestAgeDays(attemptedAt: string | null | undefined): number {
  if (!attemptedAt) return -1;
  const anchor = Date.parse(attemptedAt);
  if (!Number.isFinite(anchor)) return -1;
  const then = new Date(anchor);
  const now = new Date();
  const dayDiff = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((dayDiff(now).getTime() - dayDiff(then).getTime()) / msPerDay);
}

/**
 * The single highest-priority unfinished action, or null when there is
 * nothing to continue (the user simply debates today).
 */
export function pickPriority(input: PriorityInputs): PriorityAction | null {
  if (input.unfinishedRepair) {
    const label = input.unfinishedRepair.label.toLowerCase();
    return {
      kind: "repair",
      title: `Finish the ${label} rewrite`,
      detail:
        input.unfinishedRepair.nextCue
          ? `One weakness is still open from your last debate. Next cue: ${input.unfinishedRepair.nextCue}`
          : "One weakness is still open from your last debate. The repair takes about a minute and is the most valuable part of the loop.",
      action: "Resume the repair",
      href: `/debate/${input.unfinishedRepair.debateId}`,
    };
  }
  if (input.dueRetest) {
    // A pending retest keeps today's debate at the top of the queue, but the
    // card must not say WHY. Naming the skill under test, or announcing that
    // today is the test day, would prompt the very behaviour the retest is
    // meant to measure (retestDisclosure.ts). The card therefore states the
    // loop — the age of the repair stays, because an auditable nudge is
    // better than an arbitrary one — but never the skill and never the day.
    const age = retestAgeDays(input.dueRetest.attemptedAt);
    const detail =
      age >= 0
        ? `You repaired a skill ${age} day${age === 1 ? "" : "s"} ago. A later debate, on a different topic, is the test — and it isn't signposted.`
        : "You repaired a skill in an earlier debate. A later debate, on a different topic, is the test — and it isn't signposted.";
    return {
      kind: "retest",
      title: RETEST_PENDING_CARD_TITLE,
      detail,
      action: "Start today's debate",
      href: "/",
    };
  }
  if (input.openDrill) {
    const minutes = input.openDrill.minutes;
    const detail =
      typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0
        ? `A short exercise on your current training focus. About ${minutes} minute${minutes === 1 ? "" : "s"} — you can do it right here.`
        : "A short exercise on your current training focus. About three minutes.";
    return {
      kind: "drill",
      title: `Today's drill: ${input.openDrill.title}`,
      detail,
      action: "Open the drill",
      href: "/progress#coach",
    };
  }
  if (input.debateAvailable) {
    return {
      kind: "debate",
      title: "Today's debate is waiting",
      detail: "One focused practice session: three rounds, one weakness, one repair.",
      action: "Start today's debate",
      href: "/",
    };
  }
  return null;
}
