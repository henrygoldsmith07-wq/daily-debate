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
}

export interface FunnelRate {
  numerator: number;
  denominator: number;
  /** null when the denominator is below the minimum sample threshold. */
  rate: number | null;
  sample: number;
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
}

export const FUNNEL_MIN_SAMPLE = 5;
export const FUNNEL_DEFAULT_WINDOW_DAYS = 90;

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
  };
}
