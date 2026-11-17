// M21: turn-level evidence for a retest. Finds which retest turn is lexically
// closest to the learner's original weak line, and whether that wording
// persisted. Descriptive only (word overlap, not judged quality): always
// labelled unvalidated, and aggregates are sample-gated.

export const PERSIST_THRESHOLD = 0.5;
export const MIN_EVIDENCE_SAMPLE = 5;

export interface RetestEvidence {
  /** 1-based retest turn closest to the original line. */
  turn: number;
  similarity: number;
  persisted: boolean;
  excerpt: string;
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9'\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
}

export function retestTurnEvidence(before: string, turns: readonly string[]): RetestEvidence | null {
  const b = tokens(before);
  if (b.size < 3 || turns.length === 0) return null;
  let best: RetestEvidence | null = null;
  turns.forEach((turn, i) => {
    const t = tokens(turn);
    if (t.size === 0) return;
    let inter = 0;
    for (const w of b) if (t.has(w)) inter++;
    // Share of the original line's words that came back in this turn.
    const similarity = Math.round((inter / b.size) * 100) / 100;
    if (!best || similarity > best.similarity) {
      best = { turn: i + 1, similarity, persisted: similarity >= PERSIST_THRESHOLD, excerpt: turn.trim().slice(0, 160) };
    }
  });
  return best;
}

export interface EvidenceSummary {
  label: "unvalidated" | "insufficient_evidence";
  persisted: number;
  total: number;
  rate: number | null;
}

export function summariseEvidence(items: readonly { persisted: boolean }[]): EvidenceSummary {
  const total = items.length;
  const persisted = items.filter((i) => i.persisted).length;
  if (total < MIN_EVIDENCE_SAMPLE) return { label: "insufficient_evidence", persisted, total, rate: null };
  return { label: "unvalidated", persisted, total, rate: persisted / total };
}
