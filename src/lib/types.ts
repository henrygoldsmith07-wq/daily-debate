import type { ArgGraph } from "./argGraph";
import type { AssessmentStatus, ObservableAssessment } from "./observableAssessment";
import type { DebateFormat } from "./sprint";

export type DebateSide = "for" | "against";
export type InputMode = "text" | "voice";

export interface TopicSource {
  name: string;
  homepage: string;
  angle: string;
}

export interface DailyTopic {
  id: string;
  topic_date: string;
  title: string;
  prompt: string;
  category: string | null;
  sources: TopicSource[];
  created_at: string;
}

export interface TurnScores {
  // Legacy display buckets. They are projected from observable graph features
  // by observableAssessment.ts; model clients must not populate them directly.
  depth: number;
  evidence: number;
  logic: number;
  rebuttal: number;
  clarity: number;
}

export interface SoloDebate {
  id: string;
  user_id: string;
  topic_id: string;
  side: DebateSide;
  status: "active" | "completed";
  round_count: number;
  total_score: number | null;
  /** "sprint" (3 rounds, reduced measurement confidence) or "full" (5–12). */
  format: DebateFormat;
  /** Coaching snapshot jsonb: goal dimension + observed behaviour from the debate. */
  coaching: CoachingRecord | null;
  created_at: string;
  completed_at: string | null;
}

/** Persisted coaching loop record for one debate (solo_debates.coaching). */
export interface CoachingRecord {
  /** The dimension this debate was supposed to train (set at start). */
  dimension?: string | null;
  /** Explainable side assignment, when the user picked "Challenge me". */
  sideReason?: string | null;
  /** Observed behaviour from the finished debate (set at finish). */
  snapshot?: {
    responsesAnswered?: number;
    responseOpportunities?: number;
    unsupportedClaims?: number;
    majorClaims?: number;
    droppedOwn?: number;
  } | null;
  /** Whether the goal behaviour was demonstrated (null = not measurable). */
  demonstrated?: boolean | null;
  /** The repair-kind of this debate's main weakness (longitudinal tracking). */
  weaknessKind?: string | null;
  /** How many recent prior debates showed the same weakness (0 = first). */
  recurrenceCount?: number | null;
}

export interface SoloDebateTurn {
  id: string;
  debate_id: string;
  round_number: number;
  ai_message: string;
  user_message: string | null;
  input_mode: InputMode;
  scores: TurnScores | null;
  turn_score: number | null;
  feedback: string | null;
  assessment?: ObservableAssessment | null;
  created_at: string;
}

export interface Profile {
  id: string;
  username: string | null;
  total_points: number;
  level: number;
  current_streak: number;
  longest_streak: number;
  last_activity_date: string | null;
  created_at: string;
}

export interface PvpMatch {
  id: string;
  topic_id: string;
  player_a: string;
  player_b: string;
  player_a_side: DebateSide;
  status: "active" | "completed";
  round_limit: number;
  current_round: number;
  current_turn_player: string | null;
  turn_started_at?: string | null;
  winner_id: string | null;
  judge_verdict: PvpVerdict | null;
  created_at: string;
  completed_at: string | null;
}

export interface PvpTurn {
  id: string;
  match_id: string;
  player_id: string;
  round_number: number;
  message: string;
  input_mode: InputMode;
  created_at: string;
}

export interface VerdictJudgeDetail {
  judgeId: string;
  winner: "a" | "b" | "tie";
  playerAScore: number;
  playerBScore: number;
  scoreStatus?: AssessmentStatus;
  latencyMs?: number;
}

export interface PvpVerdict {
  winner: "a" | "b" | "tie";
  playerAScore: number;
  playerBScore: number;
  rationale: string;
  argGraph?: ArgGraph;
  /** `insufficient_evidence` means the numeric legacy fields are not a valid comparison. */
  scoreStatus?: AssessmentStatus;
  observableAssessment?: ObservableAssessment;
  breakdown?: {
    a: { claims: number; evidence: number; rebuttals: number; impacts: number; fallacies: number; droppedSuffered: number };
    b: { claims: number; evidence: number; rebuttals: number; impacts: number; fallacies: number; droppedSuffered: number };
  };
  decidingFactor?: string;
  // Judge uncertainty (populated by the ensemble judge; absent on older stored verdicts).
  // These are PROVISIONAL HEURISTICS over 1–2 judge scores — not inferential
  // statistics. They are displayed as such and must never gate payouts or
  // ranking on their own.
  confidence?: number; // 0..1 — heuristic agreement estimate from score gap + judge votes; NOT calibrated
  scoreGapEstimate?: { lo: number; hi: number }; // provisional band over the score gap (heuristic spread across judge scores)
  judgeSplit?: { a: number; b: number; tie: number }; // raw judge vote share — not a posterior
  isTie?: boolean; // true when the judge genuinely can't separate the two sides
  tieReason?: string;
  judges?: VerdictJudgeDetail[]; // per-judge verdicts (empty for single-judge fallback-less runs)
  /** Version fingerprint: provider/model/prompt/engine/schema/temp/ensemble */
  fingerprint?: {
    provider: string;
    model: string;
    revision?: string | null;
    promptVersion: number;
    scoringEngineVersion: number;
    graphSchemaVersion: number;
    temperature: number;
    ensemble: string[];
  };
  /** Evaluation envelope stamp (schema + policy version at evaluation time). Absent on pre-stamp rows. */
  evaluation?: EvaluationStamp;
}

/** Stamped on every stored evaluation so results stay attributable when policy/schema change. */
export interface EvaluationStamp {
  schemaVersion: number;
  policyVersion: number;
  evaluatedAt: string;
}

// Alias: the judge modules export PvpJudgeResult; app code uses PvpVerdict. Keep both names.
export type PvpJudgeResult = PvpVerdict;

export interface DebateSummary {
  overallFeedback: string;
  strengths: string[];
  improvements: string[];
  argGraph?: ArgGraph;
  assessment?: ObservableAssessment;
}

export const MIN_ROUNDS = 5;
// Solo debates must finish after this many rounds: each turn costs a model
// call, and an uncapped debate can run indefinitely. PvP is capped by the
// `pvp_matches.round_limit` column — PVP_ROUNDS must match its default (5).
export const MAX_ROUNDS = 12;
export const PVP_ROUNDS = 5;
// A PvP turn older than this can be claimed as a forfeit by the waiting
// opponent, and new submissions past it are rejected as late.
export const TURN_ABANDON_MINUTES = 30;

