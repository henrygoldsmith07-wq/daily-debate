"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startRetestRequest } from "@/lib/startRetestRequest";

/**
 * One-tap start of today's sprint from the "repair is waiting to be tested"
 * card. The deliberate retest is assigned server-side from the pending repair
 * (`/api/solo/start`), so this sends no retest hint and the card never names
 * the skill or the day (retestDisclosure.ts). Because the durable assignment
 * is what marks a repair "prompted", starting here feeds the existing
 * prompted-vs-incidental arm on /analytics with no new event.
 */
export default function RetestStartButton({
  topicId,
  label,
  format = "sprint",
  testId = "priority-retest",
}: {
  topicId: string;
  label: string;
  /** "full" for the 7-day re-check: a sprint is too short to judge the skill. */
  format?: "sprint" | "full";
  testId?: string;
}) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setStarting(true);
    setError(null);
    const r = await startRetestRequest(topicId, fetch, typeof navigator === "undefined" || navigator.onLine !== false, format);
    if (r.ok) {
      router.push(`/debate/${r.debateId}`);
      return;
    }
    setError(r.error);
    setStarting(false);
  }

  return (
    <div className="flex flex-col gap-2 self-start">
      <button
        type="button"
        onClick={start}
        disabled={starting}
        className="btn btn-primary px-4 py-2 text-center text-sm"
        data-testid={testId}
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
