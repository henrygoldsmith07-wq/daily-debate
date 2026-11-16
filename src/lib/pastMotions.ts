/**
 * Past motions: the last 30 daily motions, any of which can be debated again
 * (copied from Kialo Edu's topic library and Practice Debate's resolution
 * library). Pure shaping here; pastMotionsServer.ts reads the rows.
 */

export const PAST_MOTION_DAYS = 30;

export interface PastMotionRow {
  id: string;
  topic_date: string;
  title: string;
  category: string | null;
  debated: boolean;
  active_id: string | null;
}

export interface PastMotion {
  id: string;
  day: string;
  title: string;
  category: string | null;
  /** The learner has finished a debate on it. */
  debated: boolean;
  /** An unfinished debate on it, to continue instead of starting another. */
  activeDebateId: string | null;
}

/**
 * Newest first, only days strictly before `todayKey` and within the window,
 * one entry per day (the daily motion is unique per date). Rows with a
 * malformed date are dropped rather than guessed at.
 */
export function shapePastMotions(rows: readonly PastMotionRow[], todayKey: string, days = PAST_MOTION_DAYS): PastMotion[] {
  const today = Date.parse(`${todayKey}T00:00:00Z`);
  if (Number.isNaN(today)) return [];
  const earliest = today - days * 86_400_000;
  const seen = new Set<string>();
  return rows
    .map((row) => ({ row, day: String(row.topic_date).slice(0, 10) }))
    .filter(({ day }) => {
      const t = Date.parse(`${day}T00:00:00Z`);
      return /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(t) && t < today && t >= earliest;
    })
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
    .filter(({ day }) => (seen.has(day) ? false : (seen.add(day), true)))
    .map(({ row, day }) => ({
      id: row.id,
      day,
      title: row.title,
      category: row.category,
      debated: row.debated === true,
      activeDebateId: row.active_id ?? null,
    }));
}
