// Canonical learner model — ONE place learner state is assembled and the next
// practice target is chosen.
//
// Before this module, learner state was spread across skillLedger, skillProfile,
// coachingGoal, dailyFocus, repair and retest modules. Each was honest on its
// own, but there was no single answer to the questions the product exists to
// answer:
//
//   What did I do badly?  Why does it matter?  How did I repair it?
//   Did I later demonstrate the repair?  What should I practise next?
//
// This model consumes the existing pure domain pieces (skillLedger points,
// repair episodes, deliberate-retest observations) and derives those answers
// with the honesty rules baked in:
//
//   - a skill reading is tagged with how it was produced (observed / extracted /
//     deterministic / provisional / validated) AND how strong the claim about
//     THIS learner is — never one blended "ability score";
//   - a successful repair is formative practice, never proof of mastery;
//     only a later, unprompted, different-topic debate can demonstrate it;
//   - insufficient evidence is an explicit state, never a zero;
//   - the recommended target carries its reason, its observable behaviour and
//     an honest caveat — an explainable policy, not a black-box optimiser.
//
// Pure — routes pass already-loaded rows. No I/O, no AI calls.

import type { MetricKey, SkillMetricPoint } from "./skillLedger";
import {
  SKILL_DIMENSION_KEYS,
  SKILL_DIMENSIONS,
  type SkillDimensionKey,
  evidenceLevelForSkill,
  metricGoodness,
  metricsForSkill,
  skillDescription,
  skillKeyForRepairKind,
  skillLabel,
  type EvidenceLevel,
} from "./skillTaxonomy";
import { WEAKNESS_CONSEQUENCE } from "./retest";

/** Sample size below which a reading is provisional rather than descriptive. */
export const MIN_SKILL_SAMPLE = 3;
/** Sample size at which an observed reading can be described with confidence. */
export const HIGH_CONFIDENCE_SAMPLE = 8;

/**
 * The epistemic status of a claim about the learner. This is deliberately a
 * different axis from the instrument EvidenceLevel: an "observed" signal can
 * still only support a "provisional" claim when the sample is thin.
 *
 * `validated` is reserved for claims that cleared an external quality gate.
 * No reading derived from a learner's own debates is ever "validated" — the
 * product does not manufacture certainty.
 */
export type ClaimKind =
  | "observation"
  | "inference"
  | "provisional"
  | "validated";

export const CLAIM_KIND_LABEL: Record<ClaimKind, string> = {
  observation: "Observed behaviour",
  inference: "Model-inferred",
  provisional: "Provisional (small sample)",
  validated: "Externally validated",
};

export const CLAIM_KIND_DETAIL: Record<ClaimKind, string> = {
  observation: "Describes behaviour that was directly counted in your debates.",
  inference: "Rests partly on a model reading the debate's structure — useful, not certain.",
  provisional: "Too few observed debates to describe yet. Directional at best.",
  validated: "Cleared an external quality gate. Learner debate data never reaches here.",
};

export type Confidence = "low" | "medium" | "high";
export type Trend = "improving" | "declining" | "steady" | "unknown";

/** One of the seven canonical skills, with its observed state. */
export interface SkillReading {
  key: SkillDimensionKey;
  label: string;
  description: string;
  /** Normalised observed level 0..1 across the skill's signals, or null with no data. */
  level: number | null;
  /** Display score 0..100 (rounded) — a descriptive summary, NOT an ability claim. */
  score: number | null;
  /** Debates that contributed at least one observable signal. */
  sampleSize: number;
  /** How the underlying signals are produced (weakest link). */
  instrument: EvidenceLevel;
  /** How strong the claim about THIS learner is. */
  claim: ClaimKind;
  confidence: Confidence;
  trend: Trend;
  /** Non-overclaiming sentence for the learner. */
  note: string;
  isStrength: boolean;
  isWeakness: boolean;
}

/** Repair provenance, grouped by skill. A successful repair is not mastery. */
export interface SkillRepairState {
  skill: SkillDimensionKey;
  label: string;
  /** Distinct (debate, skill) repair episodes that crossed the threshold. */
  successfulEpisodes: number;
  /** Distinct episodes that never crossed the threshold (retryable, never counted as wins). */
  failedOnlyEpisodes: number;
  /** Raw rewrite submissions (>= episodes; retries collapsed). */
  totalAttempts: number;
  lastRepairedAt: string | null;
  /** A successful repair with no later observable debate to test it. */
  awaitingRetest: boolean;
  /** A later, different-topic debate showed the behaviour unprompted. */
  demonstratedLater: boolean;
  /** A later debate offered a genuine opportunity but the behaviour did not appear. */
  retestedNotDemonstrated: boolean;
  status:
    | "repaired-awaiting-retest"
    | "repaired-demonstrated-later"
    | "repaired-not-yet-demonstrated"
    | "still-struggling"
    | "not-attempted";
}

export type RetestStatus = "demonstrated" | "not-demonstrated" | "no-opportunity" | "pending";

export interface RetestRecord {
  skill: SkillDimensionKey;
  label: string;
  status: RetestStatus;
  at: string | null;
  /** Plain-language truth about what the later debate did and did not show. */
  detail: string;
}

/** A recommended practice target with its full, honest explanation. */
export interface PracticeTarget {
  skill: SkillDimensionKey;
  label: string;
  /** Why this target — plain language. */
  reason: string;
  /** What observable behaviour today's practice will watch for. */
  observable: string;
  /** The grounding evidence (sample, counts) behind the choice. */
  evidence: string;
  /** Honest caveat — low sample, not-yet-validated, repair-is-not-mastery, etc. */
  caveat: string;
  priority:
    | "retest-due"
    | "persistent-weakness"
    | "needs-evidence"
    | "general";
}

/** Direct answers to the five questions the product must make obvious. */
export interface LearnerQuestions {
  whatDidIDoBadly: string;
  whyDoesItMatter: string;
  howDidIRepairIt: string;
  didIDemonstrateIt: string;
  whatShouldIPractiseNext: string;
}

export interface LearnerModel {
  generatedAt: string;
  debatesObserved: number;
  /** All seven skills in canonical order. */
  skills: SkillReading[];
  strengths: SkillReading[];
  /** Evidence-grounded weaknesses, weakest first. */
  weaknesses: SkillReading[];
  repairs: SkillRepairState[];
  retests: RetestRecord[];
  /** The loop the learner is currently inside (mid-repair or a live weakness). */
  currentFocus: PracticeTarget | null;
  /** The single recommended next action. */
  nextPractice: PracticeTarget | null;
  questions: LearnerQuestions;
  honestyNote: string;
}

// ---------------------------------------------------------------------------
// Inputs (decoupled from DB shapes; routes map rows into these)
// ---------------------------------------------------------------------------

export interface RepairEpisodeInput {
  /** RepairKind as a string (canonicalised internally). */
  targetKind: string;
  debateId: string;
  createdAt: string;
  /** Whether ANY rewrite in this episode crossed the repair threshold. */
  succeeded: boolean;
}

export interface RetestInput {
  targetKind: string;
  /** The debate the repair came from. */
  repairDebateId: string;
  /** The later, different-topic debate assigned to test the repair. */
  assignedDebateId: string;
  completedAt: string | null;
  /** Did the later debate genuinely offer a chance to show the skill? */
  observable: boolean | null;
  /** Was the behaviour demonstrated unprompted? */
  demonstrated: boolean | null;
}

export interface LearnerModelInput {
  points: SkillMetricPoint[];
  repairs: RepairEpisodeInput[];
  retests: RetestInput[];
  now?: string;
}

// ---------------------------------------------------------------------------
// Per-skill observation
// ---------------------------------------------------------------------------

function skillObservation(
  points: SkillMetricPoint[],
  key: SkillDimensionKey,
): { level: number | null; score: number | null; sampleSize: number } {
  const metrics = metricsForSkill(key);
  const values: number[] = [];
  let sampleSize = 0;
  for (const point of points) {
    let contributed = false;
    for (const metric of metrics) {
      const g = metricGoodness(point.metrics[metric as MetricKey], metric as MetricKey);
      if (g !== null) {
        values.push(g);
        contributed = true;
      }
    }
    if (contributed) sampleSize++;
  }
  if (!values.length) return { level: null, score: null, sampleSize: 0 };
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return {
    level: mean,
    score: Math.max(0, Math.min(100, Math.round(mean * 100))),
    sampleSize,
  };
}

function skillTrend(points: SkillMetricPoint[], key: SkillDimensionKey): Trend {
  if (points.length < 4) return "unknown";
  const metrics = metricsForSkill(key);
  const mean = (slice: SkillMetricPoint[]): number | null => {
    const vals: number[] = [];
    for (const p of slice) {
      for (const metric of metrics) {
        const g = metricGoodness(p.metrics[metric as MetricKey], metric as MetricKey);
        if (g !== null) vals.push(g);
      }
    }
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  };
  const half = Math.floor(points.length / 2);
  const early = mean(points.slice(0, half));
  const late = mean(points.slice(points.length - half));
  if (early === null || late === null) return "unknown";
  const delta = late - early;
  if (delta > 0.04) return "improving";
  if (delta < -0.04) return "declining";
  return "steady";
}

function claimKindFor(sampleSize: number, instrument: EvidenceLevel): ClaimKind {
  if (sampleSize < MIN_SKILL_SAMPLE) return "provisional";
  if (instrument === "extracted") return "inference";
  return "observation";
}

function confidenceFor(sampleSize: number, claim: ClaimKind): Confidence {
  if (claim === "provisional" || sampleSize < MIN_SKILL_SAMPLE) return "low";
  if (sampleSize >= HIGH_CONFIDENCE_SAMPLE && claim === "observation") return "high";
  return "medium";
}

function readingNote(reading: {
  level: number | null;
  sampleSize: number;
  claim: ClaimKind;
  trend: Trend;
}): string {
  if (reading.level === null) {
    return "No observed debates have produced a signal for this skill yet — not a low score, an open question.";
  }
  if (reading.claim === "provisional") {
    return `Only ${reading.sampleSize} observed debate${reading.sampleSize === 1 ? "" : "s"} so far — early signal, not a verdict.`;
  }
  const trendLine =
    reading.trend === "improving"
      ? "Trending up across your recent debates."
      : reading.trend === "declining"
        ? "Trending down across your recent debates."
        : reading.trend === "steady"
          ? "Holding steady across your recent debates."
          : "";
  const base =
    reading.level >= 0.7
      ? "A demonstrated strength in your observed debates."
      : reading.level >= 0.5
        ? "Developing — room to grow in your observed debates."
        : "One of the skills with the most room to grow in your observed debates.";
  return trendLine ? `${base} ${trendLine}` : base;
}

function buildSkillReadings(points: SkillMetricPoint[]): SkillReading[] {
  return SKILL_DIMENSION_KEYS.map((key) => {
    const { level, score, sampleSize } = skillObservation(points, key);
    const instrument = evidenceLevelForSkill(key);
    const claim = claimKindFor(sampleSize, instrument);
    const confidence = confidenceFor(sampleSize, claim);
    const trend = skillTrend(points, key);
    const isStrength = level !== null && sampleSize >= MIN_SKILL_SAMPLE && level >= 0.68;
    const isWeakness = level !== null && sampleSize >= MIN_SKILL_SAMPLE && level <= 0.5;
    return {
      key,
      label: skillLabel(key),
      description: skillDescription(key),
      level,
      score,
      sampleSize,
      instrument,
      claim,
      confidence,
      trend,
      note: readingNote({ level, sampleSize, claim, trend }),
      isStrength,
      isWeakness,
    } satisfies SkillReading;
  });
}

// ---------------------------------------------------------------------------
// Repair episodes and retest provenance
// ---------------------------------------------------------------------------

interface Episode {
  skill: SkillDimensionKey;
  debateId: string;
  targetKind: string;
  succeeded: boolean;
  firstAt: string;
  successAt: string | null;
  attempts: number;
}

/** Collapse raw rewrite attempts to one episode per (debate, skill) so retries
 *  never inflate intervention counts. */
function collapseEpisodes(repairs: RepairEpisodeInput[]): Episode[] {
  const grouped = new Map<string, RepairEpisodeInput[]>();
  for (const repair of repairs) {
    const skill = skillKeyForRepairKind(repair.targetKind);
    if (!skill) continue;
    const key = `${repair.debateId}|${repair.targetKind}`;
    const rows = grouped.get(key) ?? [];
    rows.push(repair);
    grouped.set(key, rows);
  }
  const episodes: Episode[] = [];
  for (const rows of grouped.values()) {
    const chronological = [...rows].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    const first = chronological[0];
    const firstSuccess = chronological.find((r) => r.succeeded) ?? null;
    const skill = skillKeyForRepairKind(first.targetKind);
    if (!skill) continue;
    episodes.push({
      skill,
      debateId: first.debateId,
      targetKind: first.targetKind,
      succeeded: firstSuccess !== null,
      firstAt: first.createdAt,
      successAt: firstSuccess?.createdAt ?? null,
      attempts: chronological.length,
    });
  }
  return episodes.sort((a, b) => Date.parse(a.firstAt) - Date.parse(b.firstAt));
}

function buildRepairStates(
  episodes: Episode[],
  retests: RetestInput[],
): SkillRepairState[] {
  return SKILL_DIMENSION_KEYS.map((skill) => {
    const mine = episodes.filter((e) => e.skill === skill);
    const successful = mine.filter((e) => e.succeeded);
    const failedOnly = mine.filter((e) => !e.succeeded);
    const successAts = successful
      .map((e) => e.successAt)
      .filter((v): v is string => v !== null)
      .sort((a, b) => Date.parse(a) - Date.parse(b));
    const lastRepairedAt = successAts.length ? successAts[successAts.length - 1] : null;

    // A real retest must be observable (a genuine opportunity arose). Anything
    // else is "insufficient opportunity" and can never clear a pending retest.
    const skillRetests = retests.filter(
      (r) => skillKeyForRepairKind(r.targetKind) === skill && r.observable === true && r.completedAt,
    );
    const demonstratedLater = skillRetests.some((r) => r.demonstrated === true);
    const retestedNotDemonstrated = skillRetests.length > 0 && !demonstratedLater;
    const awaitingRetest = successful.length > 0 && skillRetests.length === 0;

    let status: SkillRepairState["status"];
    if (successful.length === 0 && mine.length > 0) status = "still-struggling";
    else if (successful.length === 0) status = "not-attempted";
    else if (demonstratedLater) status = "repaired-demonstrated-later";
    else if (retestedNotDemonstrated) status = "repaired-not-yet-demonstrated";
    else status = "repaired-awaiting-retest";

    return {
      skill,
      label: skillLabel(skill),
      successfulEpisodes: successful.length,
      failedOnlyEpisodes: failedOnly.length,
      totalAttempts: mine.reduce((s, e) => s + e.attempts, 0),
      lastRepairedAt,
      awaitingRetest,
      demonstratedLater,
      retestedNotDemonstrated,
      status,
    } satisfies SkillRepairState;
  });
}

function buildRetestRecords(retests: RetestInput[]): RetestRecord[] {
  return retests
    .map((r): RetestRecord | null => {
      const skill = skillKeyForRepairKind(r.targetKind);
      if (!skill) return null;
      let status: RetestStatus;
      let detail: string;
      if (r.observable !== true) {
        status = "no-opportunity";
        detail =
          "That debate never gave the skill a real chance to appear, so it says nothing about whether the repair stuck.";
      } else if (r.demonstrated === true) {
        status = "demonstrated";
        detail =
          "The repaired behaviour appeared on its own, without prompting. One observation — later debates are what make it a pattern.";
      } else {
        status = "not-demonstrated";
        detail =
          "The situation came up and the behaviour didn't appear this time. The skill stays on your training list.";
      }
      return {
        skill,
        label: skillLabel(skill),
        status,
        at: r.completedAt,
        detail,
      } satisfies RetestRecord;
    })
    .filter((v): v is RetestRecord => v !== null)
    .sort((a, b) => Date.parse(b.at ?? "0") - Date.parse(a.at ?? "0"));
}

// ---------------------------------------------------------------------------
// Adaptive practice selection — an explainable policy
// ---------------------------------------------------------------------------

/** What today's practice will watch for, in observable terms. */
export function skillObservable(skill: SkillDimensionKey): string {
  switch (skill) {
    case "evidence":
      return "Whether your major claims name a real, checkable source.";
    case "rebuttal":
      return "Whether you answer the opponent's actual point instead of talking past it.";
    case "logic":
      return "Whether each claim states the reason that supports it, with no skipped step.";
    case "clarity":
      return "Whether one clean claim is kept separate from the reason behind it.";
    case "impact":
      return "Whether you say what changes and why it outweighs the opponent's case.";
    case "steelmanning":
      return "Whether you state the opposing case at its strongest before answering it.";
    case "structure":
      return "Whether you close every thread you open and stay internally consistent.";
  }
}

function consequenceFor(skill: SkillDimensionKey): string {
  return WEAKNESS_CONSEQUENCE[skill] ?? skillDescription(skill);
}

function formatDate(iso: string | null): string {
  if (!iso) return "an earlier session";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "an earlier session";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(d);
}

/**
 * The one explainable selection policy. Priority, most urgent first:
 *
 *   1. retest-due         — a successful repair is waiting to be tested on a
 *                           new topic (the core loop's open promise);
 *   2. persistent-weakness — the weakest skill with enough observed evidence;
 *   3. needs-evidence      — a skill we cannot yet judge (thin sample);
 *   4. general             — a balanced rep on the weakest available skill.
 *
 * Every branch returns its reason, observable behaviour, grounding evidence and
 * an honest caveat. This is a transparent policy, not a claim of optimality.
 */
export function selectNextPractice(
  skills: SkillReading[],
  repairs: SkillRepairState[],
): PracticeTarget | null {
  // 1. Close the open loop: the oldest successful repair still awaiting a real retest.
  const awaiting = repairs
    .filter((r) => r.awaitingRetest && r.lastRepairedAt)
    .sort((a, b) => Date.parse(a.lastRepairedAt!) - Date.parse(b.lastRepairedAt!));
  if (awaiting.length) {
    const r = awaiting[0];
    return {
      skill: r.skill,
      label: r.label,
      priority: "retest-due",
      reason: `You repaired ${r.label.toLowerCase()} on ${formatDate(r.lastRepairedAt)}. Today's debate will test whether you can use it unprompted on a new topic.`,
      observable: skillObservable(r.skill),
      evidence: `A successful repair is saved from ${formatDate(r.lastRepairedAt)}; no later debate has yet given it a real test.`,
      caveat:
        "A repair is practice, not proof. Only a later, different-topic debate where you use it without a cue counts as demonstration.",
    };
  }

  const withEvidence = skills.filter((s) => s.level !== null && s.sampleSize >= MIN_SKILL_SAMPLE);
  // 2. Persistent weakness: the weakest skill we actually have enough evidence for.
  if (withEvidence.length) {
    const weakest = [...withEvidence].sort((a, b) => (a.level as number) - (b.level as number))[0];
    if (weakest.level !== null && weakest.level <= 0.5) {
      return {
        skill: weakest.key,
        label: weakest.label,
        priority: "persistent-weakness",
        reason: `${weakest.label} is still the skill with the most room to grow across your observed debates, so today's practice targets it.`,
        observable: skillObservable(weakest.key),
        evidence: `${weakest.label} is drawn from ${weakest.sampleSize} observed debate${weakest.sampleSize === 1 ? "" : "s"} (${weakest.instrument === "extracted" ? "partly model-read structure" : "counted from your moves"}).`,
        caveat:
          weakest.claim === "inference"
            ? "This reading leans on a model reading your argument structure — useful, not certain."
            : "This describes your observed behaviour so far, not a fixed ability.",
      };
    }
  }

  // 3. Need more evidence: the skill we can least judge right now.
  const thin = skills
    .filter((s) => s.level === null || s.sampleSize < MIN_SKILL_SAMPLE)
    .sort((a, b) => a.sampleSize - b.sampleSize);
  if (thin.length) {
    const s = thin[0];
    return {
      skill: s.key,
      label: s.label,
      priority: "needs-evidence",
      reason: `There isn't enough observed evidence to judge ${s.label.toLowerCase()} yet, so today's debate is a chance to gather it.`,
      observable: skillObservable(s.key),
      evidence:
        s.sampleSize === 0
          ? `No debate has produced a ${s.label} signal yet.`
          : `Only ${s.sampleSize} observed debate${s.sampleSize === 1 ? "" : "s"} have produced a ${s.label} signal.`,
      caveat: "Insufficient evidence is not a low score — it is an open question this debate can start to answer.",
    };
  }

  // 4. General practice on the weakest available skill.
  const scored = skills.filter((s) => s.level !== null);
  const weakest = scored.length ? [...scored].sort((a, b) => (a.level as number) - (b.level as number))[0] : skills[0];
  return {
    skill: weakest.key,
    label: weakest.label,
    priority: "general",
    reason: `A balanced rep practising ${weakest.label.toLowerCase()} — currently your lowest observed skill.`,
    observable: skillObservable(weakest.key),
    evidence: `Based on ${weakest.sampleSize} observed debate${weakest.sampleSize === 1 ? "" : "s"}.`,
    caveat: "Scores summarise observed behaviour; they are not a validated measure of ability.",
  };
}

function currentFocusFor(
  skills: SkillReading[],
  repairs: SkillRepairState[],
  next: PracticeTarget | null,
): PracticeTarget | null {
  const awaiting = repairs.find((r) => r.awaitingRetest);
  if (awaiting) {
    return {
      skill: awaiting.skill,
      label: awaiting.label,
      priority: "retest-due",
      reason: `You repaired ${awaiting.label.toLowerCase()} and are now testing whether it holds without prompting.`,
      observable: skillObservable(awaiting.skill),
      evidence: `Repair saved ${formatDate(awaiting.lastRepairedAt)}; the deliberate retest is still open.`,
      caveat: "You are inside the repair → retest loop. One later demonstration does not make a habit.",
    };
  }
  return next;
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

function questionsFor(
  skills: SkillReading[],
  repairs: SkillRepairState[],
  next: PracticeTarget | null,
): LearnerQuestions {
  const weaknesses = skills
    .filter((s) => s.isWeakness)
    .sort((a, b) => (a.level as number) - (b.level as number));
  const primary = weaknesses[0] ?? null;

  const whatDidIDoBadly = primary
    ? `${primary.label} was the skill with the most room to grow in your recent debates. ${primary.note}`
    : "No single weakness stands out yet — not enough observed debates to name one.";

  const whyDoesItMatter = primary ? consequenceFor(primary.key) : "";

  const repairState = primary ? repairs.find((r) => r.skill === primary.key) : null;
  const howDidIRepairIt = repairState
    ? repairState.status === "not-attempted"
      ? "You haven't run the repair exercise for this yet."
      : repairState.successfulEpisodes > 0
        ? `You completed a successful repair exercise (${repairState.successfulEpisodes} time${repairState.successfulEpisodes === 1 ? "" : "s"}). That's practice, not proof — it shows you can do it when prompted.`
        : `You've started the repair but haven't crossed the line yet (${repairState.totalAttempts} attempt${repairState.totalAttempts === 1 ? "" : "s"}). Keep going — failed attempts stay retryable and never count as wins.`
    : "No repair recorded for this skill yet.";

  const didIDemonstrateIt = repairState
    ? repairState.demonstratedLater
      ? "Yes — in a later, different-topic debate you used it without prompting. One demonstration; later reps turn it into a pattern."
      : repairState.retestedNotDemonstrated
        ? "Not yet — a later debate offered the chance but the behaviour didn't appear this time."
        : repairState.awaitingRetest
          ? "Not yet — no later debate has tested it. That's the open loop."
          : "Not applicable yet — no successful repair to test."
    : "Not applicable yet — no repair recorded.";

  return {
    whatDidIDoBadly,
    whyDoesItMatter,
    howDidIRepairIt,
    didIDemonstrateIt,
    whatShouldIPractiseNext: next ? next.reason : "Complete a debate to get a recommended focus.",
  };
}

export function buildLearnerModel(input: LearnerModelInput): LearnerModel {
  const points = [...input.points].sort(
    (a, b) => Date.parse(a.completedAt) - Date.parse(b.completedAt),
  );
  const skills = buildSkillReadings(points);
  const episodes = collapseEpisodes(input.repairs);
  const repairs = buildRepairStates(episodes, input.retests);
  const retests = buildRetestRecords(input.retests);

  const nextPractice = selectNextPractice(skills, repairs);
  const currentFocus = currentFocusFor(skills, repairs, nextPractice);
  const questions = questionsFor(skills, repairs, nextPractice);

  return {
    generatedAt: input.now ?? new Date().toISOString(),
    debatesObserved: points.length,
    skills,
    strengths: skills.filter((s) => s.isStrength),
    weaknesses: skills
      .filter((s) => s.isWeakness)
      .sort((a, b) => (a.level as number) - (b.level as number)),
    repairs,
    retests,
    currentFocus,
    nextPractice,
    questions,
    honestyNote:
      "Every reading here is drawn from your own stored debates: some counted directly from your moves, some read by a model, some deterministic formulas. None of it is a validated measure of your ability — it is an honest description of observed behaviour so far. A successful repair is practice; only a later, unprompted, different-topic debate demonstrates it.",
  };
}

// Convenience re-exports so callers get the vocabulary from one place.
export type { SkillDimensionKey, EvidenceLevel };
export { skillLabel, skillDescription, SKILL_DIMENSIONS, SKILL_DIMENSION_KEYS };
