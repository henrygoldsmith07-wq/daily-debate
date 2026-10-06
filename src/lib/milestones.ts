// Practice milestones — behaviour that actually happened, never XP.
//
// Each milestone is checked against real rows: completed repairs, deliberate
// retests, and side-scoped observed behaviour across eligible debates. The
// language describes what was observed ("Rebuttal observed across 3 eligible
// debates"), never an achievement claim about debating ability.

import type { RepairRecord, RetestOutcome } from "./retest";
import type { JourneyObservation } from "./skillJourney";

export interface Milestone {
  id: string;
  title: string;
  detail: string;
  achieved: boolean;
  achievedAt: string | null;
  /** What is still needed, when not yet achieved. */
  remaining: string | null;
}

export interface MilestoneInputs {
  repairs: RepairRecord[];
  /** Journey observations per repair kind (opportunity counts included). */
  observationsByKind: Record<string, JourneyObservation[]>;
  /** Completed deliberate-practice loops: debate → repair → retest. */
  completedLoops: number;
}

/** Repeated behaviour needs this many eligible debates before it counts. */
export const MILESTONE_CONSISTENCY_DEBATES = 3;

function iso(at: string): string {
  return new Date(at).toISOString().slice(0, 10);
}

export function buildMilestones(input: MilestoneInputs): Milestone[] {
  const { repairs, observationsByKind, completedLoops } = input;
  const firstRepair = repairs.find((r) => r.succeeded) ?? null;
  const firstRetest = repairs.find((r) => r.succeeded && isSkillObserved(r.retest_outcome)) ?? null;
  const anyRetestDone = repairs.find((r) => r.retest_completed_at) ?? null;

  const consistency = Object.entries(observationsByKind)
    .map(([kind, obs]) => {
      const eligible = obs.length;
      const met = obs.reduce((sum, o) => sum + o.met, 0);
      return { kind, eligible, met, allMet: eligible > 0 && met >= obs.reduce((s, o) => s + o.opportunities, 0) };
    })
    .filter((s) => s.eligible >= MILESTONE_CONSISTENCY_DEBATES && s.allMet)
    .sort((a, b) => b.eligible - a.eligible);
  const consistencyTop = consistency[0] ?? null;

  return [
    {
      id: "first-repair",
      title: "First successful repair",
      detail: "You rewrote a flagged move with the missing component present.",
      achieved: !!firstRepair,
      achievedAt: firstRepair ? iso(firstRepair.created_at) : null,
      remaining: firstRepair ? null : "Repair one flagged move after a debate.",
    },
    {
      id: "first-retest",
      title: "First successful different-topic retest",
      detail: "A repaired skill appeared in a later debate on another topic, without prompting.",
      achieved: !!firstRetest,
      achievedAt: firstRetest ? iso(firstRetest.retest_completed_at ?? firstRetest.created_at) : null,
      remaining: firstRetest
        ? null
        : anyRetestDone
          ? "Your retest didn't show the skill yet — it stays on the training list."
          : "Complete the retest your repair queued.",
    },
    {
      id: "consistency",
      title: consistencyTop
        ? `${capitalise(consistencyTop.kind)} observed across ${consistencyTop.eligible} eligible debates`
        : "Skill observed across 3 eligible debates",
      detail: consistencyTop
        ? "The behaviour appeared every time a chance to show it came up."
        : "Repeated observed behaviour across eligible debates — not a score.",
      achieved: !!consistencyTop,
      achievedAt: consistencyTop ? null : null,
      remaining: consistencyTop
        ? null
        : `Keep training one skill until it shows up across ${MILESTONE_CONSISTENCY_DEBATES} eligible debates.`,
    },
    {
      id: "loop-10",
      title: "Completed 10 deliberate-practice loops",
      detail: "Ten full cycles: debate → one weakness → repair → retest.",
      achieved: completedLoops >= 10,
      achievedAt: null,
      remaining: completedLoops >= 10 ? null : `${10 - completedLoops} more full loops to go.`,
    },
  ];
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function isSkillObserved(outcome: RetestOutcome | null | undefined): boolean {
  return outcome === "skill-observed";
}
