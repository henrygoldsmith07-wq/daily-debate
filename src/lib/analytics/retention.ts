// Retention and cohort analysis.
//
// Two questions live here: does a user come back (D1/D7/D30 after first
// activity, and after their first successful repair), and does weekly cohort
// retention hold up as cohorts age.
//
// Every figure here is OBSERVATIONAL. Users who complete repairs differ from
// users who do not in many ways that are never measured, so a difference
// between the two groups is an association and is labelled as one.

import {
  FUNNEL_MIN_SAMPLE,
  addDays,
  dayOf,
  isSuccessfulRepairCompletion,
  type FunnelEventRow,
} from "./events";

export interface ReturnRate {
  eligibleUsers: number;
  returnedUsers: number;
  pendingUsers: number;
  rate: number | null;
  note: string | null;
}

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

export function repairRetentionComparison(rows: FunnelEventRow[], now: string, minSample = FUNNEL_MIN_SAMPLE): RepairRetainComparison {
  const today = dayOf(now);
  const completedUsers = new Set(rows.filter((r) => r.name === "debate_completed").map((r) => r.user_id));
  const repairers = new Set(rows.filter(isSuccessfulRepairCompletion).map((r) => r.user_id));
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

export function returnRateAfterAnchor(
  rows: FunnelEventRow[],
  anchors: Map<string, string>,
  nDays: number,
  now: string,
  minSample: number = FUNNEL_MIN_SAMPLE,
): ReturnRate {
  const today = dayOf(now);
  const eventDays = new Map<string, Set<string>>();
  for (const row of rows) {
    const days = eventDays.get(row.user_id) ?? new Set<string>();
    days.add(dayOf(row.created_at));
    eventDays.set(row.user_id, days);
  }
  let eligible = 0;
  let returned = 0;
  let pending = 0;
  for (const [userId, anchor] of anchors) {
    const anchorDay = dayOf(anchor);
    const daysSinceAnchor = Math.floor(
      (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${anchorDay}T00:00:00Z`)) / 86_400_000,
    );
    if (daysSinceAnchor < nDays) {
      pending += 1;
      continue;
    }
    eligible += 1;
    if ((eventDays.get(userId) ?? new Set()).has(addDays(anchorDay, nDays))) returned += 1;
  }
  const measurable = eligible >= minSample;
  return {
    eligibleUsers: eligible,
    returnedUsers: returned,
    pendingUsers: pending,
    rate: measurable ? +(returned / eligible).toFixed(3) : null,
    note: measurable
      ? null
      : `not yet measurable — ${eligible} anchored user${eligible === 1 ? "" : "s"} (need ${minSample})`,
  };
}

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
