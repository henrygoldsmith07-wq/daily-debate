import { MIN_RATERS_PER_ITEM, RATING_COLLECTION_TARGET } from "./corpus";
import { consensusLabel } from "./corpusAdjudication";
import type { WinnerLabel } from "./humanCorpus";

export type HumanGroundTruthState =
  | "unrated"
  | "insufficient"
  | "unresolved"
  | "stale_adjudication"
  | "consensus"
  | "adjudicated";

export interface HumanGroundTruthItem {
  status?: string | null;
  side_mapping?: unknown;
}

export interface HumanGroundTruthRating {
  rater_id: string;
  winner: string;
}

export interface HumanGroundTruthResolution {
  state: HumanGroundTruthState;
  winner: WinnerLabel | null;
  ratings: number;
  reason: string;
}

function isWinner(value: unknown): value is WinnerLabel {
  return value === "a" || value === "b" || value === "tie";
}

function mappingOf(item: HumanGroundTruthItem): Record<string, unknown> {
  return item.side_mapping && typeof item.side_mapping === "object"
    ? (item.side_mapping as Record<string, unknown>)
    : {};
}

/**
 * Canonical human-truth resolver used by published metrics and live judge
 * comparison. An explicit, non-stale adjudication wins. Otherwise only a
 * strict non-tie rater consensus is usable; splits and tie-majorities remain
 * unresolved instead of being silently converted into ground truth.
 */
export function resolveHumanGroundTruth(
  item: HumanGroundTruthItem,
  ratings: HumanGroundTruthRating[],
): HumanGroundTruthResolution {
  const mapping = mappingOf(item);
  const validRatings = ratings.filter((r) => isWinner(r.winner));

  if (mapping.adjudication_stale === true) {
    return {
      state: "stale_adjudication",
      winner: null,
      ratings: validRatings.length,
      reason: "A rating changed after adjudication; moderator review is required again.",
    };
  }

  const storedWinner = mapping.consensus_winner;
  if (item.status === "adjudicated" && isWinner(storedWinner)) {
    if (validRatings.length < RATING_COLLECTION_TARGET) {
      return {
        state: "stale_adjudication",
        winner: null,
        ratings: validRatings.length,
        reason: `Adjudication predates the ${RATING_COLLECTION_TARGET}-rating collection target and requires review.`,
      };
    }
    return {
      state: "adjudicated",
      winner: storedWinner,
      ratings: validRatings.length,
      reason: "Explicit moderator adjudication.",
    };
  }

  if (validRatings.length === 0) {
    return { state: "unrated", winner: null, ratings: 0, reason: "No independent ratings yet." };
  }
  if (validRatings.length < MIN_RATERS_PER_ITEM) {
    return {
      state: "insufficient",
      winner: null,
      ratings: validRatings.length,
      reason: `Needs at least ${MIN_RATERS_PER_ITEM} independent ratings.`,
    };
  }

  const consensus = consensusLabel(
    validRatings.map((r) => ({ raterId: r.rater_id, winner: r.winner as WinnerLabel })),
  );
  if (consensus.winner === "tie" || consensus.margin <= 0) {
    return {
      state: "unresolved",
      winner: null,
      ratings: validRatings.length,
      reason: "Independent raters do not have a strict usable winner consensus.",
    };
  }

  return {
    state: "consensus",
    winner: consensus.winner,
    ratings: validRatings.length,
    reason: "Strict independent-rater consensus.",
  };
}

export function hasUsableHumanGroundTruth(
  resolution: HumanGroundTruthResolution,
): resolution is HumanGroundTruthResolution & { winner: WinnerLabel; state: "consensus" | "adjudicated" } {
  return (resolution.state === "consensus" || resolution.state === "adjudicated") && resolution.winner !== null;
}
