"use client";

import Link from "next/link";
import { useState } from "react";

/**
 * Publish a finished debate to Explore, or take it down. Nothing is public by
 * default. A PvP match goes up only when both players have said yes, and
 * either can withdraw at any time; the copy says exactly that, and that your
 * username and arguments become visible to anyone.
 */
export default function PublishToggle({
  kind,
  id,
  initialPublished,
  opponentConsent = null,
}: {
  kind: "solo" | "pvp";
  id: string;
  initialPublished: boolean;
  /** PvP only: the other player's choice (null = not decided). */
  opponentConsent?: boolean | null;
}) {
  const [mine, setMine] = useState(initialPublished);
  const [theirs, setTheirs] = useState<boolean | null>(opponentConsent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function update(publish: boolean) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/explore/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, id, publish }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not update publishing.");
      setMine(kind === "solo" ? data.published : data.mine);
      if (kind === "pvp") setTheirs(data.theirs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update publishing.");
    } finally {
      setSaving(false);
    }
  }

  const live = kind === "solo" ? mine : mine && theirs === true;
  const status = live
    ? "Published on Explore."
    : kind === "pvp" && mine
      ? theirs === false
        ? "Your opponent chose not to publish, so it stays private."
        : "Waiting for your opponent to agree. It goes up only if they do."
      : "Private. Only you can see it.";

  return (
    <section className="publish-toggle surface-card" data-testid="publish-toggle" aria-labelledby={`publish-${id}`}>
      <div className="min-w-0">
        <p className="publish-toggle-kicker" id={`publish-${id}`}>Explore</p>
        <p className="publish-toggle-status" aria-live="polite">{status}</p>
        <p className="publish-toggle-note">
          Publishing shows your username and every argument in this debate to anyone, and lets people vote on who argued
          better.{kind === "pvp" ? " Both players must agree; either of you can take it down." : " You can take it down at any time."}
          {live ? (
            <>
              {" "}
              <Link href={`/explore/${kind}/${id}`} className="underline">View it</Link>
            </>
          ) : null}
        </p>
        {error && <p className="text-xs text-[var(--bad)]" role="alert">{error}</p>}
      </div>
      <button
        type="button"
        className={`btn ${mine ? "btn-secondary" : "btn-primary"} shrink-0 px-4 py-2 text-sm`}
        onClick={() => void update(!mine)}
        disabled={saving}
        aria-pressed={mine}
      >
        {mine ? "Take it down" : kind === "pvp" ? "Agree to publish" : "Publish to Explore"}
      </button>
    </section>
  );
}
