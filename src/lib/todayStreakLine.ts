/**
 * Small Today lines copied from Wordle and Duolingo. Each one says only what
 * the stored profile shows; none names a skill (retestDisclosure.ts) or a
 * score.
 *
 * - Next-motion countdown (Wordle): the shared motion rolls over at 00:00 UTC
 *   (dailyTopic.todayIso), so the countdown targets that instant, whatever the
 *   learner's timezone.
 * - Streak-at-risk line (Duolingo): in the evening of a day not yet practised.
 * - Welcome back (Duolingo): after a streak has lapsed, name the best streak
 *   instead of showing nothing.
 * - Stats line (Wordle): best streak and debates finished.
 */

import type { StreakStatus } from "./streakFreeze";

const DAY_MS = 86_400_000;

/** Local hour from which an unpractised streak is called out on Today. */
export const STREAK_AT_RISK_HOUR = 18;

/** Milliseconds until the next shared motion (00:00 UTC). */
export function msUntilNextMotion(now: Date): number {
  const t = now.getTime();
  if (!Number.isFinite(t)) return 0;
  return DAY_MS - (((t % DAY_MS) + DAY_MS) % DAY_MS);
}

/** "7h 12m", "45m", "under a minute". */
export function formatCountdown(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "under a minute";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h ${rest}m` : `${rest}m`;
}

export interface TodayStreakLineInput {
  status: StreakStatus;
  longestStreak: number;
  /** The learner has practised at least once (profiles.last_activity_date is set). */
  hasPractised: boolean;
  /** The learner's local hour now, 0-23. */
  localHour: number;
}

export type TodayStreakLine = { kind: "at_risk" | "welcome_back"; text: string } | null;

export function todayStreakLine(input: TodayStreakLineInput): TodayStreakLine {
  const { status } = input;
  if (status.state === "due_today" && input.localHour >= STREAK_AT_RISK_HOUR) {
    const days = status.streak === 1 ? "1-day" : `${status.streak}-day`;
    return { kind: "at_risk", text: `Your ${days} streak ends at midnight. Today's motion takes about four minutes.` };
  }
  const best = Math.floor(input.longestStreak);
  if (status.state === "none" && input.hasPractised && best >= 2) {
    return { kind: "welcome_back", text: `Welcome back. Your best streak is ${best} days; today starts a new one.` };
  }
  return null;
}

/** "Best streak 12 days · 23 debates", or null before there is anything to count. */
export function weekStatsLine(longestStreak: number, debatesFinished: number): string | null {
  const best = Math.floor(longestStreak);
  const finished = Math.floor(debatesFinished);
  const parts: string[] = [];
  if (best >= 2) parts.push(`Best streak ${best} days`);
  if (finished >= 1) parts.push(finished === 1 ? "1 debate" : `${finished} debates`);
  return parts.length ? parts.join(" · ") : null;
}

/** Below this many, a "people debated today's motion" count reads as empty, not as company. */
export const MOTION_DEBATERS_MIN = 10;

/**
 * "142 people have debated today's motion" (NYT Games / Wordle), or null
 * when the count is unreadable or too small to mean anything.
 */
export function motionDebatersLine(debaters: number | null): string | null {
  if (debaters === null || !Number.isFinite(debaters) || debaters < MOTION_DEBATERS_MIN) return null;
  return `${Math.floor(debaters).toLocaleString("en-GB")} people have debated today's motion`;
}
