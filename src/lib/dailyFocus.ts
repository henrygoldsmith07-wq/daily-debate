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

export interface PriorityInput {
  /** A finished debate with an identified weakness and no completed repair. */
  unresolvedRepair: { debateId: string; kind: string } | null;
  /** A successful repair whose deliberate retest is still owed. */
  dueRetest: {
    repairId: string;
    kind: string;
    /** Topic the repair happened on — the retest must differ. */
    repairedTopicId: string | null;
    repairedTopicTitle: string | null;
    repairedAt: string;
  } | null;
  /** Today's drill assignment, when unattempted. */
  activeDrill: { id: string; title: string; dimension: string } | null;
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

const KIND_LABEL: Record<string, string> = {
  evidence: "Evidence",
  rebuttal: "Rebuttal",
  logic: "Logic",
  impact: "Impact",
  structure: "Structure",
  clarity: "Clarity",
};

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);
}

/**
 * The single highest-priority unfinished action, or null when there is
 * nothing to continue (the user simply debates today).
 */
export function pickPriority(input: PriorityInput): PriorityAction | null {
  if (input.unresolvedRepair) {
    const label = kindLabel(input.unresolvedRepair.kind);
    return {
      kind: "repair",
      title: `Finish your ${label.toLowerCase()} repair`,
      detail:
        "A debate ended with one weakness identified but not yet repaired. The repair takes about a minute and is the most valuable part of the loop.",
      action: "Resume the repair",
      href: `/debate/${input.unresolvedRepair.debateId}`,
    };
  }
  if (input.dueRetest) {
    const label = kindLabel(input.dueRetest.kind);
    return {
      kind: "retest",
      title: `Retest: ${label.toLowerCase()} is due`,
      detail: `You repaired ${label.toLowerCase()} after an earlier debate. Today's goal is to see whether you use it naturally, on a different motion.`,
      action: "Start the retest",
      href: "/",
    };
  }
  if (input.activeDrill) {
    return {
      kind: "drill",
      title: `Today's drill: ${input.activeDrill.title}`,
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
