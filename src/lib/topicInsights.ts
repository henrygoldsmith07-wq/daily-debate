// Topic performance insight — best/worst debate categories over history.
//
// Observational aggregation over completed debates joined to their topic
// category. Deliberately conservative: a category needs at least
// `minDebates` debates before it can be named, a best/worst pair needs two
// DIFFERENT qualifying categories, and the result carries its sample sizes so
// the UI can stay honest about how thin the evidence is. Pure.

export interface TopicDebateResult {
  /** Topic category (e.g. "Science"); null categories are excluded. */
  category: string | null;
  /** The debate's final score; null (unfinished/legacy) rows are excluded. */
  totalScore: number | null;
}

export interface TopicInsight {
  category: string;
  debates: number;
  averageScore: number;
}

export interface TopicInsights {
  best: TopicInsight | null;
  worst: TopicInsight | null;
  /** Qualifying categories with their averages (for future display). */
  ranked: TopicInsight[];
  note: string | null;
}

export function bestWorstTopics(
  rows: TopicDebateResult[],
  opts: { minDebates?: number } = {},
): TopicInsights {
  const minDebates = opts.minDebates ?? 2;

  const byCategory = new Map<string, number[]>();
  for (const row of rows) {
    if (!row.category || row.totalScore === null || row.totalScore === undefined) continue;
    const list = byCategory.get(row.category) ?? [];
    list.push(row.totalScore);
    byCategory.set(row.category, list);
  }

  const ranked: TopicInsight[] = [...byCategory.entries()]
    .filter(([, scores]) => scores.length >= minDebates)
    .map(([category, scores]) => ({
      category,
      debates: scores.length,
      averageScore: +(scores.reduce((s, v) => s + v, 0) / scores.length).toFixed(1),
    }))
    .sort((a, b) => b.averageScore - a.averageScore);

  if (ranked.length < 2) {
    const skipped = byCategory.size - ranked.length;
    return {
      best: ranked[0] ?? null,
      worst: null,
      ranked,
      note: skipped > 0 || ranked.length === 1
        ? "Categories need at least 2 scored debates each — and a comparison needs two categories — before a weak-topic signal means anything."
        : null,
    };
  }

  return {
    best: ranked[0],
    worst: ranked[ranked.length - 1],
    ranked,
    note: null,
  };
}
