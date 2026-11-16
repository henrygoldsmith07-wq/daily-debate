/** M16: consecutive-day loop completion (a repair or a completed retest). Counts only; observational, unvalidated. */
export const MIN_ACTIVE_DAYS_FOR_STREAK = 3;

export interface LoopStreak {
  current: number;
  longest: number;
  activeDays: number;
  /** Streak is alive but nothing counted yet today; it ends at the close of today. */
  atRisk: boolean;
  /** insufficient_evidence until enough distinct active days exist to call it a pattern. */
  status: "insufficient_evidence" | "ok";
}

function dayKey(iso: string, timeZone: string): string | null {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
}

function dayNumber(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

export function buildLoopStreak(timestamps: Array<string | null>, timeZone: string, now: Date = new Date()): LoopStreak {
  const days = new Set<number>();
  for (const ts of timestamps) {
    if (!ts) continue;
    const k = dayKey(ts, timeZone);
    if (k) days.add(dayNumber(k));
  }
  const sorted = [...days].sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of sorted) {
    run = prev !== null && d === prev + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  const todayKey = dayKey(now.toISOString(), timeZone);
  let current = 0;
  let atRisk = false;
  if (todayKey) {
    const today = dayNumber(todayKey);
    // A streak stays alive until the end of the day after the last active day.
    atRisk = !days.has(today) && days.has(today - 1);
    let cursor = days.has(today) ? today : today - 1;
    while (days.has(cursor)) {
      current++;
      cursor--;
    }
  }
  return {
    current,
    longest,
    activeDays: days.size,
    atRisk: atRisk && days.size >= MIN_ACTIVE_DAYS_FOR_STREAK,
    status: days.size >= MIN_ACTIVE_DAYS_FOR_STREAK ? "ok" : "insufficient_evidence",
  };
}

export function streakCopy(s: LoopStreak): string {
  if (s.status === "insufficient_evidence") {
    return `${s.activeDays} active day${s.activeDays === 1 ? "" : "s"} so far. A streak shows after ${MIN_ACTIVE_DAYS_FOR_STREAK}.`;
  }
  return `Current streak ${s.current} day${s.current === 1 ? "" : "s"} · longest ${s.longest} · ${s.activeDays} active days.`;
}
