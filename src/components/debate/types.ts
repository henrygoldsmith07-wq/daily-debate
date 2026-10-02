// Shared types for the solo debate room.

import type { SoloDebate, SoloDebateTurn, DebateSummary, TrainingSummary } from "@/lib/types";
import type { ArgGraph } from "@/lib/argGraph";
import type { ResultSnapshot } from "@/lib/resultSnapshot";

export interface RewardEventView {
  kind: string;
  xp: number;
  label: string;
  detail?: string;
  dimension?: string;
}

/** The finish-route payload the client renders as a fresh result. */
export interface DebateSummaryPayload {
  totalScore: number;
  performanceScore: number;
  bonusXP: number;
  rewardEvents: RewardEventView[];
  summary: DebateSummary;
  format?: "sprint" | "full";
  honesty?: { confidence: "standard" | "reduced"; note: string | null };
  snapshot?: ResultSnapshot;
  trainingSummary?: TrainingSummary;
  summarySource?: "ai" | "fallback";
}

/** The server-rebuilt result a replayed (already completed) debate arrives with. */
export interface CompletedResultView {
  totalScore: number;
  performanceScore: number;
  argGraph?: ArgGraph;
  snapshot?: ResultSnapshot | null;
  /** Whether a repair has already been recorded for this debate (server-side). */
  repaired?: boolean;
  honestyNote?: string | null;
  summary?: DebateSummary;
  bonusXP?: number;
  rewardEvents?: RewardEventView[];
  trainingSummary?: TrainingSummary;
  summarySource?: "ai" | "fallback";
}

/** The shared result/replay story: action first, coaching second, detail last. */
export interface ReplayView {
  totalScore: number;
  performanceScore: number;
  snapshot: ResultSnapshot | null;
  argGraph: ArgGraph | null;
  /** Whether a repair has already been recorded for this debate. */
  repaired: boolean;
  bonusXP?: number;
  topRewardLabel?: string;
  topRewardDetail?: string;
  honestyNote?: string | null;
  summary?: DebateSummary;
  trainingSummary?: TrainingSummary;
  summarySource?: "ai" | "fallback";
  fresh?: boolean;
}

export interface DebateRoomProps {
  debate: SoloDebate;
  topic: { title: string; prompt: string };
  initialTurns: SoloDebateTurn[];
  completedResult?: CompletedResultView | null;
}
