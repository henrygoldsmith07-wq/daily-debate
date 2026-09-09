// Product funnel report — computed from product_events (migration 004).
//
// User-level funnel math over the allowlisted, no-free-text events. Every rate
// is honest about its sample: below MIN_SAMPLE users a rate is null with an
// explicit "not yet measurable" note rather than a misleading small-n number.
// Pure — the API route loads rows, this module does the math.

export interface FunnelEventRow {
  user_id: string;
  name: string;
  format: string | null;
  reason: string | null;
  created_at: string;
  /** Bounded flow identifier (debate UUID); null on legacy/pre-migration rows. */
  debate_id: string | null;
}

export interface FunnelRate {
  numerator: number;
  denominator: number;
  /** null when the denominator is below the minimum sample threshold. */
  rate: number | null;
  sample: number;
  note: string | null;
}

/**
 * Session-level conversion: the same funnel steps counted per DEBATE rather
 * than per user. A user who starts 10 sprints and completes 1 contributes 10%
 * here, not 100%. Only events carrying a debate_id participate — legacy rows
 * without one are excluded and the coverage is reported, not hidden.
 */
export interface SessionFunnel {
  /** Debate sessions seen in the window (distinct debate_ids on funnel events). */
  debates: number;
  /** Share of funnel events that carry a session id (coverage honesty). */
  coverage: number | null;
  sprintCompletion: FunnelRate;
  fullCompletion: FunnelRate;
  repairStart: FunnelRate;
  repairCompletion: FunnelRate;
  fullAnalysisOpen: FunnelRate;
  note: string | null;
}

export interface ReturnRate {
  eligibleUsers: number;
  returnedUsers: number;
  pendingUsers: number;
  rate: number | null;
  note: string | null;
}

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
  /** debate_completed → repair_started (client CTA click) */
  repairStart: FunnelRate;
  /** repair_started → repair_completed (server-confirmed submission) */
  repairCompletion: FunnelRate;
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

export const FUNNEL_MIN_SAMPLE = 5;
export const FUNNEL_DEFAULT_WINDOW_DAYS = 90;

/**
 * Bounded fetch helper: request one row past the limit; `truncated` is true
 * exactly when more data exists than was loaded. Reports must surface this —
 * a precise-looking rate from silently incomplete data is dishonest.
 */
export function takeBounded<T>(rows: T[], limit: number): { rows: T[]; truncated: boolean } {
  if (rows.length <= limit) return { rows, truncated: false };
  return { rows: rows.slice(0, limit), truncated: true };
}

export interface SourceLoad {
  loaded: number;
  limit: number;
  truncated: boolean;
}

export interface DataCompleteness {
  events: SourceLoad;
  repairs: SourceLoad;
  debates: SourceLoad;
  note: string | null;
}

/** Human note naming which metrics a truncated source can distort. */
export function completenessNote(meta: DataCompleteness): string | null {
  const bits: string[] = [];
  if (meta.events.truncated) {
    bits.push(
      `event rows capped at ${meta.events.limit} — every funnel rate below may undercount; treat directions as provisional`,
    );
  }
  if (meta.repairs.truncated) {
    bits.push(
      `repair rows capped at ${meta.repairs.limit} — repair effectiveness covers only the newest repairs`,
    );
  }
  if (meta.debates.truncated) {
    bits.push(
      `debate graphs capped at ${meta.debates.limit} — weakness recurrence is measured on a subset`,
    );
  }
  return bits.length ? bits.join(" ") : null;
}

function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function rate(numerator: number, denominator: number, minSample: number): FunnelRate {
  const measurable = denominator >= minSample;
  return {
    numerator,
    denominator,
    rate: measurable ? +(numerator / denominator).toFixed(3) : null,
    sample: denominator,
    note: measurable
      ? null
      : `not yet measurable — ${denominator} user${denominator === 1 ? "" : "s"} (need ${minSample})`,
  };
}

function distinctUsers(rows: FunnelEventRow[]): Set<string> {
  return new Set(rows.map((r) => r.user_id));
}

/**
 * Return rate for day N after a user's first activity: of the users whose
 * first event was at least N days before `now` (eligible), how many had any
 * event exactly N calendar days later? Users without the full window are
 * counted as pending, never as churned.
 */
export function returnRate(
  rows: FunnelEventRow[],
  nDays: number,
  now: string,
  minSample: number = FUNNEL_MIN_SAMPLE,
): ReturnRate {
  const firstDay = new Map<string, string>();
  for (const row of rows) {
    const day = dayOf(row.created_at);
    const existing = firstDay.get(row.user_id);
    if (!existing || day < existing) firstDay.set(row.user_id, day);
  }
  const eventDays = new Map<string, Set<string>>();
  for (const row of rows) {
    const days = eventDays.get(row.user_id) ?? new Set<string>();
    days.add(dayOf(row.created_at));
    eventDays.set(row.user_id, days);
  }
  const today = dayOf(now);
  let eligible = 0;
  let returned = 0;
  let pending = 0;
  for (const [userId, first] of firstDay) {
    const target = addDays(first, nDays);
    const daysSinceFirst = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000);
    if (daysSinceFirst < nDays) {
      pending += 1;
      continue;
    }
    eligible += 1;
    if ((eventDays.get(userId) ?? new Set()).has(target)) returned += 1;
  }
  const measurable = eligible >= minSample;
  return {
    eligibleUsers: eligible,
    returnedUsers: returned,
    pendingUsers: pending,
    rate: measurable ? +(returned / eligible).toFixed(3) : null,
    note: measurable
      ? null
      : `not yet measurable — ${eligible} eligible user${eligible === 1 ? "" : "s"} (need ${minSample}); ${pending} still inside the ${nDays}-day window`,
  };
}

const DEBATE_STARTS = new Set(["sprint_started", "full_debate_started", "debate_started"]);

// ── Deeper product validation metrics ───────────────────────────────────────

export interface TimeToFirstValue {
  /** Median hours from first daily_viewed to first debate_completed. */
  medianHours: number | null;
  users: number;
  note: string | null;
}

/** Time-to-first-value: how long until a new user finishes their first debate? */
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

/** Proper median: mean of the two middle values for even-length samples. */
function median(sortedAsc: number[]): number {
  const mid = Math.floor(sortedAsc.length / 2);
  return sortedAsc.length % 2 === 1
    ? sortedAsc[mid]
    : (sortedAsc[mid - 1] + sortedAsc[mid]) / 2;
}

/** Per-session completion time (needs session-tagged events, migration 005). */
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

export interface GroupReturn {
  users: number;
  returned: number;
  rate: number | null;
}

export interface RepairRetainComparison {
  repairers: GroupReturn;
  nonRepairers: GroupReturn;
  note: string;
}

/**
 * Do users who complete a repair come back more? Strictly OBSERVATIONAL:
 * repairers differ from non-repairers in many ways, so this is a retention
 * association, never evidence that repair causes retention.
 */
export function repairRetentionComparison(rows: FunnelEventRow[], now: string, minSample = FUNNEL_MIN_SAMPLE): RepairRetainComparison {
  const today = dayOf(now);
  const completedUsers = new Set(rows.filter((r) => r.name === "debate_completed").map((r) => r.user_id));
  const repairers = new Set(rows.filter((r) => r.name === "repair_completed").map((r) => r.user_id));
  const eventDays = new Map<string, Set<string>>();
  const firstCompleted = new Map<string, string>();
  for (const r of rows) {
    const day = dayOf(r.created_at);
    const days = eventDays.get(r.user_id) ?? new Set<string>();
    days.add(day);
    eventDays.set(r.user_id, days);
    if (r.name === "debate_completed") {
      const existing = firstCompleted.get(r.user_id);
      if (!existing || day < existing) firstCompleted.set(r.user_id, day);
    }
  }
  const groupRate = (users: Set<string>): GroupReturn => {
    let eligible = 0;
    let returned = 0;
    for (const userId of users) {
      const first = firstCompleted.get(userId);
      if (!first) continue;
      if (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`) < 86_400_000) continue; // no full D1 window
      eligible += 1;
      if ((eventDays.get(userId) ?? new Set()).has(addDays(first, 1))) returned += 1;
    }
    return { users: eligible, returned, rate: eligible >= minSample ? +(returned / eligible).toFixed(3) : null };
  };
  const nonRepairers = new Set([...completedUsers].filter((u) => !repairers.has(u)));
  return {
    repairers: groupRate(repairers),
    nonRepairers: groupRate(nonRepairers),
    note: "Observational only — repairers may simply be more engaged users. This is not evidence that repair causes retention.",
  };
}

export interface WeeklyCohort {
  weekStart: string;
  users: number;
  eligibleD1: number;
  returnedD1: number;
  eligibleD7: number;
  returnedD7: number;
  eligibleD30: number;
  returnedD30: number;
}

/** Weekly first-activity cohorts with D1/D7/D30 retention (counts, honest pending). */
export function buildWeeklyCohorts(rows: FunnelEventRow[], now: string, weeks = 8): WeeklyCohort[] {
  const today = dayOf(now);
  const firstDay = new Map<string, string>();
  const eventDays = new Map<string, Set<string>>();
  for (const r of rows) {
    const day = dayOf(r.created_at);
    const existing = firstDay.get(r.user_id);
    if (!existing || day < existing) firstDay.set(r.user_id, day);
    const days = eventDays.get(r.user_id) ?? new Set<string>();
    days.add(day);
    eventDays.set(r.user_id, days);
  }
  const weekStartOf = (day: string): string => {
    const d = new Date(`${day}T00:00:00Z`);
    const dow = d.getUTCDay(); // 0 = Sunday; weeks start Monday
    const shift = (dow + 6) % 7;
    d.setUTCDate(d.getUTCDate() - shift);
    return d.toISOString().slice(0, 10);
  };
  const byWeek = new Map<string, Set<string>>();
  for (const [userId, first] of firstDay) {
    const week = weekStartOf(first);
    const set = byWeek.get(week) ?? new Set<string>();
    set.add(userId);
    byWeek.set(week, set);
  }
  const start = weekStartOf(today);
  const out: WeeklyCohort[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const weekStart = addDays(start, -7 * i);
    const users = byWeek.get(weekStart) ?? new Set<string>();
    const bucket = { eligibleD1: 0, returnedD1: 0, eligibleD7: 0, returnedD7: 0, eligibleD30: 0, returnedD30: 0 };
    for (const userId of users) {
      const first = firstDay.get(userId)!;
      const days = eventDays.get(userId) ?? new Set<string>();
      const since = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000);
      if (since >= 1) {
        bucket.eligibleD1 += 1;
        if (days.has(addDays(first, 1))) bucket.returnedD1 += 1;
      }
      if (since >= 7) {
        bucket.eligibleD7 += 1;
        if (days.has(addDays(first, 7))) bucket.returnedD7 += 1;
      }
      if (since >= 30) {
        bucket.eligibleD30 += 1;
        if (days.has(addDays(first, 30))) bucket.returnedD30 += 1;
      }
    }
    out.push({ weekStart, users: users.size, ...bucket });
  }
  return out;
}

/**
 * Session-level (per-debate) funnel from events that carry a debate_id.
 * A debate session counts as "completed" when its id appears on a
 * debate_completed event, etc. Legacy rows without an id are excluded from
 * the rates and reported as coverage, never silently mixed in.
 */
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
  const repairCompletedSessions = new Set(bySession("repair_completed").keys());
  const analysisOpenSessions = new Set(bySession("full_analysis_opened").keys());

  const sprintIds = [...startedSessions.entries()].filter(([, f]) => f === "sprint").map(([id]) => id);
  const fullIds = [...startedSessions.entries()].filter(([, f]) => f === "full").map(([id]) => id);

  const debates = startedSessions.size;
  const funnelEventCount = sessionRows.filter((r) =>
    DEBATE_STARTS.has(r.name) ||
    r.name === "debate_completed" ||
    r.name === "repair_started" ||
    r.name === "repair_completed" ||
    r.name === "full_analysis_opened",
  ).length;
  const totalFunnelish = rows.filter((r) =>
    DEBATE_STARTS.has(r.name) ||
    r.name === "debate_completed" ||
    r.name === "repair_started" ||
    r.name === "repair_completed" ||
    r.name === "full_analysis_opened",
  ).length;
  const coverage = totalFunnelish ? +(funnelEventCount / totalFunnelish).toFixed(3) : null;

  const s = rate(sprintIds.filter((id) => completedSessions.has(id)).length, sprintIds.length, minSample);
  const f = rate(fullIds.filter((id) => completedSessions.has(id)).length, fullIds.length, minSample);
  const rs = rate([...completedSessions].filter((id) => repairStartedSessions.has(id)).length, completedSessions.size, minSample);
  const rc = rate([...repairStartedSessions].filter((id) => repairCompletedSessions.has(id)).length, repairStartedSessions.size, minSample);
  const ao = rate([...completedSessions].filter((id) => analysisOpenSessions.has(id)).length, completedSessions.size, minSample);

  const note =
    coverage === null
      ? "no funnel events yet"
      : coverage < 1
        ? `${Math.round((1 - coverage) * 100)}% of funnel events predate session ids (migration 005) and are counted in user conversion only`
        : null;

  return { debates, coverage, sprintCompletion: s, fullCompletion: f, repairStart: rs, repairCompletion: rc, fullAnalysisOpen: ao, note };
}

/** Build the full funnel report from raw event rows. */
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
  const repairCompleted = byName(["repair_completed"]);
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
    repairStart: rate(distinctUsers(repairStarted).size, distinctUsers(completed).size, minSample),
    repairCompletion: rate(distinctUsers(repairCompleted).size, distinctUsers(repairStarted).size, minSample),
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
        Math.max(distinctUsers(challengeCreated).size, 1),
        minSample,
      ),
    },
    d1Return: returnRate(inWindow, 1, now, minSample),
    d7Return: returnRate(inWindow, 7, now, minSample),
    sessions,
    timeToFirstValue: timeToFirstValue(inWindow, minSample),
    completionTime: completionTime(inWindow, minSample),
    repairRetention: repairRetentionComparison(inWindow, now, minSample),
    weeklyCohorts: buildWeeklyCohorts(inWindow, now),
  };
}
