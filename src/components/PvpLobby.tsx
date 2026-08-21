"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function PvpLobby() {
  const router = useRouter();
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function findOpponent() {
    setSearching(true);
    setError(null);
    try {
      const res = await fetch("/api/pvp/queue", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to join queue.");
      if (data.match) {
        router.push(`/pvp/${data.match.id}`);
        return;
      }
      let consecutiveFailures = 0;
      pollRef.current = setInterval(async () => {
        try {
          const pollRes = await fetch("/api/pvp/queue");
          const pollData = await pollRes.json();
          if (!pollRes.ok) throw new Error(pollData.error || "Lost the queue.");
          consecutiveFailures = 0;
          if (pollData.match) {
            if (pollRef.current) clearInterval(pollRef.current);
            router.push(`/pvp/${pollData.match.id}`);
          } else if (pollData.waiting === false) {
            // Queue entry vanished (e.g. cleared server-side) — stop instead of polling forever.
            if (pollRef.current) clearInterval(pollRef.current);
            setSearching(false);
          }
        } catch {
          consecutiveFailures += 1;
          if (consecutiveFailures >= 4 && pollRef.current) {
            clearInterval(pollRef.current);
            setSearching(false);
            setError("Lost connection while searching. Please try again.");
          }
        }
      }, 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join queue.");
      setSearching(false);
    }
  }

  async function cancelSearch() {
    if (pollRef.current) clearInterval(pollRef.current);
    setSearching(false);
    await fetch("/api/pvp/queue", { method: "DELETE" });
  }

  return (
    <div className="surface-card flex flex-col items-center gap-4 p-8 text-center">
      {searching ? (
        <>
          <p className="text-sm text-ink3">Looking for an opponent on today&apos;s topic…</p>
          <button type="button" onClick={cancelSearch} className="btn btn-ghost px-4 py-2 text-sm">
            Cancel
          </button>
        </>
      ) : (
        <>
          <p className="text-sm text-ink3">
            You&apos;ll be randomly assigned a side and take turns arguing. After {5} rounds each, an AI judge scores
            the match and declares a winner.
          </p>
          <button type="button" onClick={findOpponent} className="btn btn-primary px-6 py-2.5 text-sm">
            Find an opponent
          </button>
        </>
      )}
      {error && <p className="text-sm text-[var(--bad)]">{error}</p>}
    </div>
  );
}
