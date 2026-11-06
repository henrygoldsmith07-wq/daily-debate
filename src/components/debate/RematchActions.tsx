"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DebateFormat } from "@/lib/sprint";
import type { OpponentDifficulty, OpponentPersonaId } from "@/lib/opponentPersona";
import { rematchOptions, type DebateSide } from "@/lib/rematch";

/**
 * "Argue the other side" and "Rematch, harder" on a fresh result. Each starts
 * a new debate on the same motion through the normal start route, keeping
 * the format and opponent style.
 */
export default function RematchActions({
  topicId,
  side,
  format,
  persona,
  difficulty,
}: {
  topicId: string;
  side: DebateSide;
  format: DebateFormat;
  persona: OpponentPersonaId;
  difficulty: OpponentDifficulty;
}) {
  const router = useRouter();
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(option: ReturnType<typeof rematchOptions>[number]) {
    setStarting(option.id);
    setError(null);
    try {
      const res = await fetch("/api/solo/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicId, side: option.side, format, persona, difficulty: option.difficulty }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start the rematch.");
      router.push(`/debate/${data.debate.id}`);
    } catch (err) {
      setError(err instanceof TypeError ? "Network error — check your connection and try again." : err instanceof Error ? err.message : "Could not start the rematch.");
      setStarting(null);
    }
  }

  return (
    <div className="flex flex-col gap-1" data-testid="rematch-actions">
      <div className="flex flex-wrap gap-2">
        {rematchOptions(side, difficulty).map((option) => (
          <button
            key={option.id}
            type="button"
            className="btn btn-secondary px-3 py-1.5 text-xs"
            disabled={starting !== null}
            onClick={() => void start(option)}
            data-testid={`rematch-${option.id}`}
          >
            {starting === option.id ? "Starting…" : option.label}
          </button>
        ))}
      </div>
      {error && (
        <p className="text-xs text-[var(--bad)]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
