"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { DailyTopic, DebateSide } from "@/lib/types";

export default function TopicCard({ topic, activeDebateId }: { topic: DailyTopic; activeDebateId: string | null }) {
  const router = useRouter();
  const [side, setSide] = useState<DebateSide>("for");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startDebate() {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/solo/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicId: topic.id, side }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start debate.");
      router.push(`/debate/${data.debate.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start debate.");
      setStarting(false);
    }
  }

  return (
    <div className="surface-card flex flex-col gap-6 p-6">
      <div>
        <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-xs text-[var(--accent)]">
          {topic.category}
        </span>
        <p className="mt-3 text-base leading-relaxed">{topic.prompt}</p>
      </div>

      <div>
        <p className="mb-2 text-xs uppercase tracking-wide text-ink3">Credible sources to consider</p>
        <ul className="flex flex-col gap-2">
          {topic.sources.map((source) => (
            <li key={source.name} className="text-sm text-ink3">
              <a
                href={source.homepage}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-ink hover:underline"
              >
                {source.name}
              </a>{" "}
              — {source.angle}
            </li>
          ))}
        </ul>
      </div>

      {activeDebateId ? (
        <Link href={`/debate/${activeDebateId}`} className="btn btn-primary px-4 py-2 text-center text-sm">
          Continue your debate
        </Link>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink3">Pick your side, then debate the AI for at least 5 rounds.</p>
          <div className="flex gap-2" role="group" aria-label="Choose side">
            <button
              type="button"
              onClick={() => setSide("for")}
              aria-pressed={side === "for"}
              className={`btn flex-1 px-4 py-2 text-sm ${
                side === "for" ? "chip-elevated text-[var(--accent)]" : "btn-ghost"
              }`}
            >
              Argue For
            </button>
            <button
              type="button"
              onClick={() => setSide("against")}
              aria-pressed={side === "against"}
              className={`btn flex-1 px-4 py-2 text-sm ${
                side === "against" ? "chip-elevated text-[var(--accent)]" : "btn-ghost"
              }`}
            >
              Argue Against
            </button>
          </div>
          <button
            type="button"
            onClick={startDebate}
            disabled={starting}
            className="btn btn-primary px-4 py-2 text-sm disabled:opacity-40"
          >
            {starting ? (
              <span className="inline-flex items-center gap-2">
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-transparent" />
                Starting…
              </span>
            ) : (
              "Start solo debate"
            )}
          </button>
          {error && (
            <p className="text-sm text-[var(--bad)]" role="alert">
              {error}
            </p>
          )}
        </div>
      )}

      <Link href="/pvp" className="text-center text-sm text-ink3 hover:text-[var(--foreground)]">
        Or challenge another player on today&apos;s topic →
      </Link>
    </div>
  );
}
