// The practice → diagnose → repair → retest → demonstrate loop, made visible.
//
// Pure derivation from the canonical learner model (learnerModel.ts) — no
// second source of truth. The thread follows the one episode currently in
// flight; when nothing is open it says so plainly rather than inventing
// progress. A successful repair is practice, not proof: only a later,
// unprompted, different-topic demonstration closes a loop.

import type { LearnerModel, SkillRepairState } from "./learnerModel";

export type LoopStageId = "practice" | "diagnose" | "repair" | "retest" | "demonstrate";

export interface LoopStageView {
  id: LoopStageId;
  label: string;
  /** done: completed for this episode · active: where the learner is now · ahead: not yet. */
  status: "done" | "active" | "ahead";
  caption: string;
}

export interface LoopThreadView {
  /** The skill whose episode the thread follows, or null when nothing is open. */
  skillLabel: string | null;
  stages: LoopStageView[];
  headline: string;
  detail: string;
  /** Skills with at least one unprompted demonstration (loops closed at least once). */
  loopsDemonstrated: number;
  /** Skills with an episode still open (repair unfinished, or a repair awaiting proof). */
  loopsOpen: number;
}

const STAGES: { id: LoopStageId; label: string; caption: string }[] = [
  { id: "practice", label: "Practise", caption: "Debate today's motion — a real rep, not a quiz." },
  { id: "diagnose", label: "Diagnose", caption: "See the one behaviour that cost you the round." },
  {
    id: "repair",
    label: "Repair",
    caption: "Rewrite the move until it crosses the line. Failed attempts stay retryable.",
  },
  {
    id: "retest",
    label: "Retest",
    caption: "A later, different-topic debate tests it — no cues this time.",
  },
  {
    id: "demonstrate",
    label: "Demonstrate",
    caption: "Using it unprompted is the only thing that closes the loop.",
  },
];

function isOpenEpisode(r: SkillRepairState): boolean {
  return (
    r.status === "repaired-awaiting-retest" ||
    r.status === "repaired-not-yet-demonstrated" ||
    r.status === "still-struggling"
  );
}

/** The episode the thread follows: the current focus's repair state if it has
 *  real activity, otherwise the oldest open episode, otherwise any episode,
 *  otherwise the untouched current focus. An open loop is the story — a closed
 *  one only leads when nothing is in flight. */
function pickEpisode(model: LearnerModel): SkillRepairState | null {
  const focusSkill = model.currentFocus?.skill ?? null;
  const focused = focusSkill ? (model.repairs.find((r) => r.skill === focusSkill) ?? null) : null;
  if (focused && focused.totalAttempts > 0) return focused;
  return (
    model.repairs.find((r) => r.totalAttempts > 0 && isOpenEpisode(r)) ??
    model.repairs.find((r) => r.totalAttempts > 0) ??
    focused
  );
}

function stageIndexFor(model: LearnerModel, episode: SkillRepairState | null): number {
  if (model.debatesObserved === 0) return 0;
  if (!episode) return 0;
  switch (episode.status) {
    case "still-struggling":
    case "not-attempted":
      return 2;
    case "repaired-awaiting-retest":
      return 3;
    case "repaired-not-yet-demonstrated":
      return 4;
    case "repaired-demonstrated-later":
      return 5; // every stage done — one loop closed
  }
}

function headlineFor(model: LearnerModel, episode: SkillRepairState | null): { headline: string; detail: string } {
  if (model.debatesObserved === 0) {
    return {
      headline: "Your first loop starts with one debate.",
      detail:
        "Every debate names one behaviour to fix, you repair it, and a later debate tests whether it stuck. That cycle is the product.",
    };
  }
  if (!episode) {
    return {
      headline: "No repair in flight.",
      detail:
        "Debate first — the diagnosis names the one behaviour worth repairing, and the loop starts from there.",
    };
  }
  const label = episode.label.toLowerCase();
  switch (episode.status) {
    case "still-struggling":
      return {
        headline: `You're inside the ${label} repair.`,
        detail: `${episode.totalAttempts} attempt${episode.totalAttempts === 1 ? "" : "s"} so far — failed attempts stay retryable and never count as wins. Keep rewriting until it crosses the line.`,
      };
    case "not-attempted":
      return {
        headline: `The next loop is ${label}.`,
        detail: "The diagnosis is in; the repair exercise is the move that turns it into practice.",
      };
    case "repaired-awaiting-retest":
      return {
        headline: `Loop open: ${label} is repaired and waiting to be tested.`,
        detail:
          "A repair is practice, not proof. Today's debate on a different topic is the test — use it without a cue and the loop closes.",
      };
    case "repaired-not-yet-demonstrated":
      return {
        headline: `The ${label} retest didn't show the behaviour yet.`,
        detail:
          "The chance came up and the behaviour didn't appear that time. The skill stays on your training list — the next real opportunity is another test.",
      };
    case "repaired-demonstrated-later":
      return {
        headline: `One loop closed for ${label}.`,
        detail:
          "You used it unprompted in a later debate. One demonstration is an observation, not a habit — later reps make it a pattern.",
      };
  }
}

export function buildLoopThread(model: LearnerModel): LoopThreadView {
  const episode = pickEpisode(model);
  const current = stageIndexFor(model, episode);
  const stages: LoopStageView[] = STAGES.map((stage, index) => ({
    ...stage,
    status: current >= 5 ? "done" : index < current ? "done" : index === current ? "active" : "ahead",
  }));

  const { headline, detail } = headlineFor(model, episode);

  return {
    skillLabel: episode ? episode.label : null,
    stages,
    headline,
    detail,
    loopsDemonstrated: model.repairs.filter((r) => r.status === "repaired-demonstrated-later").length,
    loopsOpen: model.repairs.filter(
      (r) =>
        r.status === "repaired-awaiting-retest" ||
        r.status === "repaired-not-yet-demonstrated" ||
        r.status === "still-struggling",
    ).length,
  };
}
