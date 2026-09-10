// Daily coaching goal — connects the skill ledger to ONE focused, plain-language
// goal that is shown before the debate and assessed after it.
//
// Pipeline position: skill ledger → coaching interpretation → user-facing
// explanation. This module reuses the existing coach profile/focus selection
// (adaptiveCoach.ts) rather than introducing a second selection policy.
// Pure — routes/components supply ledger points and snapshots.

import type { CoachDimension } from "./adaptiveCoach";
import { buildCoachProfile, selectFocus } from "./adaptiveCoach";
import type { SkillMetricPoint } from "./skillLedger";
import type { ObservableAssessment } from "./observableAssessment";
import { unansweredOpportunitiesBy } from "./opportunity";

/** Observable facts from one completed debate, persisted on the debate row. */
export interface CoachingSnapshot {
  /** Opponent arguments the user directly answered (observed in the graph). */
  responsesAnswered: number;
  /** Opportunities there were to answer an opponent move. */
  responseOpportunities: number;
  /** User claims with no supporting evidence in the graph. */
  unsupportedClaims: number;
  /** User claim-like nodes. */
  majorClaims: number;
  /** Opponent arguments the user never answered (user's rebuttal failure). */
  droppedOwn: number;
}

/** Extract the coaching snapshot from a merged debate assessment. */
export function snapshotFromAssessment(assessment: ObservableAssessment | null | undefined): CoachingSnapshot | null {
  if (!assessment?.features?.a) return null;
  const responses = assessment.features.a.argumentResponses?.value;
  const myIds = new Set(
    assessment.graph.nodes.filter((n) => n.owner === "a").map((n) => n.id),
  );
  const unsupported = assessment.graph.evidenceStats.unsupportedClaimIds.filter((id) => myIds.has(id)).length;
  const majorClaims = assessment.graph.nodes.filter(
    (n) => n.owner === "a" && (n.kind === "claim" || n.kind === "counterclaim"),
  ).length;
  // The user's rebuttal failure: the CANONICAL unanswered-opportunity set
  // (opportunity.ts) — opponent arguments the user had a later turn to answer
  // but never validly did. Judge-supplied dropped rows are not re-implemented
  // here; this is the same definition drop detection and rewards read.
  const unanswered = unansweredOpportunitiesBy(assessment.graph, "a").length;
  return {
    responsesAnswered: responses?.responded ?? 0,
    responseOpportunities: responses?.opportunities ?? 0,
    unsupportedClaims: unsupported,
    majorClaims,
    droppedOwn: unanswered,
  };
}

/**
 * One focus for today: the lowest profile dimension, adjusted by movement
 * (shared with the drill-assignment coach so Today, Progress and the drill
 * system agree on what matters right now).
 */
export function pickFocusDimension(
  points: SkillMetricPoint[],
  outcomes: Partial<Record<CoachDimension, number>> = {},
): CoachDimension | null {
  if (!points.length) return null;
  const { dims, slopes } = buildCoachProfile(points);
  const { focus } = selectFocus(dims, slopes, outcomes);
  return focus?.key ?? null;
}

export const GOAL_HEADLINES: Record<CoachDimension, string> = {
  evidence: "Ground every major claim in a named source.",
  rebuttal: "Answer the strongest opposing argument before adding another claim.",
  logic: "Make the reasoning step between facts and conclusions explicit.",
  clarity: "Split each move into one claim and one reason.",
  impact: "Explain why your point matters more than the opponent's argument.",
  steelmanning: "State the opposing case in its strongest form before answering it.",
  structure: "Close the loop on every claim you introduce.",
};

export const GOAL_DETAIL: Record<CoachDimension, string> = {
  evidence: "Claims without support are easy to dismiss, however good they sound.",
  rebuttal: "Unanswered counterarguments decide rounds against you, even when your case is strong.",
  logic: "A missing causal bridge is the gap a sharp opponent drives straight through.",
  clarity: "When claim and reason blur together, judges credit neither.",
  impact: "A point that never lands on 'why this matters' doesn't move the decision.",
  steelmanning: "Answering the weak version of an argument proves nothing about the strong one.",
  structure: "Every thread you open and drop is a free win for the other side.",
};

/** Numeric goal threshold: only quoted when the sample supports the precision. */
const NUMERIC_GOAL_MIN_OPPORTUNITIES = 3;

export interface CoachingGoal {
  dimension: CoachDimension;
  headline: string;
  /** Evidence line from the previous debate, or null when no snapshot exists. */
  lastLine: string | null;
  /** The goal for today's debate. */
  goalLine: string;
  /** True when the goalLine quotes concrete numbers justified by real data. */
  numeric: boolean;
}

function described(snapshot: CoachingSnapshot): string {
  if (snapshot.responseOpportunities > 0) {
    return `You directly answered ${snapshot.responsesAnswered} of ${snapshot.responseOpportunities} major opposing arguments.`;
  }
  if (snapshot.unsupportedClaims > 0) {
    return `${snapshot.unsupportedClaims} of your claims had no supporting evidence.`;
  }
  if (snapshot.droppedOwn > 0) {
    return `You left ${snapshot.droppedOwn} opposing argument${snapshot.droppedOwn === 1 ? "" : "s"} unanswered.`;
  }
  return null as unknown as string;
}

/**
 * Build the coaching goal for today from the ledger and the most recent
 * debate snapshot. Goals are numeric only where previous behaviour gives the
 * number meaning; otherwise they stay qualitative.
 */
export function buildCoachingGoal(
  points: SkillMetricPoint[],
  lastSnapshot: CoachingSnapshot | null,
  outcomes: Partial<Record<CoachDimension, number>> = {},
): CoachingGoal | null {
  const dimension = pickFocusDimension(points, outcomes);
  if (!dimension) return null;
  const headline = GOAL_HEADLINES[dimension];

  if (!lastSnapshot) {
    return { dimension, headline, lastLine: null, goalLine: headline, numeric: false };
  }

  const lastLine = described(lastSnapshot);

  // Numeric goal for rebuttal: "answer at least N of M" phrasing when there
  // were enough opportunities last time to justify the precision.
  if (dimension === "rebuttal" && lastSnapshot.responseOpportunities >= NUMERIC_GOAL_MIN_OPPORTUNITIES) {
    const target = Math.max(1, Math.ceil(lastSnapshot.responseOpportunities * 0.8));
    return {
      dimension,
      headline,
      lastLine,
      goalLine: `Answer at least ${target} of ${lastSnapshot.responseOpportunities} before introducing a new claim.`,
      numeric: true,
    };
  }
  if (dimension === "evidence" && lastSnapshot.majorClaims >= NUMERIC_GOAL_MIN_OPPORTUNITIES) {
    return {
      dimension,
      headline,
      lastLine,
      goalLine: "Give every major claim one named source this time.",
      numeric: false,
    };
  }

  return { dimension, headline, lastLine, goalLine: headline, numeric: false };
}

export interface GoalOutcome {
  /** null = this dimension's behaviour wasn't observable this debate. */
  demonstrated: boolean | null;
  detail: string | null;
}

/**
 * Assess whether the finished debate demonstrated the goal behaviour.
 * Deliberately narrow: only dimensions with a directly observable proxy are
 * judged; everything else reports "not measured" rather than guessing.
 */
export function assessGoalOutcome(dimension: CoachDimension, snapshot: CoachingSnapshot): GoalOutcome {
  switch (dimension) {
    case "rebuttal": {
      if (snapshot.responseOpportunities === 0) {
        return { demonstrated: null, detail: "No opposing argument to answer this round." };
      }
      const answered = snapshot.responsesAnswered;
      const detail = `You directly answered ${answered} of ${snapshot.responseOpportunities} opposing arguments.`;
      return { demonstrated: answered >= snapshot.responseOpportunities * 0.8, detail };
    }
    case "evidence": {
      if (snapshot.majorClaims === 0) {
        return { demonstrated: null, detail: "No major claims were extracted from this debate." };
      }
      const detail =
        snapshot.unsupportedClaims === 0
          ? "Every major claim had support this time."
          : `${snapshot.unsupportedClaims} claim${snapshot.unsupportedClaims === 1 ? "" : "s"} still had no supporting evidence.`;
      return { demonstrated: snapshot.unsupportedClaims === 0, detail };
    }
    case "structure": {
      const detail =
        snapshot.droppedOwn === 0
          ? "You answered every opposing argument."
          : `You left ${snapshot.droppedOwn} opposing argument${snapshot.droppedOwn === 1 ? "" : "s"} unanswered.`;
      return { demonstrated: snapshot.droppedOwn === 0, detail };
    }
    default:
      return { demonstrated: null, detail: null };
  }
}
