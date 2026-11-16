"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Start a sprint on a past motion, For or Against, through the normal start
 * route; or continue the debate already open on it.
 */
export default function PastMotionStart({ topicId, activeDebateId }: { topicId: string; activeDebateId: string | null }) {
  const router = useRouter();
  const [starting, setStarting] = useState<"for" | "against" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (activeDebateId) {
    return (
      <Link href={`/debate/${activeDebateId}`} className="btn btn-secondary px-3 py-1.5 text-xs">
        Continue debate
      </Link>
    );
  }

  async function start(side: "for" | "against") {
    setStarting(side);
    setError(null);
    try {
      const res = await fetch("/api/solo/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicId, side, format: "sprint" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start the debate.");
      router.push(`/debate/${data.debate.id}`);
    } catch (err) {
      setError(err instanceof TypeError ? "Network error — check your connection and try again." : err instanceof Error ? err.message : "Could not start the debate.");
      setStarting(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        {(["for", "against"] as const).map((side) => (
          <button
            key={side}
            type="button"
            className="btn btn-secondary px-3 py-1.5 text-xs"
            disabled={starting !== null}
            onClick={() => void start(side)}
            data-testid={`past-motion-${side}`}
          >
            {starting === side ? "Starting…" : side === "for" ? "Argue For" : "Argue Against"}
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
