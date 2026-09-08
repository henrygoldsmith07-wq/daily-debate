"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function AcceptChallengeButton({ code, signedIn }: { code: string; signedIn: boolean }) {
  const router = useRouter();
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setAccepting(true);
    setError(null);
    try {
      const res = await fetch(`/api/challenges/${code}`, { method: "POST" });
      const data = await res.json();
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (!res.ok) throw new Error(data.error || "Failed to accept the challenge.");
      router.push(`/pvp/${data.matchId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept the challenge.");
      setAccepting(false);
    }
  }

  if (!signedIn) {
    return (
      <div className="flex flex-col items-center gap-2">
        <Link href="/login" className="btn btn-primary px-6 py-2.5 text-sm uppercase tracking-wide" data-testid="accept-challenge">
          Accept challenge
        </Link>
        <p className="text-xs text-ink3">Sign in first — accepting reopens your challenges from the lobby.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={accept}
        disabled={accepting}
        className="btn btn-primary px-6 py-2.5 text-sm uppercase tracking-wide disabled:opacity-40"
        data-testid="accept-challenge"
      >
        {accepting ? "Accepting…" : "Accept challenge"}
      </button>
      {error && <p className="text-sm text-[var(--bad)]" role="alert">{error}</p>}
    </div>
  );
}
