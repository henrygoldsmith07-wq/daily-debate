// Post-debate result snapshot — the single coaching story for the result screen.
//
// Picks ONE strength, ONE weakness, and ONE evidence-backed explanation from
// the merged observable assessment, and pairs the weakness with the existing
// repair-target selector so "Fix this now" has a concrete exercise ready.
//
// This is an interpretation layer over the existing evaluation pipeline — it
// adds no scoring of its own and never contradicts the assessment. Pure.

import type { ArgGraph, ArgNode } from "./argGraph";
import type { ObservableAssessment } from "./observableAssessment";
import type { RepairTarget } from "./argumentRepair";
import { pickRepairTarget } from "./argumentRepair";
import { buildCoachingGoal, type CoachingSnapshot, type CoachingGoal } from "./coachingGoal";
import { measurementHonestyFor, type MeasurementHonesty } from "./sprint";
import type { SkillMetricPoint } from "./skillLedger";
import type { CoachDimension } from "./adaptiveCoach";

export interface ResultHighlight {
  /** Short headline of what went well, grounded in the debate. */
  headline: string;
  /** Evidence line quoting actual counts from the graph. */
  evidence: string;
}

export interface ResultWeakness {
  /** The one weakness worth fixing now. */
  headline: string;
  /** Brief explanation of why this matters, in plain language. */
  whyItMatters: string;
  /** The repair exercise built from the user's actual argument. */
  repair: RepairTarget | null;
  /** Repair-kind label for longitudinal comparison (repeated-weakness detection). */
  kind: string | null;
}

export interface ResultSnapshot {
  highlight: ResultHighlight | null;
  weakness: ResultWeakness | null;
  /** Secondary feedback list (model summary) — full analysis only. */
  secondary: { strengths: string[]; improvements: string[]; overallFeedback: string };
  /** Whether the pre-debate coaching goal was demonstrated. */
  goalOutcome: { demonstrated: boolean | null; detail: string | null };
  goal: CoachingGoal | null;
  honesty: MeasurementHonesty;
  /** How many graph evidence references back the weakness claim. */
  evidenceNodeCount: number;
  /** Repeated-weakness signal for the main weakness's kind. */
  recurrence: { count: number; label: string | null };
}

function ownClaims(graph: ArgGraph): ArgNode[] {
  return graph.nodes.filter((n) => n.owner === "a" && (n.kind === "claim" || n.kind === "counterclaim"));
}

function ownUnsupportedClaims(graph: ArgGraph): ArgNode[] {
  const ids = new Set(graph.evidenceStats.unsupportedClaimIds);
  return ownClaims(graph).filter((n) => ids.has(n.id));
}

function ownEvidence(graph: ArgGraph): ArgNode[] {
  return graph.nodes.filter((n) => n.owner === "a" && n.kind === "evidence");
}

function answeredRebuttals(graph: ArgGraph): number {
  return graph.nodes.filter((n) => n.owner === "a" && n.kind === "rebuttal").length;
}

function snapshotFromAssessment(assessment: ObservableAssessment): CoachingSnapshot {
  const responses = assessment.features?.a?.argumentResponses?.value;
  const unsupported = ownUnsupportedClaims(assessment.graph).length;
  const majorClaims = ownClaims(assessment.graph).length;
  return {
    responsesAnswered: responses?.responded ?? answeredRebuttals(assessment.graph),
    responseOpportunities: responses?.opportunities ?? 0,
    unsupportedClaims: unsupported,
    majorClaims,
    droppedOwn: assessment.features?.a?.droppedArguments?.value ?? assessment.graph.dropped.filter((d) => d.owner === "a").length,
  };
}

const WEAKNESS_WHY: Record<string, string> = {
  evidence: "Claims without named support are easy to dismiss, however good they sound.",
  logic: "A missing reasoning step is the gap a sharp opponent drives straight through.",
  structure: "Every thread you open and drop hands the other side a free win.",
  rebuttal: "Unanswered counterarguments decide rounds against you, even when your case is strong.",
  impact: "A point that never lands on 'why this matters' doesn't move the decision.",
  clarity: "When claim and reason blur together, judges credit neither.",
};

/**
 * Build the simplified result story from a completed debate's assessment.
 * `ledgerPoints` and `goalDimension` connect the result to the ongoing
 * coaching loop; `priorDebates` (side-scoped weakness counts per earlier
 * debate) enables repeated-weakness detection. The story still works without
 * any of them.
 */
export function buildResultSnapshot(
  assessment: ObservableAssessment | null | undefined,
  opts: {
    format: "sprint" | "full";
    summary?: { overallFeedback: string; strengths: string[]; improvements: string[] } | null;
    ledgerPoints?: SkillMetricPoint[];
    goalDimension?: CoachDimension | null;
    /** Prior debates, oldest last: { completedAt, kinds } from countWeaknessesForSide. */
    priorDebates?: Array<{ completedAt: string; kinds: Record<string, number> }>;
  },
): ResultSnapshot {
  const honesty = measurementHonestyFor(opts.format);
  const base: ResultSnapshot = {
    highlight: null,
    weakness: null,
    secondary: {
      strengths: opts.summary?.strengths ?? [],
      improvements: opts.summary?.improvements ?? [],
      overallFeedback: opts.summary?.overallFeedback ?? "",
    },
    goalOutcome: { demonstrated: null, detail: null },
    goal: null,
    honesty,
    evidenceNodeCount: 0,
    recurrence: { count: 0, label: null },
  };
  if (!assessment?.graph) return base;

  const graph = assessment.graph;
  const unsupported = ownUnsupportedClaims(graph);
  const evidence = ownEvidence(graph);
  const citedEvidence = evidence.filter((n) => (n.citations?.length ?? 0) > 0 || n.evidenceStrength === "cited" || n.evidenceStrength === "strong");
  const dropped = graph.dropped.filter((d) => d.owner === "a");
  const rebuttals = answeredRebuttals(graph);
  const opponentMoves = graph.nodes.filter((n) => n.owner === "ai" && ["claim", "counterclaim"].includes(n.kind));

  // ── Highlight: the most meaningful positive behaviour this debate ────────
  let highlight: ResultHighlight | null = null;
  if (opponentMoves.length > 0 && rebuttals >= Math.ceil(opponentMoves.length * 0.8)) {
    highlight = {
      headline: "You answered the opposing case",
      evidence: `You directly responded to ${rebuttals} of ${opponentMoves.length} opposing arguments.`,
    };
  } else if (citedEvidence.length > 0) {
    highlight = {
      headline: "You backed your case with sources",
      evidence: `${citedEvidence.length} claim${citedEvidence.length === 1 ? "" : "s"} carried named evidence.`,
    };
  } else if (rebuttals > 0) {
    highlight = {
      headline: "You engaged the other side",
      evidence: `You made ${rebuttals} direct response${rebuttals === 1 ? "" : "s"} to the opposing case.`,
    };
  }

  // ── Weakness: highest-priority observable miss, with its repair ──────────
  // Priority also lifts weaknesses that have recurred in recent debates —
  // a repeated miss is the most valuable thing to repair next.
  let weakness: ResultWeakness | null = null;
  let weaknessKind: string | null = null;
  const repair = pickRepairTarget(graph);
  if (unsupported.length > 0) {
    weaknessKind = "evidence";
    weakness = {
      headline: `${unsupported.length} important claim${unsupported.length === 1 ? " had" : "s had"} no supporting evidence`,
      whyItMatters: WEAKNESS_WHY.evidence,
      repair,
      kind: weaknessKind,
    };
  } else if (dropped.length > 0) {
    weaknessKind = "structure";
    weakness = {
      headline: `${dropped.length} of your claim${dropped.length === 1 ? "" : "s"} went unanswered`,
      whyItMatters: WEAKNESS_WHY.structure,
      repair,
      kind: weaknessKind,
    };
  } else if (opponentMoves.length > 0 && rebuttals < opponentMoves.length) {
    weaknessKind = "rebuttal";
    weakness = {
      headline: "You left an opposing argument unanswered",
      whyItMatters: WEAKNESS_WHY.rebuttal,
      repair,
      kind: weaknessKind,
    };
  } else if (repair) {
    weaknessKind = repair.kind;
    weakness = {
      headline: repair.label.toLowerCase(),
      whyItMatters: WEAKNESS_WHY[repair.kind] ?? "One concrete move from this debate is worth rewriting.",
      repair,
      kind: weaknessKind,
    };
  }

  // ── Repeated-weakness detection: did this kind show up recently before? ──
  // Observational pattern-surfacing, worded carefully (needs ≥1 prior debate
  // with the same weakness; "again" language only at ≥2).
  let recurrence: ResultSnapshot["recurrence"] = { count: 0, label: null };
  if (weaknessKind && opts.priorDebates?.length) {
    const RECURSION_WINDOW = 5;
    const prior = opts.priorDebates.slice(-RECURSION_WINDOW);
    const weaknessKinds = weaknessKind === "structure" ? ["structure", "dropped", "contradiction"] : [weaknessKind];
    const count = prior.filter((d) => weaknessKinds.some((k) => (d.kinds[k] ?? 0) > 0)).length;
    if (count >= 2) {
      recurrence = { count, label: `This weakness has now shown up in ${count + 1} of your recent debates — worth deliberate practice.` };
    } else if (count === 1) {
      recurrence = { count, label: "You had this weakness in a recent debate too." };
    }
  }

  // ── Goal outcome: did today's focus show up? ─────────────────────────────
  const snapshot = snapshotFromAssessment(assessment);
  const goal = opts.ledgerPoints ? buildCoachingGoal(opts.ledgerPoints, snapshot) : null;
  let goalOutcome = { demonstrated: null as boolean | null, detail: null as string | null };
  if (opts.goalDimension && snapshot) {
    if (opts.goalDimension === "rebuttal") {
      if (snapshot.responseOpportunities === 0) {
        goalOutcome = { demonstrated: null, detail: "No opposing argument came up to answer this time." };
      } else {
        const answered = snapshot.responsesAnswered;
        goalOutcome = {
          demonstrated: answered >= snapshot.responseOpportunities * 0.8,
          detail: `You directly answered ${answered} of ${snapshot.responseOpportunities} opposing arguments.`,
        };
      }
    } else if (opts.goalDimension === "evidence") {
      goalOutcome = snapshot.majorClaims === 0
        ? { demonstrated: null, detail: "No major claims were extracted from this debate." }
        : {
            demonstrated: snapshot.unsupportedClaims === 0,
            detail: snapshot.unsupportedClaims === 0
              ? "Every major claim had support this time."
              : `${snapshot.unsupportedClaims} claim${snapshot.unsupportedClaims === 1 ? "" : "s"} had no supporting evidence.`,
          };
    } else if (opts.goalDimension === "structure") {
      goalOutcome = {
        demonstrated: snapshot.droppedOwn === 0,
        detail: snapshot.droppedOwn === 0 ? "You closed every loop you opened." : `You left ${snapshot.droppedOwn} of your own claims unanswered.`,
      };
    }
  }

  return {
    ...base,
    highlight,
    weakness,
    goal,
    goalOutcome,
    evidenceNodeCount: evidence.length + graph.edges.length,
    recurrence,
  };
}
