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
    const age = retestAgeDays(input.dueRetest.attemptedAt);
    const detail = age >= 0
      ? `You repaired this skill ${age} day${age === 1 ? "" : "s"} ago. Today's goal is to see whether it shows up naturally, on a different motion.`
      : "You repaired this skill in an earlier debate. Today's goal is to see whether it shows up naturally, on a different motion.";
    return {
      kind: "retest",
      title: `Retest: ${input.dueRetest.label.toLowerCase()} is due`,
      detail,
      action: "Start today's retest",
      href: "/",
    };
  }
  if (input.openDrill) {
    return {
      kind: "drill",
      title: `Today's drill: ${input.openDrill.title}`,
      detail: "A short exercise on your current training focus. About three minutes.",
      action: "Open the drill",
      href: "/",
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
