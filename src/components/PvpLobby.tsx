"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PVP_ROUNDS } from "@/lib/types";
import { trackEvent } from "@/lib/trackClientEvent";

export default function PvpLobby() {
  const router = useRouter();
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ code: string; url: string; expiresAt: string } | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [creatingInvite, setCreatingInvite] = useState(false);
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
    trackEvent("pvp_started", {});
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

  async function createChallenge() {
    setCreatingInvite(true);
    setInviteError(null);
    try {
      const res = await fetch("/api/challenges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ side: Math.random() < 0.5 ? "for" : "against" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create the challenge.");
      setInvite({ code: data.invite.code, url: data.url, expiresAt: data.invite.expires_at });
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Failed to create the challenge.");
    } finally {
      setCreatingInvite(false);
    }
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

      <div className="w-full border-t border-[var(--rule)] pt-5">
        <p className="text-xs uppercase tracking-[0.14em] text-ink3">Challenge a friend</p>
        <p className="mt-1 text-sm text-ink3">
          Get a shareable link. Your friend accepts when they&apos;re ready — nobody has to be online at the same time.
        </p>
        {invite ? (
          <div className="mt-3 rounded-lg border border-[var(--rule)] bg-surface-2 p-3 text-left text-sm" data-testid="challenge-invite">
            <p className="font-medium">Share this link:</p>
            <p className="mt-1 break-all font-mono text-xs text-[var(--accent)]">{invite.url}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(window.location.origin + invite.url).catch(() => {})}
                className="btn btn-ghost px-3 py-1 text-xs"
              >
                Copy link
              </button>
              <span className="text-xs text-ink3">Expires {new Date(invite.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={createChallenge}
            disabled={creatingInvite}
            className="btn btn-secondary mt-3 px-4 py-2 text-sm disabled:opacity-40"
            data-testid="create-challenge"
          >
            {creatingInvite ? "Creating…" : "Create a friend challenge"}
          </button>
        )}
        {inviteError && <p className="mt-2 text-sm text-[var(--bad)]">{inviteError}</p>}
      </div>
    </div>
  );
}
