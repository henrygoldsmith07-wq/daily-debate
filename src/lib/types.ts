import type { ArgGraph } from "./argGraph";
import type { AssessmentStatus, ObservableAssessment } from "./observableAssessment";

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
  created_at: string;
  completed_at: string | null;
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
  confidence?: number; // 0..1 — calibrated from score gap + inter-judge agreement
  scoreCI?: { lo: number; hi: number }; // 95% CI over the score gap
  winnerCI?: { a: number; b: number; tie: number }; // posterior over the winner from judge votes
  isTie?: boolean; // true when the judge genuinely can't separate the two sides
  tieReason?: string;
  judges?: VerdictJudgeDetail[]; // per-judge verdicts (empty for single-judge fallback-less runs)
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

