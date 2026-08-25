"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { isKnownSource } from "@/lib/citationVerifier";
import type { DailyTopic, DebateSide } from "@/lib/types";

export interface EvidenceChecksView {
  supportsClaim?: boolean;
  relevant?: boolean;
  current?: boolean | null;
  primary?: boolean;
  matchScore?: number;
}

export interface EvidenceCardView {
  id?: string;
  claim: string;
  source_name: string;
  source_type: string;
  url: string;
  title?: string | null;
  passage: string;
  published_date?: string | null;
  checks?: EvidenceChecksView;
}

export default function TopicCard({
  topic,
  activeDebateId,
  evidenceCards = [],
}: {
  topic: DailyTopic;
  activeDebateId: string | null;
  evidenceCards?: EvidenceCardView[];
}) {
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

      {evidenceCards.length > 0 ? (
        <div>
          <p className="mb-2 text-xs uppercase tracking-wide text-ink3">
            Retrieved evidence — verified passages
          </p>
          <ul className="flex flex-col gap-3">
            {evidenceCards.map((card) => {
              const c = card.checks ?? {};
              const chips: Array<{ ok: boolean | null | undefined; label: string }> = [
                { ok: c.supportsClaim, label: c.supportsClaim ? "supports claim" : "weak support" },
                { ok: c.current ?? null, label: c.current === null || c.current === undefined ? "date unknown" : c.current ? "current" : "dated" },
                { ok: c.primary, label: c.primary ? "primary" : "secondary" },
                { ok: c.relevant, label: c.relevant ? "relevant" : "tangential" },
              ];
              return (
                <li key={card.url} className="rounded-xl border border-[var(--rule)] bg-surface-2 p-4">
                  <p className="text-sm font-medium">{card.claim}</p>
                  <dl className="mt-2 flex flex-col gap-1 text-xs">
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 uppercase tracking-wide text-ink3">Source</dt>
                      <dd className="font-medium">
                        {card.source_name}
                        <span className="text-ink3"> · {card.source_type}</span>
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 uppercase tracking-wide text-ink3">Passage</dt>
                      <dd className="italic leading-relaxed">“{card.passage}”</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 uppercase tracking-wide text-ink3">Published</dt>
                      <dd className="tabular">{card.published_date ?? "unknown"}</dd>
                    </div>
                  </dl>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {chips.map((chip) => (
                      <span
                        key={chip.label}
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          chip.ok === true
                            ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                            : chip.ok === false
                              ? "bg-surface-2 text-amber-600"
                              : "bg-surface-2 text-ink3"
                        }`}
                      >
                        {chip.ok === false ? "⚠ " : chip.ok === true ? "✓ " : ""}
                        {chip.label}
                      </span>
                    ))}
                    <a
                      href={card.url}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-auto text-xs font-medium text-[var(--accent)] hover:underline"
                    >
                      [Open source]
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
      <div>
        <p className="mb-2 text-xs uppercase tracking-wide text-ink3">Credible sources to consider</p>
        <ul className="flex flex-col gap-2">
          {topic.sources.map((source) => {
            // Offline allowlist check: flag institutions we can't vouch for so
            // a hallucinated "source" is visible before anyone cites it.
            const known = isKnownSource(source.name);
            return (
              <li key={source.name} className="text-sm text-ink3">
                <a
                  href={source.homepage}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-ink hover:underline"
                >
                  {known ? <span className="mr-1 text-[var(--accent)]" title="Verified institution">✓</span> : null}
                  {source.name}
                </a>
                {!known && (
                  <span className="ml-1 text-xs text-amber-600" title="Not in the verified-source allowlist — double-check before citing">
                    ⚠ unverified
                  </span>
                )}{" "}
                — {source.angle}
              </li>
            );
          })}
        </ul>
        </div>
      )}

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
