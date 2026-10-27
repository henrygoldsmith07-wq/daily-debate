"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * One-tap start of today's sprint from the "repair is waiting to be tested"
 * card. The deliberate retest is assigned server-side from the pending repair
 * (`/api/solo/start`), so this sends no retest hint and the card never names
 * the skill or the day (retestDisclosure.ts). Because the durable assignment
 * is what marks a repair "prompted", starting here feeds the existing
 * prompted-vs-incidental arm on /analytics with no new event.
 */
export default function RetestStartButton({ topicId, label }: { topicId: string; label: string }) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setError("You appear to be offline — reconnect and try again.");
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/solo/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicId, side: "challenge", format: "sprint" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start debate.");
      router.push(`/debate/${data.debate.id}`);
    } catch (err) {
      setError(
        err instanceof TypeError
          ? "Network error — check your connection and try again."
          : err instanceof Error
            ? err.message
            : "Failed to start debate.",
      );
      setStarting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 self-start">
      <button
        type="button"
        onClick={start}
        disabled={starting}
        className="btn btn-primary px-4 py-2 text-center text-sm"
        data-testid="priority-retest"
      >
        {starting ? "Starting…" : `${label} →`}
      </button>
      {error && (
        <p role="alert" className="text-xs text-[var(--danger,#b42318)]">
          {error}
        </p>
      )}
    </div>
  );
}
