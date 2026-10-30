// M19: after a failed retest, suggest a different angle for the repair.
// Deterministic and descriptive: it compares the repair wording with the
// original weak line and the retest turns, and never claims the angle will
// work. Always labelled unvalidated.

import { reusedRepairPhrases } from "./repairPhraseReuse";

export interface SecondOpinion {
  label: "unvalidated";
  /** Whether the repair wording showed up in the retest turns at all. */
  repairReused: boolean;
  /** Whether the repair mostly restated the original weak line. */
  restatesOriginal: boolean;
  suggestion: string;
}

function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().replace(/[^a-z0-9'\s]/g, " ").split(/\s+/).filter((t) => t.length > 2));
}

/** Share of the repair's words that already appear in the original line (0-1). */
export function overlapWithOriginal(original: string, repair: string): number {
  const r = tokens(repair);
  if (r.size === 0) return 0;
  const o = tokens(original);
  let shared = 0;
  for (const t of r) if (o.has(t)) shared++;
  return shared / r.size;
}

export const RESTATE_THRESHOLD = 0.7;

export function secondOpinionFor(input: {
  outcome: string;
  before: string;
  after: string;
  retestTurns: readonly string[];
  skillLabel: string;
}): SecondOpinion | null {
  if (input.outcome !== "skill-not-observed") return null;
  if (!input.before.trim() || !input.after.trim()) return null;
  const restatesOriginal = overlapWithOriginal(input.before, input.after) >= RESTATE_THRESHOLD;
  const repairReused = reusedRepairPhrases(input.after, input.retestTurns, 1).length > 0;
  let suggestion: string;
  if (restatesOriginal) {
    suggestion = `Your repair mostly repeated the original line. Try a different angle for ${input.skillLabel}: change what the sentence claims or shows, not just its wording.`;
  } else if (!repairReused) {
    suggestion = `Your repair wording did not come up in the retest. Pick one phrase from it that fits ${input.skillLabel} and plan where to use it in your first turn.`;
  } else {
    suggestion = `You used your repair wording, but ${input.skillLabel} still was not observed. Try attaching it to a concrete example or number in the same sentence.`;
  }
  return { label: "unvalidated", repairReused, restatesOriginal, suggestion };
}
