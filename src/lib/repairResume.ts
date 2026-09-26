export interface RepairAttemptLite {
  debateId: string;
  targetKind: string;
  score: number;
  succeeded: boolean;
  createdAt: string;
  signals?: unknown;
}

export interface UnfinishedRepair {
  debateId: string;
  targetKind: string;
  label: string;
  score: number;
  attemptedAt: string;
  nextCue: string | null;
}

const REPAIR_KIND_LABELS: Record<string, string> = {
  evidence: "Evidence",
  rebuttal: "Rebuttal",
  logic: "Logic",
  impact: "Impact",
  structure: "Structure",
  clarity: "Clarity",
};

function attemptTime(attempt: RepairAttemptLite): number {
  const parsed = Date.parse(attempt.createdAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nextActionSignal(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const signals = value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
  const actionable = signals.find((signal) =>
    /^(aim|name|use|replace|add|compare|keep|separate|state|connect|make|turn|identify)\b/i.test(signal),
  );
  return actionable ?? signals[0] ?? null;
}

/**
 * Return the newest repair episode that still needs a successful rewrite.
 *
 * A repair episode is keyed by debate + target kind. Every raw attempt is kept,
 * but one successful attempt completes the episode even if the user submits a
 * weaker retry afterwards. This mirrors the longitudinal repair semantics used
 * elsewhere in the product and prevents Today from resurrecting completed work.
 */
export function latestUnfinishedRepair(
  attempts: RepairAttemptLite[],
): UnfinishedRepair | null {
  const ordered = [...attempts].sort((a, b) => attemptTime(b) - attemptTime(a));
  const episodes = new Map<
    string,
    { latest: RepairAttemptLite; anySucceeded: boolean }
  >();

  for (const attempt of ordered) {
    const key = `${attempt.debateId}\u0000${attempt.targetKind}`;
    const existing = episodes.get(key);
    if (!existing) {
      episodes.set(key, {
        latest: attempt,
        anySucceeded: attempt.succeeded,
      });
      continue;
    }
    existing.anySucceeded ||= attempt.succeeded;
  }

  const unresolved = [...episodes.values()]
    .filter((episode) => !episode.anySucceeded)
    .sort((a, b) => attemptTime(b.latest) - attemptTime(a.latest))[0];

  if (!unresolved) return null;

  const latest = unresolved.latest;
  return {
    debateId: latest.debateId,
    targetKind: latest.targetKind,
    label: REPAIR_KIND_LABELS[latest.targetKind] ?? "Argument",
    score: latest.score,
    attemptedAt: latest.createdAt,
    nextCue: nextActionSignal(latest.signals),
  };
}
