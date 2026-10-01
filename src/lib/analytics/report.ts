// Product funnel report assembly.
//
// This module wires the pieces together: it windows the event rows, asks the
// core funnel for the session-level view, and asks retention for D1/D7/D30 and
// repair association. It adds no arithmetic of its own, so the report cannot
// disagree with its parts.

import {
  FUNNEL_DEFAULT_WINDOW_DAYS,
  FUNNEL_MIN_SAMPLE,
  DEBATE_STARTS,
  distinctUsers,
  isRepairAttempt,
  isSuccessfulRepairCompletion,
  rate,
  type FunnelEventRow,
  type FunnelRate,
} from "./events";
import {
  buildSessionFunnel,
  completionTime,
  timeToFirstValue,
  type SessionFunnel,
  type TimeToFirstValue,
  type CompletionTime,
} from "./coreFunnel";
import {
  buildWeeklyCohorts,
  repairRetentionComparison,
  returnRate,
  type RepairRetainComparison,
  type ReturnRate,
  type WeeklyCohort,
} from "./retention";

export interface FunnelReport {
  generatedAt: string;
  windowDays: number;
  eventsAnalysed: number;
  usersAnalysed: number;
  dailyViewed: number;
  /** daily_viewed → sprint/full debate started */
  startRate: FunnelRate;
  /** sprint_started → sprint debate_completed */
  sprintCompletion: FunnelRate;
  /** full_debate_started → full debate_completed */
  fullCompletion: FunnelRate;
  /** any debate_started → debate_completed (format-agnostic top line) */
  debateCompletion: FunnelRate;
  /** debate_completed → repair_started (client CTA click) */
  repairStart: FunnelRate;
  /** repair_started → persisted repair attempt */
  repairAttempt: FunnelRate;
  /** repair attempt → prompted repair demonstration */
  repairDemonstration: FunnelRate;
  /** Legacy alias for repairDemonstration. */
  repairCompletion: FunnelRate;
  /** prompted repair demonstration → deliberate retest debate started */
  retestStart: FunnelRate;
  /** deliberate retest started → later debate produced an observable target reading */
  retestCompletion: FunnelRate;
  /** observable retest → existing deterministic rule demonstrated the target skill */
  retestSkillDemonstrated: FunnelRate;
  /** debate_completed → full_analysis_opened */
  fullAnalysisOpen: FunnelRate;
  /** debate starts where the user chose "Challenge me" */
  challengeMe: FunnelRate;
  challengeMeReasons: Array<{ reason: string; count: number }>;
  /** friend challenges created vs accepted */
  friendChallenges: {
    createdEvents: number;
    createdUsers: number;
    acceptedEvents: number;
    acceptedUsers: number;
    acceptRate: FunnelRate;
  };
  d1Return: ReturnRate;
  d7Return: ReturnRate;
  d30Return: ReturnRate;
  /** Session-level (per-debate) completion for the same funnel steps. */
  sessions: SessionFunnel;
  /** Median hours from first view to first completed debate. */
  timeToFirstValue: TimeToFirstValue;
  /** Median minutes per debate session, start → completion. */
  completionTime: CompletionTime;
  /** Observational D1-return comparison: repairers vs non-repairers. */
  repairRetention: RepairRetainComparison;
  /** Weekly first-activity cohorts with D1/D7/D30 retention. */
  weeklyCohorts: WeeklyCohort[];
}

export function buildFunnelReport(
  rows: FunnelEventRow[],
  opts: { now?: string; windowDays?: number; minSample?: number } = {},
): FunnelReport {
  const windowDays = opts.windowDays ?? FUNNEL_DEFAULT_WINDOW_DAYS;
  const minSample = opts.minSample ?? FUNNEL_MIN_SAMPLE;
  const now = opts.now ?? new Date().toISOString();
  const cutoff = Date.parse(now) - windowDays * 86_400_000;
  const inWindow = rows.filter((r) => Date.parse(r.created_at) >= cutoff);
  const sessions = buildSessionFunnel(inWindow, { minSample });

  const byName = (names: string[]) => inWindow.filter((r) => names.includes(r.name));
  const viewed = byName(["daily_viewed"]);
  const started = byName([...DEBATE_STARTS]);
  const sprints = byName(["sprint_started"]);
  const fulls = byName(["full_debate_started"]);
  const completed = byName(["debate_completed"]);
  const sprintCompleted = completed.filter((r) => r.format === "sprint");
  const fullCompleted = completed.filter((r) => r.format === "full");
  const repairStarted = byName(["repair_started"]);
  const repairAttempted = inWindow.filter(isRepairAttempt);
  const repairCompleted = inWindow.filter(isSuccessfulRepairCompletion);
  const retestStarted = byName(["retest_started"]);
  const retestCompleted = byName(["retest_completed"]);
  const retestDemonstrated = byName(["retest_skill_demonstrated"]);
  const analysisOpened = byName(["full_analysis_opened"]);
  const challengeMe = byName(["challenge_me_selected"]);
  const challengeCreated = byName(["challenge_link_created"]);
  const challengeAccepted = byName(["challenge_link_accepted"]);

  const reasonCounts = new Map<string, number>();
  for (const row of challengeMe) {
    const reason = row.reason ?? "unknown";
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }

  return {
    generatedAt: now,
    windowDays,
    eventsAnalysed: inWindow.length,
    usersAnalysed: distinctUsers(inWindow).size,
    dailyViewed: distinctUsers(viewed).size,
    startRate: rate(distinctUsers(started).size, distinctUsers(viewed).size, minSample),
    sprintCompletion: rate(distinctUsers(sprintCompleted).size, distinctUsers(sprints).size, minSample),
    fullCompletion: rate(distinctUsers(fullCompleted).size, distinctUsers(fulls).size, minSample),
    debateCompletion: rate(distinctUsers(completed).size, distinctUsers(started).size, minSample),
    repairStart: rate(distinctUsers(repairStarted).size, distinctUsers(completed).size, minSample),
    repairAttempt: rate(distinctUsers(repairAttempted).size, distinctUsers(repairStarted).size, minSample),
    repairDemonstration: rate(distinctUsers(repairCompleted).size, distinctUsers(repairAttempted).size, minSample),
    repairCompletion: rate(distinctUsers(repairCompleted).size, distinctUsers(repairAttempted).size, minSample),
    retestStart: rate(distinctUsers(retestStarted).size, distinctUsers(repairCompleted).size, minSample),
    retestCompletion: rate(distinctUsers(retestCompleted).size, distinctUsers(retestStarted).size, minSample),
    retestSkillDemonstrated: rate(distinctUsers(retestDemonstrated).size, distinctUsers(retestCompleted).size, minSample),
    fullAnalysisOpen: rate(distinctUsers(analysisOpened).size, distinctUsers(completed).size, minSample),
    challengeMe: rate(distinctUsers(challengeMe).size, distinctUsers(started).size, minSample),
    challengeMeReasons: [...reasonCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => ({ reason, count })),
    friendChallenges: {
      createdEvents: challengeCreated.length,
      createdUsers: distinctUsers(challengeCreated).size,
      acceptedEvents: challengeAccepted.length,
      acceptedUsers: distinctUsers(challengeAccepted).size,
      acceptRate: rate(
        distinctUsers(challengeAccepted).size,
        distinctUsers(challengeCreated).size,
        minSample,
      ),
    },
    d1Return: returnRate(inWindow, 1, now, minSample),
    d7Return: returnRate(inWindow, 7, now, minSample),
    d30Return: returnRate(inWindow, 30, now, minSample),
    sessions,
    timeToFirstValue: timeToFirstValue(inWindow, minSample),
    completionTime: completionTime(inWindow, minSample),
    repairRetention: repairRetentionComparison(inWindow, now, minSample),
    weeklyCohorts: buildWeeklyCohorts(inWindow, now),
  };
}
