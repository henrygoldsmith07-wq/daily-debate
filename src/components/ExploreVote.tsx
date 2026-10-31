"use client";

import Link from "next/link";
import { useState } from "react";
import type { ExploreKind, ExploreVotes } from "@/lib/explore";
import type { DebateSide } from "@/lib/types";

/**
 * "Who argued better?" — one vote per viewer per debate. The split is shown
 * only after the viewer has voted (or to a participant), so it cannot steer a
 * vote. The label is explicit: a crowd's read of the arguments, not a verdict
 * on which side is right and not a validated judgement.
 */
export default function ExploreVote({
  kind,
  id,
  forName,
  againstName,
  initialVotes,
  initialMyVote,
  isParticipant,
  signedIn,
}: {
  kind: ExploreKind;
  id: string;
  forName: string;
  againstName: string;
  initialVotes: ExploreVotes | null;
  initialMyVote: DebateSide | null;
  isParticipant: boolean;
  signedIn: boolean;
}) {
  const [votes, setVotes] = useState(initialVotes);
  const [myVote, setMyVote] = useState(initialMyVote);
  const [sending, setSending] = useState<DebateSide | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function vote(choice: DebateSide) {
    setSending(choice);
    setError(null);
    try {
      const res = await fetch("/api/explore/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, id, choice }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not record your vote.");
      setVotes(data.votes);
      setMyVote(data.myVote);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record your vote.");
    } finally {
      setSending(null);
    }
  }

  const total = votes ? votes.for + votes.against : 0;
  const forShare = votes && total > 0 ? Math.round((votes.for / total) * 100) : 50;

  return (
    <div className="explore-vote" data-testid="explore-vote">
      <p className="explore-vote-question">Who argued better?</p>
      {votes ? (
        <div className="explore-vote-result">
          <div className="explore-vote-bar" aria-hidden="true">
            <span style={{ width: `${forShare}%` }} />
          </div>
          <p className="explore-vote-counts">
            <span>{forName} · {votes.for}</span>
            <span>
              {total} vote{total === 1 ? "" : "s"}
              {myVote ? ` · you picked ${myVote === "for" ? forName : againstName}` : isParticipant ? " · your debate" : ""}
            </span>
            <span>{votes.against} · {againstName}</span>
          </p>
        </div>
      ) : signedIn ? (
        <div className="explore-vote-buttons" role="group" aria-label="Who argued better?">
          <button type="button" className="btn btn-secondary" disabled={sending !== null} onClick={() => void vote("for")}>
            {forName}
          </button>
          <button type="button" className="btn btn-secondary" disabled={sending !== null} onClick={() => void vote("against")}>
            {againstName}
          </button>
        </div>
      ) : (
        <Link href="/login" className="explore-vote-signin">Sign in to vote and see the split →</Link>
      )}
      <p className="explore-vote-note">A crowd&apos;s read of the arguments, not a ruling on which side is right.</p>
      {error && <p className="text-xs text-[var(--bad)]" role="alert">{error}</p>}
    </div>
  );
}
