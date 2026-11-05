/**
 * The week row on Today: Monday to Sunday of the current week, each day marked
 * practised or not. Built only from days the learner actually practised, so an
 * empty week reads as seven open dots, never as a broken streak.
 */
export interface WeekDay {
  key: string;
  /** One-letter weekday label, Monday first. */
  label: string;
  practised: boolean;
  /** A missed day a streak freeze covered, or will cover if today is practised (048). */
  frozen: boolean;
  isToday: boolean;
  isFuture: boolean;
}

const DAY_MS = 86_400_000;
const LABELS = ["M", "T", "W", "T", "F", "S", "S"] as const;

function keyToTime(key: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const time = Date.parse(`${key}T00:00:00Z`);
  return Number.isNaN(time) ? null : time;
}

function timeToKey(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

export function weekDays(todayKey: string, practised: Iterable<string>, frozen: Iterable<string> = []): WeekDay[] {
  const today = keyToTime(todayKey);
  if (today === null) return [];
  const done = new Set(practised);
  const kept = new Set(frozen);
  // getUTCDay: Sunday is 0. Shift so Monday starts the week.
  const offset = (new Date(today).getUTCDay() + 6) % 7;
  const monday = today - offset * DAY_MS;
  return LABELS.map((label, index) => {
    const time = monday + index * DAY_MS;
    const key = timeToKey(time);
    return { key, label, practised: done.has(key), frozen: !done.has(key) && kept.has(key), isToday: time === today, isFuture: time > today };
  });
}

/** Guest practice days live in localStorage; this keeps the list valid and bounded. */
export const GUEST_PRACTICE_DAYS_KEY = "daily-debate-guest-days";
const MAX_GUEST_DAYS = 60;

export function parseGuestPracticeDays(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string" && keyToTime(value) !== null).slice(-MAX_GUEST_DAYS);
  } catch {
    return [];
  }
}

export function addGuestPracticeDay(raw: string | null, dayKey: string): string {
  const days = parseGuestPracticeDays(raw);
  if (keyToTime(dayKey) !== null && !days.includes(dayKey)) days.push(dayKey);
  return JSON.stringify(days.sort().slice(-MAX_GUEST_DAYS));
}
