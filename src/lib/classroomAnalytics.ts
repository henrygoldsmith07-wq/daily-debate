// Classroom analytics — the differentiated feature that makes Daily Debate
// unique for teachers: automatic argument analysis produces per-student skill
// vectors, which aggregate into a class profile that surfaces common problems.
//
// Pipeline: student debates → observableAssessment → this module → teacher UI.
// Pure functions only; persistence lives in routes + Postgres.
//
// This module deliberately uses loose typing (`any`) because it processes
// JSON blobs stored in Postgres whose shape varies across schema versions.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { METRIC_KEYS, type MetricKey } from "./skillLedger";
import { METRIC_LABELS } from "./skillLedger";
import { COACH_DIMENSIONS } from "./adaptiveCoach";

// --- types -------------------------------------------------------------------

export interface StudentDebateAssessment {
  studentId: string;
  debateId: string;
  /** Merged ObservableAssessment for one completed debate. Loosely typed for flexibility. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assessment: any;
}

export interface DimensionScore {
  key: string;
  label: string;
  /** Class mean 0–100 */
  mean: number;
  /** 0–1 share of students below 50 on this dimension */
  strugglingShare: number;
  trend: "up" | "down" | "flat" | null;
}

export interface CommonProblem {
  dimension: CoachDimensionKey;
  description: string;
  affectedCount: number;
  totalStudents: number;
  recommendedDrillMinutes: number;
}

export interface ClassSkillProfile {
  className: string;
  studentsAnalysed: number;
  debatesAnalysed: number;
  dimensions: DimensionScore[];
  commonProblems: CommonProblem[];
  perStudent: Record<string, Record<string, number>>;
}

export type CoachDimensionKey = typeof CLASS_DIMENSIONS[number];

/** The 7 class-level dimensions (same axes as the adaptive coach). */
export const CLASS_DIMENSIONS = [
  "evidence", "rebuttal", "logic", "clarity",
  "impact", "steelmanning", "structure",
] as const;

const CLASS_LABELS: Record<CoachDimensionKey, string> = {
  evidence: "Evidence",
  rebuttal: "Rebuttal",
  logic: "Logic",
  clarity: "Clarity",
  impact: "Impact",
  steelmanning: "Steelmanning",
  structure: "Structure",
};

/** Threshold below which a student is considered "struggling" on a dimension. */
const STRUGGLING_THRESHOLD = 50;

// --- extraction ---------------------------------------------------------------

interface RawMetrics {
  unsupportedRate: number | null;
  rebuttalCoverage: number | null;
  fallacyRate: number | null;
  clarityProxy: number | null;
  impactHandled: number | null;
  steelmanScore: number | null;
  structureFailures: number | null;
  substantiveCount: number;
}

function extractRaw(a: any): RawMetrics {
  const g = a.graph;
  const nodes: any[] = g.nodes ?? [];
  const substantive: any[] = nodes.filter((n: any) => n.kind === "claim" || n.kind === "counterclaim" || n.kind === "impact");
  const userNodes = substantive.filter((n: any) => n.owner === "a" || n.owner === "ai");
  const userSubstantive = userNodes.length || 1;

  const unsupported = g.evidenceStats.unsupportedClaimIds.length;

  // Rebuttal coverage: opposing claims addressed / total opposing claims
  const opposing = (nodes as any[]).filter((n: any) => n.owner === "b" && (n.kind === "counterclaim" || n.kind === "claim"));
  const targetSet = new Set(
    (nodes as any[]).filter((n: any) => n.kind === "rebuttal" && n.owner === "a").flatMap((r: any) => r.targets ?? [])
  );
  const covered = opposing.filter((o: any) => targetSet.has(o.id)).length;
  const rbCoverage = opposing.length ? covered / opposing.length : null;

  // Fallacy rate on user's nodes
  const myIds = new Set(userNodes.map((n: any) => n.id));
  const flagged = ((g.fallacies ?? []) as any[]).filter((f: any) => myIds.has(f.nodeId)).length;
  const fallacyRate = substantive.length ? Math.min(1, flagged / substantive.length) : null;

  // Impact handled?
  const impactHandled = g.impactComparison ? 1 : 0;

  // Steelman: concessions or steelman markers in engine
  const steelman = a.engine?.a?.steelmanQuality?.score ?? null;

  // Structure failures: dropped + contradictions owned by user
  const dropped = ((g.dropped ?? []) as any[]).filter((d: any) => !d.owner || d.owner === "a").length;
  const contradictions = ((g.contradictions ?? []) as any[]).filter((c: any) => c.owner === "a").length;
  const structureFailures = dropped + contradictions;

  return {
    unsupportedRate: substantive.length ? unsupported / claimsMade(g) : null,
    rebuttalCoverage: rbCoverage,
    fallacyRate,
    clarityProxy: null, // needs turn-level display scores, not available at graph level alone
    impactHandled,
    steelmanScore: steelman,
    structureFailures,
    substantiveCount: userNodes.length,
  };
}

function claimsMade(g: any): number {
  return (g.nodes as any[]).filter((n: any) => n.kind === "claim").length || 1;
}

function rawToDimensionScores(raw: RawMetrics): Partial<Record<CoachDimensionKey, number>> {
  const out: Partial<Record<CoachDimensionKey, number>> = {};
  if (raw.unsupportedRate !== null) out.evidence = Math.round((1 - Math.min(1, raw.unsupportedRate)) * 100);
  if (raw.rebuttalCoverage !== null) out.rebuttal = Math.round(raw.rebuttalCoverage * 100);
  if (raw.fallacyRate !== null) out.logic = Math.round((1 - Math.min(1, raw.fallacyRate)) * 100);
  if (raw.clarityProxy !== null) out.clarity = Math.round(raw.clarityProxy * 100);
  if (raw.impactHandled !== null) out.impact = Math.round(raw.impactHandled * 100);
  if (raw.steelmanScore !== null) out.steelmanning = Math.round(raw.steelmanScore);
  if (raw.structureFailures !== null) out.structure = Math.max(0, 100 - raw.structureFailures * 20);
  return out;
}

// --- main analytics -------------------------------------------------------------

/**
 * Aggregate per-debate assessments into a class-level skill profile.
 *
 * The pipeline is:
 *   student debates → observableAssessment → extractRaw → rawToDimensionScores
 *   → class mean per dimension → detect common problems → recommend drill
 */
export function analyseClass(
  classroomName: string,
  assessments: StudentDebateAssessment[],
  opts: { strugglingThreshold?: number; minAffectedForProblem?: number } = {},
): ClassSkillProfile {
  const strugglingThreshold = opts.strugglingThreshold ?? STRUGGLING_THRESHOLD;
  const minAffected = opts.minAffectedForProblem ?? 2;

  // Group by student, then compute each student's mean dimension scores
  const byStudent = new Map<string, Array<Partial<Record<CoachDimensionKey, number>>>>();
  let debateCount = 0;

  for (const item of assessments) {
    const raw = extractRaw(item.assessment);
    const dims = rawToDimensionScores(raw);
    debateCount++;
    const list = byStudent.get(item.studentId) ?? [];
    list.push(dims);
    byStudent.set(item.studentId, list);
  }

  // Class means per dimension
  const dimKeys = CLASS_DIMENSIONS;
  const classMeans: Record<CoachDimensionKey, number | null> = {} as any;
  const struggleCounts: Record<CoachDimensionKey, number> = {} as any;
  for (const k of dimKeys) { classMeans[k] = null; struggleCounts[k] = 0; }

  const perStudent: Record<string, Record<string, number>> = {};
  for (const [sid, dimList] of byStudent) {
    const studentMean: Record<string, number> = {};
    for (const k of dimKeys) {
      const vals = dimList.map((d) => d[k]).filter((v): v is number => v !== undefined && v !== null);
      if (!vals.length) continue;
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      studentMean[k] = Math.round(mean);
      classMeans[k] = classMeans[k] === null ? mean : ((classMeans[k] as number) * (byStudent.get(sid)!.length - 1) + mean) / (byStudent.get(sid)!.length);
    }
    perStudent[sid] = studentMean;
  }

  // Round class means and count strugglers
  const dimensions: DimensionScore[] = dimKeys.map((k) => {
    const mean = classMeans[k];
    const rounded = mean === null ? null : Math.round(mean);
    // Count strugglers across all students who have this dimension scored
    let below = 0;
    let scored = 0;
    for (const [, dimList] of byStudent) {
      const vals = dimList.map((d) => d[k]).filter((v): v is number => v !== undefined);
      if (!vals.length) continue;
      scored += 1;
      const studentMean = vals.reduce((s, v) => s + v, 0) / vals.length;
      if (studentMean < strugglingThreshold) below += 1;
    }
    struggleCounts[k] = below;
    return {
      key: k,
      label: CLASS_LABELS[k],
      mean: rounded ?? 0,
      strugglingShare: scored ? +(below / scored).toFixed(2) : 0,
      trend: null, // trend requires time-series data — future enhancement
    };
  });

  // Common problems: dimensions where ≥ minAffected students are struggling
  const commonProblems: CommonProblem[] = dimensions
    .map((d) => {
      const dk = d.key as CoachDimensionKey;
      return {
        dimension: dk,
        description: `${CLASS_LABELS[dk]} is weak for ${struggleCounts[dk]} of ${byStudent.size} students (${Math.round(d.strugglingShare * 100)}% below ${STRUGGLING_THRESHOLD}).`,
        affectedCount: struggleCounts[dk],
        totalStudents: byStudent.size,
        recommendedDrillMinutes: (d.mean ?? 0) < 35 ? 5 : 3,
      };
    })
    .filter((p) => p.affectedCount >= minAffected)
    .sort((a, b) => b.affectedCount - a.affectedCount);

  return {
    className: classroomName,
    studentsAnalysed: byStudent.size,
    debatesAnalysed: debateCount,
    dimensions,
    commonProblems,
    perStudent,
  };
}
