// M14: which phrases from a learner's repair text reappeared in their retest
// turns. Descriptive only: lexical overlap is NOT evidence the repair caused
// anything, so results are always labelled unvalidated and gated by sample size.

export const MIN_PHRASE_WORDS = 3;
export const MIN_REUSE_SAMPLE = 5;

const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "is", "it", "that", "this", "for", "on", "with", "as", "are", "was", "be", "by"]);

function words(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9'\s]/g, " ").split(/\s+/).filter(Boolean);
}

function ngrams(tokens: string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= tokens.length; i++) {
    const g = tokens.slice(i, i + n);
    if (g.every((t) => STOP.has(t))) continue;
    out.push(g.join(" "));
  }
  return out;
}

/** Distinct word-trigrams from the repair that also appear in any retest turn. */
export function reusedRepairPhrases(repairText: string, retestTurns: readonly string[], max = 3): string[] {
  const repair = ngrams(words(repairText), MIN_PHRASE_WORDS);
  if (repair.length === 0) return [];
  const turnGrams = new Set(retestTurns.flatMap((t) => ngrams(words(t), MIN_PHRASE_WORDS)));
  const hits: string[] = [];
  for (const g of repair) if (turnGrams.has(g) && !hits.includes(g)) hits.push(g);
  // Collapse overlapping trigrams into the first of each run to keep output short.
  return hits.slice(0, max);
}

export interface ReuseSummary {
  label: "unvalidated" | "insufficient_evidence";
  reusedCount: number;
  total: number;
  rate: number | null;
}

export function summariseReuse(pairs: readonly { reused: boolean }[]): ReuseSummary {
  const total = pairs.length;
  const reusedCount = pairs.filter((p) => p.reused).length;
  if (total < MIN_REUSE_SAMPLE) return { label: "insufficient_evidence", reusedCount, total, rate: null };
  return { label: "unvalidated", reusedCount, total, rate: reusedCount / total };
}
