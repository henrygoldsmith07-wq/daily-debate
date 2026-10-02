// The core daily-loop funnel.
//
// Two views of the same events: the session funnel counts each step per
// DEBATE, so a user who starts 10 sprints and finishes 1 contributes 10%
// here rather than 100%; and time-to-first-value/completion time describe how
// long the loop takes.
//
// Report assembly (which combines this with retention) lives in report.ts.

import {
  FUNNEL_MIN_SAMPLE,
  DEBATE_STARTS,
  isRepairAttempt,
  isSuccessfulRepairCompletion,
  median,
  rate,
  type FunnelEventRow,
  type FunnelRate,
} from "./events";

export interface SessionFunnel {
  /** Debate sessions seen in the window (distinct debate_ids on funnel events). */
  debates: number;
  /** Share of funnel events that carry a session id (coverage honesty). */
  coverage: number | null;
  sprintCompletion: FunnelRate;
  fullCompletion: FunnelRate;
  /** all started sessions → completed sessions (format-agnostic top line) */
  debateCompletion: FunnelRate;
  repairStart: FunnelRate;
  repairAttempt: FunnelRate;
  repairDemonstration: FunnelRate;
  /** Legacy alias for repairDemonstration. */
  repairCompletion: FunnelRate;
  retestStart: FunnelRate;
  retestCompletion: FunnelRate;
  retestSkillDemonstrated: FunnelRate;
  fullAnalysisOpen: FunnelRate;
  note: string | null;
}

export interface TimeToFirstValue {
  /** Median hours from first daily_viewed to first debate_completed. */
  medianHours: number | null;
  users: number;
  note: string | null;
}

export function timeToFirstValue(rows: FunnelEventRow[], minSample = FUNNEL_MIN_SAMPLE): TimeToFirstValue {
  const firstViewed = new Map<string, number>();
  const firstCompleted = new Map<string, number>();
  for (const r of rows) {
    const t = Date.parse(r.created_at);
    if (r.name === "daily_viewed") {
      const existing = firstViewed.get(r.user_id);
      if (existing === undefined || t < existing) firstViewed.set(r.user_id, t);
    }
    if (r.name === "debate_completed") {
      const existing = firstCompleted.get(r.user_id);
      if (existing === undefined || t < existing) firstCompleted.set(r.user_id, t);
    }
  }
  const hours: number[] = [];
  for (const [userId, viewed] of firstViewed) {
    const completed = firstCompleted.get(userId);
    if (completed !== undefined && completed >= viewed) {
      hours.push((completed - viewed) / 3_600_000);
    }
  }
  hours.sort((a, b) => a - b);
  const measurable = hours.length >= minSample;
  return {
    medianHours: measurable ? +median(hours).toFixed(1) : null,
    users: hours.length,
    note: measurable
      ? null
      : `not yet measurable — ${hours.length} user${hours.length === 1 ? "" : "s"} finished a first debate (need ${minSample})`,
  };
}

export interface CompletionTime {
  /** Median minutes from debate start to completion, per session. */
  medianMinutes: number | null;
  sessions: number;
  note: string | null;
}

export function completionTime(rows: FunnelEventRow[], minSample = FUNNEL_MIN_SAMPLE): CompletionTime {
  const starts = new Map<string, number>();
  const completions = new Map<string, number>();
  for (const r of rows) {
    if (!r.debate_id) continue;
    const t = Date.parse(r.created_at);
    if (DEBATE_STARTS.has(r.name)) {
      const existing = starts.get(r.debate_id);
      if (existing === undefined || t < existing) starts.set(r.debate_id, t);
    }
    if (r.name === "debate_completed") {
      const existing = completions.get(r.debate_id);
      if (existing === undefined || t < existing) completions.set(r.debate_id, t);
    }
  }
  const minutes: number[] = [];
  for (const [debateId, start] of starts) {
    const completed = completions.get(debateId);
    if (completed !== undefined && completed >= start) minutes.push((completed - start) / 60_000);
  }
  minutes.sort((a, b) => a - b);
  const measurable = minutes.length >= minSample;
  return {
    medianMinutes: measurable ? +median(minutes).toFixed(1) : null,
    sessions: minutes.length,
    note: measurable
      ? null
      : `not yet measurable — ${minutes.length} completed session${minutes.length === 1 ? "" : "s"} with session ids (need ${minSample})`,
  };
}

export function buildSessionFunnel(
  rows: FunnelEventRow[],
  opts: { minSample?: number } = {},
): SessionFunnel {
  const minSample = opts.minSample ?? FUNNEL_MIN_SAMPLE;
  const sessionRows = rows.filter((r) => typeof r.debate_id === "string" && r.debate_id.length > 0);
  const bySession = (name: string): Set<string> => {
    const m = new Set<string>();
    for (const r of sessionRows) {
      if (r.name === name) m.add(r.debate_id!);
    }
    return m;
  };

  const startedSessions = new Map<string, string>(); // debate_id -> format
  for (const r of sessionRows) {
    if (r.name === "sprint_started" || r.name === "full_debate_started") {
      startedSessions.set(r.debate_id!, r.format === "sprint" ? "sprint" : "full");
    }
  }
  const completedSessions = new Set(bySession("debate_completed").keys());
  const repairStartedSessions = new Set(bySession("repair_started").keys());
  const repairAttemptedSessions = new Set(
    sessionRows.filter(isRepairAttempt).map((r) => r.debate_id!),
  );
  const repairCompletedSessions = new Set(
    sessionRows.filter(isSuccessfulRepairCompletion).map((r) => r.debate_id!),
  );
  const retestStartedSessions = new Set(bySession("retest_started").keys());
  const retestCompletedSessions = new Set(bySession("retest_completed").keys());
  const retestDemonstratedSessions = new Set(bySession("retest_skill_demonstrated").keys());
  const analysisOpenSessions = new Set(bySession("full_analysis_opened").keys());

  const sprintIds = [...startedSessions.entries()].filter(([, f]) => f === "sprint").map(([id]) => id);
  const fullIds = [...startedSessions.entries()].filter(([, f]) => f === "full").map(([id]) => id);

  const debates = startedSessions.size;
  const funnelEventCount = sessionRows.filter((r) =>
    DEBATE_STARTS.has(r.name) ||
    r.name === "debate_completed" ||
    r.name === "repair_started" ||
    r.name === "repair_attempted" ||
    r.name === "repair_demonstrated" ||
    r.name === "repair_completed" ||
    r.name === "retest_started" ||
    r.name === "retest_completed" ||
    r.name === "retest_skill_demonstrated" ||
    r.name === "full_analysis_opened",
  ).length;
  const totalFunnelish = rows.filter((r) =>
    DEBATE_STARTS.has(r.name) ||
    r.name === "debate_completed" ||
    r.name === "repair_started" ||
    r.name === "repair_attempted" ||
    r.name === "repair_demonstrated" ||
    r.name === "repair_completed" ||
    r.name === "retest_started" ||
    r.name === "retest_completed" ||
    r.name === "retest_skill_demonstrated" ||
    r.name === "full_analysis_opened",
  ).length;
  const coverage = totalFunnelish ? +(funnelEventCount / totalFunnelish).toFixed(3) : null;

  const s = rate(sprintIds.filter((id) => completedSessions.has(id)).length, sprintIds.length, minSample);
  const f = rate(fullIds.filter((id) => completedSessions.has(id)).length, fullIds.length, minSample);
  const allStartedIds = [...startedSessions.keys()];
  const d = rate(allStartedIds.filter((id) => completedSessions.has(id)).length, allStartedIds.length, minSample);
  const rs = rate([...completedSessions].filter((id) => repairStartedSessions.has(id)).length, completedSessions.size, minSample);
  const ra = rate([...repairStartedSessions].filter((id) => repairAttemptedSessions.has(id)).length, repairStartedSessions.size, minSample);
  const rd = rate([...repairAttemptedSessions].filter((id) => repairCompletedSessions.has(id)).length, repairAttemptedSessions.size, minSample);
  // A retest is deliberately a NEW debate, so its debate_id differs from the
  // repaired debate's id. Session conversion compares stage counts here rather
  // than intersecting incompatible session identifiers.
  const rts = rate(retestStartedSessions.size, repairCompletedSessions.size, minSample);
  const rtc = rate([...retestStartedSessions].filter((id) => retestCompletedSessions.has(id)).length, retestStartedSessions.size, minSample);
  const rtd = rate([...retestCompletedSessions].filter((id) => retestDemonstratedSessions.has(id)).length, retestCompletedSessions.size, minSample);
  const ao = rate([...completedSessions].filter((id) => analysisOpenSessions.has(id)).length, completedSessions.size, minSample);

  const note =
    coverage === null
      ? "no funnel events yet"
      : coverage < 1
        ? `${Math.round((1 - coverage) * 100)}% of funnel events predate session ids (migration 005) and are counted in user conversion only`
        : null;

  return {
    debates,
    coverage,
    sprintCompletion: s,
    fullCompletion: f,
    debateCompletion: d,
    repairStart: rs,
    repairAttempt: ra,
    repairDemonstration: rd,
    repairCompletion: rd,
    retestStart: rts,
    retestCompletion: rtc,
    retestSkillDemonstrated: rtd,
    fullAnalysisOpen: ao,
    note,
  };
}
