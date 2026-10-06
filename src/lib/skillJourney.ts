// Skill Journey — the consumer-facing story of deliberate practice.
//
// Answers "what changed in my arguing?" per skill with a concrete, evidence-
// backed narrative:
//
//   weakness that triggered training → the repair completed → the deliberate
//   retest → later debates where the behaviour appeared → how much evidence
//   that rests on.
//
// Every statement is generated from the canonical measurement rows
// (repair_results + side-scoped weakness counts from repairEffectiveness);
// nothing is inferred, and small samples are named as such instead of being
// promoted to improvement claims. Pure; the Progress page renders it.

import type { DebateWeaknessRow } from "./repairEffectiveness";
import { weaknessKindsFor, hasOpportunity } from "./repairEffectiveness";
import { isRepairKind } from "./argumentRepair";
import { REPAIR_KIND_TO_DIMENSION as CANONICAL_KIND_TO_DIMENSION } from "./repairRetest";
import type { RepairRecord, RetestOutcome } from "./retest";
import { RETEST_OUTCOME_LABELS, LONGITUDINAL_MIN_OBSERVATIONS, formativeStateFor } from "./retest";
import type { CoachDimension } from "./adaptiveCoach";
import { DIMENSION_LABELS } from "./adaptiveCoach";

export const REPAIR_KIND_TO_DIMENSION: Record<string, CoachDimension> = CANONICAL_KIND_TO_DIMENSION;

export interface JourneyObservation {
  debateId: string;
  completedAt: string;
  /** Opponent arguments / claims the behaviour could have shown up in. */
  opportunities: number;
  /** How many of those the user met (answered / grounded). */
  met: number;
}

export interface SkillJourneyEntry {
  dimension: CoachDimension;
  label: string;
  /** Current observable state, e.g. "answering most opposing arguments". */
  currentState: string;
  /** The weakness that originally triggered training. */
  trigger: { kind: string; detail: string; debateId: string; at: string } | null;
  /** The repair completed against that weakness. */
  repair: { at: string; succeeded: boolean; state: string; debateId: string } | null;
  /** The deliberate retest and its truthful outcome. */
  retest: { outcome: RetestOutcome; label: string; debateId: string } | null;
  /** Later debates where the behaviour was checked (newest first). */
  laterObservations: JourneyObservation[];
  /** Evidence sufficiency — never a mastery claim from a small sample. */
  evidence: {
    opportunitiesObserved: number;
    opportunitiesMet: number;
    eligibleDebates: number;
    sufficient: boolean;
    note: string;
  };
  /** One concrete story sentence, only when the evidence supports it. */
  story: string | null;
}

const KIND_TRIGGER_DETAIL: Record<string, string> = {
  evidence: "important claims without supporting evidence",
  rebuttal: "opposing arguments left unanswered",
  logic: "reasoning shortcuts flagged in your own moves",
  impact: "arguments that never said why they matter",
  structure: "dropped threads or self-contradictions",
  clarity: "moves where claim and reason blurred together",
};

function stateSentence(met: number, opportunities: number, label: string): string {
  if (opportunities === 0) return `No chances to show ${label.toLowerCase()} yet.`;
  const share = met / opportunities;
  if (share >= 0.8) return `${label} is showing up in most of your recent debates (${met} of ${opportunities} chances met).`;
  if (share >= 0.5) return `${label} is appearing sometimes — ${met} of ${opportunities} recent chances met.`;
  return `${label} is still the weak link: ${met} of ${opportunities} recent chances met.`;
}

/**
 * Observations for one repair kind across debates: which debates offered the
 * behaviour a chance to show up, and how many chances the user met.
 */
export function journeyObservationsFor(
  kind: string,
  debates: DebateWeaknessRow[],
): JourneyObservation[] {
  if (!isRepairKind(kind)) return [];
  const kinds = weaknessKindsFor(kind);
  return debates
    .filter((d) => hasOpportunity(kind, d))
    .map((d) => {
      const opps = d.opps ?? { majorClaims: 0, opponentMoves: 0 };
      const opportunities = kind === "rebuttal" ? opps.opponentMoves : opps.majorClaims;
      // The weakness counter is the unmet share: dropped/unsupported/etc.
      const unmet = Math.max(0, ...kinds.map((k) => d.kinds[k] ?? 0));
      const met = Math.max(0, Math.min(opportunities, opportunities - (kind === "rebuttal" ? (d.kinds.dropped ?? 0) : unmet)));
      return { debateId: d.debateId, completedAt: d.completedAt, opportunities, met };
    })
    .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
}

function storyFor(kind: string, obs: JourneyObservation[], repairSucceeded: boolean, retest: SkillJourneyEntry["retest"]): string | null {
  const eligible = obs.length;
  const opportunities = obs.reduce((sum, o) => sum + o.opportunities, 0);
  // A quantified claim needs both repeated debates and real opportunities.
  if (!repairSucceeded || eligible < 2 || opportunities < 4) return null;
  const recent = obs.slice(0, Math.min(5, obs.length));
  const recentOpp = recent.reduce((sum, o) => sum + o.opportunities, 0);
  const recentMet = recent.reduce((sum, o) => sum + o.met, 0);
  const object =
    kind === "rebuttal" ? "opposing claims" :
    kind === "evidence" ? "major claims needing support" :
    "chances to show the skill";
  const opening = KIND_TRIGGER_DETAIL[kind]
    ? `Earlier debates kept showing ${KIND_TRIGGER_DETAIL[kind]}.`
    : `Earlier debates kept missing chances to show ${kind}.`;
  const tail = retest && retest.outcome === "skill-observed"
    ? ` The retest showed it without prompting.`
    : retest && retest.outcome === "skill-not-observed"
      ? ` The deliberate retest didn't show it yet.`
      : "";
  return `${opening} After the repair, you met ${recentMet} of your last ${recentOpp} eligible ${object}.${tail}`;
}

/**
 * Build one journey entry per skill that has a repair to trace. Skills with
 * no repair history get a plain current-state entry so the view is complete
 * without inventing a story.
 */
export function buildSkillJourney(
  repairs: RepairRecord[],
  debates: DebateWeaknessRow[],
  opts: { now?: string } = {},
): SkillJourneyEntry[] {
  void opts;
  const byDimension = new Map<CoachDimension, SkillJourneyEntry>();

  const sorted = [...repairs].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  for (const repair of sorted) {
    const dimension = REPAIR_KIND_TO_DIMENSION[repair.target_kind];
    if (!dimension) continue;
    const label = DIMENSION_LABELS[dimension];
    const obs = journeyObservationsFor(repair.target_kind, debates);
    const after = obs.filter((o) => Date.parse(o.completedAt) > Date.parse(repair.created_at));
    const eligible = after.length;
    const opportunities = after.reduce((sum, o) => sum + o.opportunities, 0);
    const met = after.reduce((sum, o) => sum + o.met, 0);
    const retest = repair.retest_debate_id && repair.retest_outcome
      ? { outcome: repair.retest_outcome, label: RETEST_OUTCOME_LABELS[repair.retest_outcome], debateId: repair.retest_debate_id }
      : null;

    const entry: SkillJourneyEntry = {
      dimension,
      label,
      currentState: stateSentence(met, opportunities, label),
      trigger: {
        kind: repair.target_kind,
        detail: KIND_TRIGGER_DETAIL[repair.target_kind] ?? `${repair.target_kind} weakness`,
        debateId: repair.debate_id,
        at: repair.created_at,
      },
      repair: {
        at: repair.created_at,
        succeeded: repair.succeeded,
        state: formativeStateFor(repair.score, repair.succeeded),
        debateId: repair.debate_id,
      },
      retest,
      laterObservations: after,
      evidence: {
        opportunitiesObserved: opportunities,
        opportunitiesMet: met,
        eligibleDebates: eligible,
        sufficient: eligible >= LONGITUDINAL_MIN_OBSERVATIONS && opportunities >= 4,
        note:
          eligible >= LONGITUDINAL_MIN_OBSERVATIONS && opportunities >= 4
            ? `Based on ${eligible} eligible debates (${opportunities} chances observed).`
            : `Evidence is still limited — ${eligible} eligible ${eligible === 1 ? "debate" : "debates"} since the repair (${opportunities} chances). Not enough for a strong claim.`,
      },
      story: null,
    };
    entry.story = storyFor(repair.target_kind, after, repair.succeeded, retest);
    byDimension.set(dimension, entry);
  }

  return [...byDimension.values()];
}

export interface RecentlyImproved {
  label: string;
  /** One line: what changed, with the observed counts behind it. */
  line: string;
  /** "observed" = behaviour tracked; "practice" = repair completed only. */
  kind: "observed" | "practice";
}

/**
 * The compact "Recently improved" strip: at most three items, each a real,
 * observable change. Small samples never generate an item.
 */
export function buildRecentlyImproved(journey: SkillJourneyEntry[]): RecentlyImproved[] {
  const items: RecentlyImproved[] = [];
  for (const entry of journey) {
    if (entry.retest?.outcome === "skill-observed" && entry.evidence.opportunitiesMet > 0) {
      items.push({
        label: entry.label,
        line: `${entry.retest.label.toLowerCase()} — then met ${entry.evidence.opportunitiesMet} of ${entry.evidence.opportunitiesObserved} chances since.`,
        kind: "observed",
      });
    } else if (entry.repair?.succeeded && entry.evidence.eligibleDebates > 0 && entry.evidence.opportunitiesMet >= entry.evidence.opportunitiesObserved) {
      items.push({
        label: entry.label,
        line: `Repair completed, and the behaviour held across ${entry.evidence.eligibleDebates} ${entry.evidence.eligibleDebates === 1 ? "debate" : "debates"} since.`,
        kind: "practice",
      });
    }
    if (items.length >= 3) break;
  }
  return items.slice(0, 3);
}
