"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { isKnownSource } from "@/lib/citationVerifier";
import { experimentalSurfacesEnabled } from "@/lib/featureFlags";
import { formatEstimateLabel, formatLabelFor, SPRINT_ESTIMATE_MINUTES, SPRINT_ROUNDS, type DebateFormat } from "@/lib/sprint";
import { OPPONENT_DIFFICULTY_LIST, OPPONENT_PERSONA_LIST, type OpponentDifficulty, type OpponentPersonaId } from "@/lib/opponentPersona";
import type { DailyTopic, DebateSide } from "@/lib/types";
import { NEUTRAL_GOAL_LINE } from "@/lib/retestDisclosure";
import { challengePreviewHeadline, type ChallengePreview } from "@/lib/challengeMe";
import {
  GUEST_FOCUS_LABEL,
  LEARNER_FOCUS_LABEL,
  NO_FIRST_FOCUS,
  type FirstFocusView,
} from "@/lib/guestFocusCopy";

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

type SideChoice = DebateSide | "challenge";

/** Legacy rows may hold `{}` in the jsonb sources column — normalise to an array. */
function safeSources(topic: DailyTopic): DailyTopic["sources"] {
  return Array.isArray(topic.sources) ? topic.sources : [];
}

export default function TopicCard({
  topic,
  activeDebateId,
  evidenceCards = [],
  goalLine = NEUTRAL_GOAL_LINE,
  lastLine,
  focusLabel = "Today's focus",
  isFirstVisit = false,
  motionReason = null,
  challengePreview = null,
  firstFocus = null,
}: {
  topic: DailyTopic;
  activeDebateId: string | null;
  evidenceCards?: EvidenceCardView[];
  /** Today's coaching goal headline (shown before the debate). */
  goalLine?: string;
  /** Evidence from the previous debate, when the goal is based on one. */
  lastLine?: string | null;
  focusLabel?: string;
  /** First-run onboarding: replaces the goal card with a how-it-works line. */
  isFirstVisit?: boolean;
  /** Why this motion was picked for this user (null = shared daily motion). */
  motionReason?: string | null;
  /**
   * The side "Challenge me" will assign, resolved server-side with the same
   * resolver the start route uses. Null = could not resolve; the card falls
   * back to promising the reveal at start.
   */
  challengePreview?: ChallengePreview | null;
  /**
   * First signed-in debate after guest practice: the focus pre-selected from
   * the guest repair (guestFocus.ts). Labelled unvalidated; the learner may
   * change it or turn it off, and the choice is sent with Start.
   */
  firstFocus?: FirstFocusView | null;
}) {
  const router = useRouter();
  const [focusChoice, setFocusChoice] = useState<string>(firstFocus?.suggested ?? NO_FIRST_FOCUS);
  const [side, setSide] = useState<SideChoice>("challenge");
  const [persona, setPersona] = useState<OpponentPersonaId>("balanced");
  const [difficulty, setDifficulty] = useState<OpponentDifficulty>("challenging");
  const [starting, setStarting] = useState<DebateFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startDebate(format: DebateFormat) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setError("You appear to be offline — reconnect and try again.");
      return;
    }
    setStarting(format);
    setError(null);
    try {
      const res = await fetch("/api/solo/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // No `retestFor` here: the deliberate retest is assigned server-side
        // from the pending repair, so the client cannot nominate a debate to
        // be scored as a transfer test (and no surface may announce one).
        body: JSON.stringify({
          topicId: topic.id,
          side,
          format,
          persona,
          difficulty,
          ...(firstFocus ? { firstFocus: focusChoice } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start debate.");
      router.push(`/debate/${data.debate.id}`);
    } catch (err) {
      // Distinguish a network failure (fetch throws) from a server rejection.
      setError(err instanceof TypeError ? "Network error — check your connection and try again." : err instanceof Error ? err.message : "Failed to start debate.");
      setStarting(null);
    }
  }

  const sideMeta: Record<SideChoice, { label: string; sub: string }> = {
    for: { label: "For", sub: "Make the case" },
    against: { label: "Against", sub: "Push back" },
    challenge: { label: "Challenge me", sub: "Pick for me" },
  };

  return (
    <section className="home-motion-card surface-card" aria-labelledby="today-motion">
      <div className="home-motion-heading">
        <div>
          <p className="home-motion-kicker">Today&apos;s motion</p>
          <p className="home-motion-meta">Sprint: {SPRINT_ROUNDS} focused rounds · about {SPRINT_ESTIMATE_MINUTES} minutes · more formats below</p>
        </div>
        <span className="pill border-[var(--speak)]/30 bg-[var(--speak-soft)] text-[var(--speak)]">
          {topic.category ?? "Daily debate"}
        </span>
      </div>

      <div className="home-motion-body">
        <div>
          <h2 id="today-motion" className="home-motion-title">{topic.title}</h2>
          <p className="home-motion-prompt">{topic.prompt}</p>
          {motionReason && (
            <p className="mt-2 text-xs leading-5 text-ink3" data-testid="motion-reason">
              <span className="font-medium text-ink2">Why this motion?</span> {motionReason}
            </p>
          )}
        </div>

        {firstFocus && !activeDebateId ? (
          <div className="home-coaching-focus" data-testid="first-focus" data-focus={focusChoice}>
            <span className="home-coaching-label" data-testid="first-focus-label">
              {focusChoice === firstFocus.suggested
                ? firstFocus.label
                : focusChoice === NO_FIRST_FOCUS
                  ? "No focus for this debate"
                  : LEARNER_FOCUS_LABEL}
            </span>
            <strong>
              {firstFocus.options.find((option) => option.key === focusChoice)?.headline ??
                "Argue freely — the coach still flags one weakness afterwards."}
            </strong>
            <span className="home-coaching-lastline">
              {focusChoice === firstFocus.suggested && firstFocus.label === GUEST_FOCUS_LABEL
                ? "Picked from one guest practice run — not measured evidence, not scored, and not a retest. "
                : null}
              <label className="inline-flex items-center gap-1">
                <span>Change focus:</span>
                <select
                  value={focusChoice}
                  onChange={(event) => setFocusChoice(event.target.value)}
                  className="rounded border border-[var(--rule)] bg-surface-2 px-1 py-0.5 text-xs"
                  data-testid="first-focus-select"
                >
                  {firstFocus.options.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.headline}
                      {option.key === firstFocus.suggested ? " (from guest practice)" : ""}
                    </option>
                  ))}
                  <option value={NO_FIRST_FOCUS}>No focus for this debate</option>
                </select>
              </label>
            </span>
          </div>
        ) : (
          <div className="home-coaching-focus">
            <span className="home-coaching-label">{isFirstVisit ? "How it works" : focusLabel}</span>
            <strong>
              {isFirstVisit
                ? "Pick a side, argue three short rounds, then repair the one weakness the coach flags."
                : goalLine}
            </strong>
            {isFirstVisit ? null : (lastLine && <span className="home-coaching-lastline">{lastLine}</span>)}
          </div>
        )}

        {activeDebateId ? (
          <Link href={`/debate/${activeDebateId}`} className="home-start-button btn btn-primary px-4 py-3 text-center text-sm">
            Continue your debate <span aria-hidden="true">→</span>
          </Link>
        ) : (
          <div className="home-start-block">
            <div className="home-side-label">Your side</div>
            <div className="home-side-picker" role="group" aria-label="Choose side">
              {(["challenge", "for", "against"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setSide(option)}
                  aria-pressed={side === option}
                  className={`home-side-option ${side === option ? "selected" : ""}`}
                >
                  <span className="home-side-option-label">{sideMeta[option].label}</span>
                  <span>{sideMeta[option].sub}</span>
                </button>
              ))}
            </div>
            {side === "challenge" ? (
              challengePreview ? (
                <p
                  className="home-start-note"
                  data-testid="challenge-side-note"
                  data-challenge-side={challengePreview.side}
                  aria-live="polite"
                >
                  <strong className="text-ink" data-testid="challenge-side-preview">
                    {challengePreviewHeadline(challengePreview)}.
                  </strong>{" "}
                  {challengePreview.reason} Prefer the other side? Pick it above.
                </p>
              ) : (
                <p className="home-start-note" data-testid="challenge-side-note">
                  We pick For or Against from your recent debates, and show it when you start.
                </p>
              )
            ) : null}

            <details className="home-motion-details">
              <summary className="home-motion-details-summary">
                <span data-testid="opponent-picker-summary">
                  Opponent: {OPPONENT_PERSONA_LIST.find((p) => p.id === persona)?.label} ·{" "}
                  {OPPONENT_DIFFICULTY_LIST.find((d) => d.id === difficulty)?.label}
                </span>
                <span className="home-motion-details-chevron" aria-hidden="true">+</span>
              </summary>
              <div className="mt-3">
                <p className="mb-2 text-xs uppercase tracking-wide text-ink3">Who argues against you</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {OPPONENT_PERSONA_LIST.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPersona(p.id)}
                      aria-pressed={persona === p.id}
                      className={`rounded-xl border px-3 py-2 text-left text-sm ${persona === p.id ? "border-[var(--accent)] bg-[var(--accent-soft)] font-semibold text-[var(--accent)]" : "border-[var(--rule)] bg-surface-2 text-ink2"}`}
                      data-testid={`persona-${p.id}`}
                    >
                      {p.label}
                      <span className="mt-0.5 block text-xs font-normal leading-4 opacity-80">{p.tagline}</span>
                    </button>
                  ))}
                </div>
                <p className="mb-2 mt-4 text-xs uppercase tracking-wide text-ink3">Pressure</p>
                <div className="grid grid-cols-3 gap-2">
                  {OPPONENT_DIFFICULTY_LIST.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setDifficulty(d.id)}
                      aria-pressed={difficulty === d.id}
                      className={`rounded-xl border px-3 py-2 text-left text-sm ${difficulty === d.id ? "border-[var(--accent)] bg-[var(--accent-soft)] font-semibold text-[var(--accent)]" : "border-[var(--rule)] bg-surface-2 text-ink2"}`}
                      data-testid={`difficulty-${d.id}`}
                    >
                      {d.label}
                      {/* The description used to live only in the `title`
                          attribute, which is hover-only — unreachable by
                          keyboard and unreliable for screen readers. Personas
                          already render their tagline inline; pressure now
                          does the same, so both controls describe themselves
                          without a pointer. WCAG 1.4.13. */}
                      <span className="mt-0.5 block text-xs font-normal leading-4 opacity-80">{d.description}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-xs leading-5 text-ink3">
                  Personas change how the AI attacks; pressure changes how hard. Neither changes how you are scored.
                </p>
              </div>
            </details>

            <button
              type="button"
              onClick={() => startDebate("sprint")}
              disabled={starting !== null}
              className="home-start-button btn btn-primary px-4 py-3 text-sm disabled:opacity-40"
              data-testid="start-sprint"
            >
              {starting === "sprint" ? (
                <span className="inline-flex items-center gap-2">
                  <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-transparent" />
                  Asking today&rsquo;s opponent…
                </span>
              ) : (
                <>Daily Sprint · three rounds, ~4 min <span aria-hidden="true">→</span></>
              )}
            </button>
            {/* Other formats: real secondary buttons (bordered, name over length)
                so they read as choices. As ghost text they looked like captions
                and wrapped to four lines ("Cross- / examination · 4 / rounds…"). */}
            <p className="home-side-label mt-1">Or pick a format</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => startDebate("full")}
                disabled={starting !== null}
                className="home-format-option btn btn-secondary disabled:opacity-40"
                data-testid="start-full"
              >
                {starting === "full" ? "Asking today's opponent…" : (
                  <>
                    <span className="home-format-name">Full debate</span>
                    <span className="home-format-meta">5–12 rounds</span>
                  </>
                )}
              </button>
              {(["flash", "cross-examination", "socratic"] as const).map((format) => (
                <button
                  key={format}
                  type="button"
                  onClick={() => startDebate(format)}
                  disabled={starting !== null}
                  className="home-format-option btn btn-secondary disabled:opacity-40"
                  data-testid={`start-${format}`}
                  title={
                    format === "flash"
                      ? "One sharp ~60-second exchange"
                      : format === "cross-examination"
                        ? "The AI probes with questions and presses your answers"
                        : "The AI only asks questions — you build the whole case"
                  }
                >
                  {starting === format ? "Asking today's opponent…" : (
                    <>
                      <span className="home-format-name">{formatLabelFor(format)}</span>
                      <span className="home-format-meta">{formatEstimateLabel(format)}</span>
                    </>
                  )}
                </button>
              ))}
            </div>
            {/* Loop-latency at the commitment moment: the first rep happens in
                one shot — opening generation on the model can take seconds on
                the shared free chain. Naming the work keeps a quiet wait from
                reading as a hung click. No fresh spinner copy; this is the
                only affordance the start button gets. */}
            {starting !== null && (
              <p className="text-xs leading-4 text-ink3" role="status">
                Building your debate will take a few seconds — the AI is composing its opening argument.
              </p>
            )}
            <p className="home-start-note">
              Three focused rounds with directional feedback. Cross-examination and Socratic train probing and answer-building; Flash is one sharp exchange.
            </p>
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
                      {chips.map((chip) => <span key={chip.label} className={`rounded-full px-2 py-0.5 text-xs ${chip.ok === true ? "bg-[var(--accent-soft)] text-[var(--accent)]" : chip.ok === false ? "bg-[var(--review-soft)] text-[var(--review)]" : "bg-surface-2 text-ink3"}`}>{chip.ok === false ? "⚠ " : chip.ok === true ? "✓ " : ""}{chip.label}</span>)}
                      <a href={card.url} target="_blank" rel="noreferrer" className="ml-auto text-xs font-medium text-[var(--accent)] hover:underline">[Open source]<span className="sr-only"> (opens in a new tab)</span></a>
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
              {safeSources(topic).map((source) => {
                // Offline allowlist check: flag institutions we can't vouch for so
                // a hallucinated "source" is visible before anyone cites it.
                const known = isKnownSource(source.name);
                return (
                  <li key={source.name} className="text-sm text-ink3">
                    <a href={source.homepage} target="_blank" rel="noreferrer" className="font-medium text-ink hover:underline">
                      {known ? <span className="mr-1 text-[var(--accent)]">✓</span> : null}
                      {source.name}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                    {/* Was `text-amber-600`, which on --surface-2 in the
                        app's only (dark) theme measures ~2.6:1 — well below
                        WCAG AA. The shared --review token is specified to pass
                        against its own soft tint, so it carries the same
                        "check this" meaning without failing contrast.
                        The explanation used to be hover-only (title), which is
                        unreachable by keyboard; it is now visible. */}
                    {!known && <span className="ml-1 text-xs font-medium text-[var(--review)]">⚠ unverified</span>}
                    {!known && <span className="text-ink3"> — not in the verified-source allowlist, double-check before citing</span>}
                    <span className="text-ink3"> — {source.angle}</span>
                  </li>
                );
              })}
            </ul>
            </div>
          )}
          </div>
        </details>

        {experimentalSurfacesEnabled() && (
          <Link href="/pvp" className="home-motion-foot-link">
            Challenge another player →
          </Link>
        )}
      </div>
    </section>
  );
}
