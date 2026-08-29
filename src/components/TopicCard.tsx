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
  coachingFocus = "Use evidence for major claims.",
}: {
  topic: DailyTopic;
  activeDebateId: string | null;
  evidenceCards?: EvidenceCardView[];
  coachingFocus?: string;
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
    <section className="home-motion-card surface-card" aria-labelledby="today-motion">
      <div className="home-motion-heading">
        <div>
          <p className="home-motion-kicker">Today&apos;s motion</p>
          <p className="home-motion-meta">One focused rep · at least 5 rounds</p>
        </div>
        <span className="pill border-[var(--speak)]/30 bg-[var(--speak-soft)] text-[var(--speak)]">
          {topic.category ?? "Daily debate"}
        </span>
      </div>

      <div className="home-motion-body">
        <div>
          <h2 id="today-motion" className="home-motion-title">{topic.title}</h2>
          <p className="home-motion-prompt">{topic.prompt}</p>
        </div>

        <div className="home-coaching-focus">
          <span className="home-coaching-label">Today&apos;s coaching focus</span>
          <strong>{coachingFocus}</strong>
        </div>

        {activeDebateId ? (
          <Link href={`/debate/${activeDebateId}`} className="home-start-button btn btn-primary px-4 py-3 text-center text-sm">
            Continue your debate <span aria-hidden="true">→</span>
          </Link>
        ) : (
          <div className="home-start-block">
            <div className="home-side-label">Your side</div>
            <div className="home-side-picker" role="group" aria-label="Choose side">
              <button
                type="button"
                onClick={() => setSide("for")}
                aria-pressed={side === "for"}
                className={`home-side-option ${side === "for" ? "selected" : ""}`}
              >
                <span className="home-side-option-label">For</span>
                <span>Make the case</span>
              </button>
              <button
                type="button"
                onClick={() => setSide("against")}
                aria-pressed={side === "against"}
                className={`home-side-option ${side === "against" ? "selected" : ""}`}
              >
                <span className="home-side-option-label">Against</span>
                <span>Push back</span>
              </button>
            </div>
            <button
              type="button"
              onClick={startDebate}
              disabled={starting}
              className="home-start-button btn btn-primary px-4 py-3 text-sm disabled:opacity-40"
            >
              {starting ? (
                <span className="inline-flex items-center gap-2">
                  <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-transparent" />
                  Starting…
                </span>
              ) : (
                <>Start debate <span aria-hidden="true">→</span></>
              )}
            </button>
            <p className="home-start-note">You&apos;ll get one clear goal per round and a coach note after every response.</p>
            {error && <p className="text-sm text-[var(--bad)]" role="alert">{error}</p>}
          </div>
        )}
      </div>

      <div className="home-motion-foot">
        <details className="home-motion-details">
          <summary className="home-motion-details-summary">
            <span>{evidenceCards.length > 0 ? "Browse verified evidence" : "Browse credible sources"}</span>
            <span className="home-motion-details-chevron" aria-hidden="true">+</span>
          </summary>
          <div className="mt-3">
          {evidenceCards.length > 0 ? (
            <div>
            <p className="mb-2 text-xs uppercase tracking-wide text-ink3">Retrieved evidence · verified passages</p>
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
                      <div className="flex gap-2"><dt className="w-20 shrink-0 uppercase tracking-wide text-ink3">Source</dt><dd className="font-medium">{card.source_name}<span className="text-ink3"> · {card.source_type}</span></dd></div>
                      <div className="flex gap-2"><dt className="w-20 shrink-0 uppercase tracking-wide text-ink3">Passage</dt><dd className="italic leading-relaxed">“{card.passage}”</dd></div>
                      <div className="flex gap-2"><dt className="w-20 shrink-0 uppercase tracking-wide text-ink3">Published</dt><dd className="tabular">{card.published_date ?? "unknown"}</dd></div>
                    </dl>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {chips.map((chip) => <span key={chip.label} className={`rounded-full px-2 py-0.5 text-xs ${chip.ok === true ? "bg-[var(--accent-soft)] text-[var(--accent)]" : chip.ok === false ? "bg-surface-2 text-amber-600" : "bg-surface-2 text-ink3"}`}>{chip.ok === false ? "⚠ " : chip.ok === true ? "✓ " : ""}{chip.label}</span>)}
                      <a href={card.url} target="_blank" rel="noreferrer" className="ml-auto text-xs font-medium text-[var(--accent)] hover:underline">[Open source]</a>
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
                    <a href={source.homepage} target="_blank" rel="noreferrer" className="font-medium text-ink hover:underline">
                      {known ? <span className="mr-1 text-[var(--accent)]" title="Verified institution">✓</span> : null}
                      {source.name}
                    </a>
                    {!known && <span className="ml-1 text-xs text-amber-600" title="Not in the verified-source allowlist — double-check before citing">⚠ unverified</span>} — {source.angle}
                  </li>
                );
              })}
            </ul>
            </div>
          )}
          </div>
        </details>

        <Link href="/pvp" className="home-motion-foot-link">
          Challenge another player →
        </Link>
      </div>
    </section>
  );
}
