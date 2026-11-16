/**
 * Where people stand on a motion, as the Today card and the PvP lobby show it.
 *
 * A split drawn from a handful of positions is noise, and on a quiet day it
 * can identify the one other person who answered. Below MIN_POSITIONS_TO_SHOW
 * the view says nothing beyond the learner's own position; above it, it shows
 * the split as rounded shares that always add up to 100.
 */
export type MotionPosition = "for" | "against";

export const MIN_POSITIONS_TO_SHOW = 10;

export interface PositionCounts {
  for: number;
  against: number;
}

export interface PositionTallyView {
  total: number;
  forShare: number;
  againstShare: number;
}

export function isMotionPosition(value: unknown): value is MotionPosition {
  return value === "for" || value === "against";
}

export function oppositePosition(position: MotionPosition): MotionPosition {
  return position === "for" ? "against" : "for";
}

export function positionTallyView(counts: PositionCounts | null | undefined): PositionTallyView | null {
  if (!counts) return null;
  const forCount = Math.max(0, Math.floor(counts.for));
  const againstCount = Math.max(0, Math.floor(counts.against));
  const total = forCount + againstCount;
  if (total < MIN_POSITIONS_TO_SHOW) return null;
  const forShare = Math.round((forCount / total) * 100);
  return { total, forShare, againstShare: 100 - forShare };
}
