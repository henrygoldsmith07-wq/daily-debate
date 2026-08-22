"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import MessageComposer from "./MessageComposer";
import { VerdictExplainPanel } from "./ArgGraphView";
import type { InputMode, PvpMatch, PvpTurn, PvpVerdict } from "@/lib/types";
import { TURN_ABANDON_MINUTES } from "@/lib/types";

export default function PvpRoom({
  match: initialMatch,
  topic,
  initialTurns,
  currentUserId,
  playerAName,
  playerBName,
}: {
  match: PvpMatch;
  topic: { title: string; prompt: string };
  initialTurns: PvpTurn[];
  currentUserId: string;
  playerAName: string;
  playerBName: string;
}) {
  const [match, setMatch] = useState(initialMatch);
  const [turns, setTurns] = useState(initialTurns);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [nowTs, setNowTs] = useState<number | null>(null);  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);

  useEffect(() => {
    // Follow new messages only while the reader is already near the bottom.
    if (scrollRef.current && pinnedToBottom.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns.length, sending]);

  // Re-evaluate forfeit eligibility periodically while waiting on opponent.
  const waitingOnOpponent = match.status === "active" && match.current_turn_player !== currentUserId;
  useEffect(() => {
    if (!waitingOnOpponent) return;
    // Async so the lint no-sync-setState-in-effect rule stays satisfied.
    const tick = () => setNowTs(Date.now());
    const initial = setTimeout(tick, 0);
    const timer = setInterval(tick, 30_000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [waitingOnOpponent]);

  const turnElapsedMin =
    match.turn_started_at && nowTs ? (nowTs - new Date(match.turn_started_at).getTime()) / 60_000 : 0;
  const canClaimForfeit =
    match.status === "active" &&
    match.current_turn_player !== null &&
    match.current_turn_player !== currentUserId &&
    turnElapsedMin > TURN_ABANDON_MINUTES;

  async function claimForfeit() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/pvp/${match.id}/forfeit`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to claim forfeit.");
      setMatch((prev) => ({ ...prev, status: "completed", winner_id: currentUserId, judge_verdict: data.verdict as PvpVerdict }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to claim forfeit.");
    } finally {
      setSending(false);
    }
  }

  // Full-state reconciliation: merges match + turns from the server so a
  // reconnecting client (or one that slept through events) resyncs exactly.
  useEffect(() => {
    let cancelled = false;
    async function reconcile() {
      try {
        const res = await fetch(`/api/pvp/${initialMatch.id}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setMatch(data.match);
        setTurns(data.turns);
      } catch {
        // Network blip — realtime or the next reconcile will catch up.
      }
    }

    function onVisible() {
      if (document.visibilityState === "visible") void reconcile();
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [initialMatch.id]);

  useEffect(() => {
    const supabase = createClient();
    let poll: ReturnType<typeof setInterval> | null = null;
    const channel = supabase
      .channel(`pvp-match-${match.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "pvp_turns", filter: `match_id=eq.${match.id}` },
        (payload) => {
          setTurns((prev) => (prev.some((t) => t.id === payload.new.id) ? prev : [...prev, payload.new as PvpTurn]));
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "pvp_matches", filter: `id=eq.${match.id}` },
        (payload) => setMatch(payload.new as PvpMatch),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setReconnecting(false);
          if (poll) {
            clearInterval(poll);
            poll = null;
          }
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          // Realtime dropped — fall back to snapshot polling until it returns.
          setReconnecting(true);
          if (!poll) {
            poll = setInterval(async () => {
              try {
                const res = await fetch(`/api/pvp/${match.id}`, { cache: "no-store" });
                if (!res.ok) return;
                const data = await res.json();
                setMatch(data.match);
                setTurns(data.turns);
              } catch {
                // keep polling
              }
            }, 3000);
          }
        }
      });

    return () => {
      if (poll) clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [match.id]);

  const verdict = match.judge_verdict;
  const isPlayerA = currentUserId === match.player_a;
  const mySide = isPlayerA ? match.player_a_side : match.player_a_side === "for" ? "against" : "for";
  const myTurn = match.status === "active" && match.current_turn_player === currentUserId;
  const nameFor = (playerId: string) => (playerId === match.player_a ? playerAName : playerBName);

  async function submitTurn(message: string, inputMode: InputMode) {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/pvp/${match.id}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, inputMode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit response.");
      setTurns((prev) => (prev.some((t) => t.id === data.turn.id) ? prev : [...prev, data.turn]));
      if (data.matchComplete) {
        setMatch((prev) => ({ ...prev, status: "completed", judge_verdict: data.verdict }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit response.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-ink3">{topic.title}</p>
        <p className="text-sm text-ink3">{topic.prompt}</p>
      </div>
      <div className="flex items-center justify-between text-sm">
        <p className="text-ink3">
          You&apos;re arguing <span className="text-[var(--foreground)]">{mySide}</span> as {isPlayerA ? "Player A" : "Player B"}
        </p>
        <p className="tabular text-ink3">
          Round {match.current_round}/{match.round_limit}
        </p>
      </div>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="surface-card flex flex-1 flex-col gap-3 overflow-y-auto p-4"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {turns.map((turn) => {
          const mine = turn.player_id === currentUserId;
          return (
            <div key={turn.id} className={`flex max-w-[85%] flex-col gap-1 ${mine ? "ml-auto items-end" : ""}`}>
              <p className="text-xs text-ink3">
                {nameFor(turn.player_id)} · round {turn.round_number}
              </p>
              <div className={`rounded-2xl px-3 py-2 text-sm ${mine ? "rounded-tr-sm bg-surface/10" : "rounded-tl-sm bg-[var(--accent-soft)]"}`}>
                {turn.message}
              </div>
            </div>
          );
        })}
      </div>

      {error && <p className="text-sm text-[var(--bad)]">{error}</p>}

      {reconnecting && match.status === "active" && (
        <p className="text-center text-xs text-ink3" role="status">
          Connection lost — reconnecting…
        </p>
      )}

      {match.status === "active" ? (
        myTurn ? (
          <MessageComposer onSubmit={submitTurn} disabled={sending} />
        ) : (
          <div className="flex flex-col items-center gap-2">
            <p className="text-center text-sm text-ink3">Waiting for your opponent…</p>
            {match.turn_started_at && nowTs && !canClaimForfeit && (
              <p className="text-center text-xs text-ink3">
                Forfeit claimable in ~{Math.max(1, Math.ceil(TURN_ABANDON_MINUTES - turnElapsedMin))} min
              </p>
            )}
            {canClaimForfeit && (
              <button
                type="button"
                onClick={claimForfeit}
                disabled={sending}
                className="btn btn-ghost px-4 py-1.5 text-xs text-[var(--bad)] disabled:opacity-40"
              >
                Opponent timed out — claim win by forfeit
              </button>
            )}
          </div>
        )
      ) : (
        <div className="flex flex-col gap-4">
          <div className="surface-card flex flex-col gap-3 p-6">
            <h2 className="text-lg font-semibold">
              {match.winner_id === null
                ? verdict?.isTie
                  ? "Too close to call"
                  : "Tie!"
                : match.winner_id === currentUserId
                  ? "You won! 🏆"
                  : "Your opponent won this one."}
            </h2>
            {!verdict && <p className="text-sm text-ink3">Awaiting judge verdict…</p>}
            <div className="flex gap-3 pt-2">
              <Link href="/pvp" className="btn btn-primary px-4 py-2 text-sm">
                Find another match
              </Link>
              <Link href="/leaderboard" className="btn btn-ghost px-4 py-2 text-sm">
                Leaderboard
              </Link>
            </div>
          </div>
          {verdict && <VerdictExplainPanel verdict={verdict} playerAName={playerAName} playerBName={playerBName} />}
        </div>
      )}
    </div>
  );
}
