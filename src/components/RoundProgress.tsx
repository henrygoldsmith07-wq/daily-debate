"use client";

import { MAX_ROUNDS, MIN_ROUNDS } from "@/lib/types";

/**
 * Round-progress dots for solo debates: filled = answered, ring = the round
 * being answered, dim = upcoming. A tick separator marks where finishing
 * (and scoring) unlocks after MIN_ROUNDS.
 */
export default function RoundProgress({ answered }: { answered: number }) {
  return (
    <div
      className="flex items-center gap-1"
      role="img"
      aria-label={`${answered} of ${MAX_ROUNDS} rounds answered`}
    >
      {Array.from({ length: MAX_ROUNDS }, (_, i) => {
        const round = i + 1;
        const filled = round <= answered;
        const current = round === answered + 1;
        return (
          <span key={round} className="flex items-center">
            {round === MIN_ROUNDS + 1 && (
              <span className="mx-1 h-3 w-px bg-[var(--rule)]" aria-hidden="true" />
            )}
            <span
              className={`h-2 w-2 rounded-full transition-colors ${
                filled ? "bg-[var(--accent)]" : current ? "border border-[var(--accent)] animate-pulse" : "bg-surface-2"
              }`}
            />
          </span>
        );
      })}
    </div>
  );
}
