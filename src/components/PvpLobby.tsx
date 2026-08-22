"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PVP_ROUNDS } from "@/lib/types";

export default function PvpLobby() {
  const router = useRouter();
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Surface an already-active match so a returning player doesn't try to
    // re-queue (the API would just bounce them back anyway).
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/pvp/queue", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (data.match?.id) setActiveMatchId(data.match.id);
      } catch {
        // non-critical
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

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
      {activeMatchId && !searching && (
        <Link href={`/pvp/${activeMatchId}`} className="btn btn-primary w-full px-4 py-2 text-sm">
          Return to your active match →
        </Link>
      )}
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
            You&apos;ll be randomly assigned a side and take turns arguing. After {PVP_ROUNDS} rounds each, an AI judge
            scores the match and declares a winner.
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
