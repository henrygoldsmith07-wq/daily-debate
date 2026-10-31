"use client";

import { guestChallengeSide } from "@/lib/guestSide";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import PageHeader from "./PageHeader";
import SidePicker, { type SideChoice } from "./SidePicker";
import WeekStreak from "./WeekStreak";
import ShareResultButton from "./ShareResultButton";
import { dailyNumber, guestRoundMark, LIVE_GUEST_MOTION_ID, sharePath, shareText as buildShareText } from "@/lib/shareCard";
import { dailyAccentStyle } from "@/lib/dailyAccent";
import { addGuestPracticeDay, GUEST_PRACTICE_DAYS_KEY, parseGuestPracticeDays, weekDays } from "@/lib/weekStreak";
import {
  assessGuestPractice,
  assessGuestRepair,
  assessGuestResponse,
  assessGuestRetest,
  type GuestRepairAssessment,
  type GuestSkill,
} from "@/lib/guestAssessment";
import { guestMotionForDay, type GuestMotion } from "@/lib/guestMotions";
import { SKILL_DIMENSIONS, SKILL_ORDER } from "@/lib/skillTaxonomy";
import ValidationStatusLine from "./ValidationStatusLine";
import type { SurfaceValidation } from "@/lib/judgeValidation";
import {
  encodeGuestArenaProgress,
  encodeGuestLoopSummary,
  GUEST_ARENA_STORAGE_KEY,
  GUEST_LOOP_STORAGE_KEY,
  parseGuestArenaProgress,
  type GuestLoopSummary,
} from "@/lib/guestLoop";
import { SPRINT_ESTIMATE_MINUTES } from "@/lib/sprint";
import { experimentalSurfacesEnabled } from "@/lib/featureFlags";
import { guestAccountBenefits } from "@/lib/guestAccountBenefits";
import { SIGN_UP_PATH } from "@/lib/authRedirect";
import ThinkingIndicator from "./ThinkingIndicator";
import { OPPONENT_PERSONA_LIST, type OpponentPersonaId } from "@/lib/opponentPersona";
import {
  buildLiveGuestMotion,
  emptyGuestLiveState,
  GUEST_LIVE_FALLBACK_OPPONENT,
  GUEST_LIVE_FALLBACK_RETEST,
  GUEST_LIVE_ROUNDS,
  guestLiveHistory,
  type GuestLiveMotion,
  type GuestLiveState,
} from "@/lib/guestLive";
import type { GuestArenaMode } from "@/lib/guestLoop";
import { readTurnResponse, TURN_STREAM_ACCEPT } from "@/lib/turnStreamClient";

// Restore this tab's in-progress guest practice, if any. Runs at initial
// render only (lazy initializer) so server HTML and the first client paint
// agree — a reload resumes in one pass, no effect-driven cascading setters.
// Stale motion day or corrupt cache degrades to defaults silently.
function restoreArena(today: string): {
  stage: Stage;
  side: "for" | "against";
  responses: string[];
  repair: { kind: GuestSkill; label: string; text: string; succeeded: boolean } | null;
  retestDemonstrated: boolean | null;
  mode: GuestArenaMode | null;
  live: GuestLiveState | null;
} {
  try {
    const parsed = parseGuestArenaProgress(window.sessionStorage.getItem(GUEST_ARENA_STORAGE_KEY));
    if (!parsed || parsed.motionDate !== today) throw new Error("stale or absent");
    return {
      stage: parsed.stage,
      side: parsed.side,
      responses: parsed.responses,
      repair: parsed.repair
        ? { kind: parsed.repair.kind as GuestSkill, label: parsed.repair.label, text: parsed.repair.text, succeeded: parsed.repair.succeeded }
        : null,
      retestDemonstrated: parsed.retestDemonstrated,
      mode: parsed.mode ?? null,
      live: parsed.live ?? null,
    };
  } catch {
    // Corrupt or stale cache degrades to a fresh home — never half-restored.
    return { stage: "home", side: "for", responses: [], repair: null, retestDemonstrated: null, mode: null, live: null };
  }
}

// The guest loop mirrors the signed-in product loop:
//   debate -> one weakness -> fix it now -> retest it -> see what moved.
//
// Two opponents, one loop:
//   * live (default when the server offers it): today's shared motion against
//     the real AI opponent, via the stateless /api/guest/turn route. Only the
//     transcript is sent, to generate the opponent's replies; nothing is stored.
//   * guided: a scripted sample case that never leaves the device. Chosen by
//     the learner ("Use a guided case instead"), or the automatic fallback
//     whenever the live opponent is unavailable, rate limited or failing.
// Feedback, the weakness, the repair and the retest check are the same
// deterministic local checks in both. Mid-practice progress sits in this tab's
// sessionStorage (a reload resumes where you left off), and the closing summary
// sits in localStorage for the signup form. The closing signup prompt appears
// only AFTER the learner has actually seen value.

type Stage = "home" | "debate" | "result" | "retest" | "done";

function Brand() {
  return (
    <Link href="/" className="home-brand-lockup" aria-label="Daily Debate home">
      <Image src="/logo.svg" alt="" width={30} height={30} className="rounded-lg" aria-hidden="true" />
      <span className="home-brand-copy">
        <span className="block text-sm font-semibold tracking-tight">Daily Debate</span>
        <span className="block text-xs uppercase tracking-[0.16em] text-ink3">Think in public</span>
      </span>
    </Link>
  );
}

// The guest's practised days, read from localStorage without a hydration
// mismatch: the server (and the first client paint) see an empty week.
function subscribeToStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}
function readGuestDays(): string | null {
  try {
    return window.localStorage.getItem(GUEST_PRACTICE_DAYS_KEY);
  } catch {
    return null;
  }
}

interface GuestHomeLive {
  /** Today's shared motion when the live opponent is on offer; null = guided only. */
  motion: GuestLiveMotion | null;
  mode: GuestArenaMode;
  persona: OpponentPersonaId;
  onPersona: (persona: OpponentPersonaId) => void;
  onMode: (mode: GuestArenaMode) => void;
  /** Why the learner is on the guided case after asking for the live one. */
  notice: string | null;
}

function GuestHome({
  motion,
  today,
  onStart,
  live,
}: {
  motion: GuestMotion;
  today: string;
  onStart: (side: "for" | "against") => void;
  live: GuestHomeLive;
}) {
  const isLive = live.mode === "live" && live.motion !== null;
  const shownTitle = isLive && live.motion ? live.motion.title : motion.motion;
  const shownTopic = isLive && live.motion ? live.motion.category?.trim() || "Today" : motion.topic;
  const personaLabel = OPPONENT_PERSONA_LIST.find((p) => p.id === live.persona)?.label ?? "Balanced";
  const [side, setSide] = useState<SideChoice>("challenge");
  const rawDays = useSyncExternalStore(subscribeToStorage, readGuestDays, () => null);
  const week = weekDays(today, parseGuestPracticeDays(rawDays));

  const resolveSide = (): "for" | "against" => (side === "challenge" ? guestChallengeSide() : side);

  return (
    <div className="app-shell app-shell-guest">
      <div className="app-main">
        <header className="app-topbar app-topbar-guest">
          <Brand />
          <Link href="/login" className="btn btn-secondary px-3 py-1.5 text-xs">
            Sign in
          </Link>
        </header>

        <main id="main" className="app-content max-w-2xl">
          <PageHeader
            eyebrow="Guest practice"
            title="Today"
            description="Pick a side and argue it out. Nothing is saved until you make an account."
            actions={<span className="pill">Guest mode</span>}
          />

          <section className="home-motion-card has-daily-accent surface-card" style={dailyAccentStyle(today)} aria-labelledby="guest-motion">
            <div className="home-motion-heading">
              <div>
                <p className="home-motion-kicker">Today&apos;s motion</p>
                <p className="home-motion-meta">
                  {shownTopic} · {GUEST_LIVE_ROUNDS} rounds · about {SPRINT_ESTIMATE_MINUTES} minutes
                </p>
              </div>
              <span className="pill border-[var(--speak)]/30 bg-[var(--speak-soft)] text-[var(--speak)]" data-testid="guest-mode-pill">
                {isLive ? "Live AI opponent" : "Guided case"}
              </span>
            </div>

            <div className="home-motion-body">
              <div>
                <h2 id="guest-motion" className="home-motion-title">{shownTitle}</h2>
                <p className="home-motion-prompt">
                  {isLive
                    ? "Everyone gets this motion today. An AI opponent argues the other side and answers what you actually write."
                    : "You will get a guided sample opposing case, a clear round goal, and feedback that reacts to what you actually write."}
                </p>
              </div>

              {live.notice ? (
                <p className="home-start-note" role="status" data-testid="guest-live-notice">
                  {live.notice}
                </p>
              ) : null}

              <div className="home-coaching-focus">
                <span className="home-coaching-label">Today&apos;s coaching focus</span>
                <strong>{isLive ? "Answer what the opponent actually said." : motion.coachingFocus}</strong>
              </div>

              {isLive ? (
                <details className="home-motion-details">
                  <summary className="home-motion-details-summary">
                    <span data-testid="guest-opponent-summary">Opponent: {personaLabel}</span>
                    <span className="home-motion-details-chevron" aria-hidden="true">+</span>
                  </summary>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {OPPONENT_PERSONA_LIST.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => live.onPersona(p.id)}
                        aria-pressed={live.persona === p.id}
                        className={`rounded-xl border px-3 py-2 text-left text-sm ${live.persona === p.id ? "border-[var(--accent)] bg-[var(--accent-soft)] font-semibold text-[var(--accent)]" : "border-[var(--rule)] bg-surface-2 text-ink2"}`}
                        data-testid={`guest-persona-${p.id}`}
                      >
                        {p.label}
                        <span className="mt-0.5 block text-xs font-normal leading-4 opacity-80">{p.tagline}</span>
                      </button>
                    ))}
                  </div>
                </details>
              ) : null}

              <div className="home-start-block">
                <div className="home-side-label">Your side</div>
                <SidePicker side={side} onChange={setSide} ariaLabel="Choose a side" />
                {side === "challenge" ? (
                  <p className="home-start-note" data-testid="guest-challenge-side">
                    Today&apos;s pick for you: <strong>{guestChallengeSide() === "for" ? "For" : "Against"}</strong>.
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={() => onStart(resolveSide())}
                  className="home-start-button btn btn-primary px-4 py-3 text-sm"
                >
                  Start a free practice <span aria-hidden="true">→</span>
                </button>
                <p className="home-start-note">
                  {isLive
                    ? "No download, no card. Ends with one weakness, one repair, and a retest. Your answers go to a free-tier AI provider, which may log them, only to write the opponent's replies. We store nothing you write."
                    : "No download, no card. Ends with one weakness, one repair, and a retest. Your guest practice stays on this device."}
                </p>
                {live.motion ? (
                  <button
                    type="button"
                    onClick={() => live.onMode(isLive ? "guided" : "live")}
                    className="home-start-note text-left underline underline-offset-2"
                    data-testid="guest-mode-switch"
                  >
                    {isLive
                      ? "Use a guided case instead — nothing leaves this device"
                      : "Debate the live AI opponent on today's motion instead"}
                  </button>
                ) : null}
              </div>
            </div>
          </section>

          {/* Below the motion, not above it: the first screen is the motion and
              Start; a first-time visitor's week row is empty anyway. */}
          <WeekStreak days={week} note="kept on this device" />

          <section aria-labelledby="guest-skills">
            <div className="section-heading">
              <h2 id="guest-skills">What this practice measures</h2>
            </div>
            <p className="mt-1 max-w-none text-ink2">
              The full product coaches seven reasoning skills, listed below. Guest practice is a quick local
              check of five of the moves behind them (a clear claim, a reason, answering the opponent, comparing
              impact, and naming evidence). It shows you one thing you did well and one thing to fix — never a
              metric number or a rating.
            </p>
            <ol className="mt-4 grid gap-3 sm:grid-cols-2">
              {SKILL_ORDER.map((k) => (
                <li key={k} className="surface-card p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink3">
                    {SKILL_DIMENSIONS[k].label}
                  </p>
                  <p className="mt-1 text-sm text-ink2">{SKILL_DIMENSIONS[k].skill}</p>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="guest-loop">
            <div className="section-heading">
              <h2 id="guest-loop">What you will do</h2>
            </div>
            <ol className="home-secondary-grid">
              {[
                isLive
                  ? { step: "1", kicker: "Debate", title: "Three rounds against an AI opponent", copy: "Each round, answer what the opponent actually said instead of just adding another point. Your answers are used only to write its replies; we do not store them." }
                  : { step: "1", kicker: "Debate", title: "Three rounds against a guided case", copy: "Each round, answer what the opponent actually said instead of just adding another point. The opponent is scripted in this mode, so nothing you write leaves your device." },
                { step: "2", kicker: "Fix", title: "One weakness, repaired immediately", copy: "You see the missing move, why it matters, and rewrite it yourself." },
                { step: "3", kicker: "Retest", title: "See whether it moved", copy: "You argue again and we check whether the repair held under debate conditions." },
              ].map((item) => (
                <li key={item.step} className="home-secondary-card">
                  <p className="home-secondary-kicker">
                    <span aria-hidden="true">Step {item.step} · </span>
                    {item.kicker}
                  </p>
                  <h3>{item.title}</h3>
                  <p>{item.copy}</p>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="guest-account">
            <div className="section-heading">
              <h2 id="guest-account">With an account</h2>
              <span className="section-heading-note">Free</span>
            </div>
            <div className="home-secondary-grid">
              {guestAccountBenefits(experimentalSurfacesEnabled()).map((item) => (
                <article key={item.title} className="home-secondary-card">
                  <p className="home-secondary-kicker">{item.kicker}</p>
                  <h3>{item.title}</h3>
                  <p>{item.copy}</p>
                </article>
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

interface GuestOpponentPending {
  /** Round index being generated; GUEST_LIVE_ROUNDS = the retest challenge. */
  index: number;
  text: string;
  status: "loading" | "error";
  message?: string;
}

interface GuestDebateLive {
  pending: GuestOpponentPending | null;
  personaLabel: string;
  onRetry: (index: number) => void;
  onGuided: (index: number) => void;
}

function GuestDebate({
  motion,
  side,
  rounds,
  onRoundSubmit,
  onFinish,
  initialRound,
  live,
  notice,
}: {
  motion: GuestMotion;
  side: "for" | "against";
  rounds: GuestMotion["rounds"];
  onRoundSubmit: (roundIndex: number, response: string) => void;
  onFinish: () => void;
  /** Resume a reloaded tab at the first unanswered round (completed rounds are kept). */
  initialRound?: number;
  /** Live opponent state; absent for the guided case, whose rounds are all scripted. */
  live?: GuestDebateLive;
  /** One line explaining a switch to the guided case mid-flow. */
  notice?: string | null;
}) {
  const [round, setRound] = useState(() => Math.min(Math.max(initialRound ?? 0, 0), rounds.length - 1));
  const [response, setResponse] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const activeRound = rounds[round];
  const pendingHere = live?.pending && live.pending.index === round ? live.pending : null;
  // The opponent's move is ready once its text has been committed; until then
  // a live round shows the reply as it streams in, and the composer waits.
  const opponentReady = activeRound.opponent.trim().length > 0;
  const opponentText = opponentReady ? activeRound.opponent : pendingHere?.text ?? "";
  const opponentFailed = !opponentReady && pendingHere?.status === "error";
  const assessment = submitted ? assessGuestResponse(response, activeRound.opponent, round) : null;

  function submit() {
    if (!opponentReady || response.trim().length < 12) return;
    onRoundSubmit(round, response.trim());
    setSubmitted(true);
  }

  function next() {
    if (round === rounds.length - 1) {
      onFinish();
      return;
    }
    setRound((current) => current + 1);
    setResponse("");
    setSubmitted(false);
  }

  return (
    <div className="app-shell app-shell-guest">
      <div className="app-main">
        <header className="app-topbar app-topbar-guest">
          <Brand />
          <div className="flex items-center gap-3 text-xs text-ink3">
            <span className="hidden sm:inline">Practice mode</span>
            <span className="pill">Guest rep</span>
          </div>
        </header>
        <main id="main" className="app-content max-w-5xl lg:grid lg:grid-cols-[1fr_280px] lg:items-start lg:gap-6">
          <section className="min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--speak)]">Today&apos;s motion</p>
                <h1 className="page-title mt-2">{motion.motion}</h1>
              </div>
              <span className="pill">{side === "for" ? "You: make the case" : "You: push back"}</span>
            </div>
            <div className="mt-6 flex items-center gap-2" aria-label={`Round ${round + 1} of ${rounds.length}`}>
              {rounds.map((item, index) => (
                <div
                  key={item.label}
                  className={`h-1.5 flex-1 rounded-full ${index <= round ? "bg-[var(--speak)]" : "bg-[var(--line)]"}`}
                />
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-ink3">
              <span>Round {round + 1} of {rounds.length} · {activeRound.label}</span>
              {/* No fabricated countdown: guest practice is untimed and free.
                  Showing "~2 min left" next to a round that never expires
                  invents urgency the flow does not have. */}
              <span>{round + 1 === rounds.length ? "Final round" : "Take your time"}</span>
            </div>
            {notice ? (
              <p className="mt-3 text-xs leading-5 text-ink3" role="status" data-testid="guest-live-notice">
                {notice}
              </p>
            ) : null}

            <div className="mt-6 space-y-4">
              <div className="flex gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--surface-2)] text-xs font-semibold text-ink3">AI</div>
                <div
                  className="max-w-2xl rounded-2xl rounded-tl-sm border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm leading-6 text-ink2"
                  data-testid="guest-opponent"
                  aria-live="polite"
                  aria-busy={!opponentReady}
                >
                  <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-ink3">
                    {live ? `Opponent · ${live.personaLabel}` : "Opponent"}
                  </p>
                  {opponentText}
                  {!opponentReady && !opponentFailed ? <ThinkingIndicator label={opponentText ? "Still writing" : "Opponent is thinking"} /> : null}
                </div>
              </div>
              {opponentFailed && live ? (
                <div className="surface-card p-4" role="alert" data-testid="guest-opponent-error">
                  <p className="text-sm font-semibold">The opponent couldn&apos;t answer.</p>
                  <p className="mt-1 text-sm text-ink2">{pendingHere?.message ?? "Try again, or carry on with a guided challenge."}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => live.onRetry(round)} className="btn btn-primary px-4 py-2 text-sm">
                      Try again
                    </button>
                    <button type="button" onClick={() => live.onGuided(round)} className="btn btn-secondary px-4 py-2 text-sm">
                      Carry on with a guided challenge
                    </button>
                  </div>
                </div>
              ) : null}
              {submitted && (
                <div className="ml-auto flex max-w-2xl justify-end gap-3">
                  <div className="rounded-2xl rounded-tr-sm bg-[var(--speak)] px-4 py-3 text-sm leading-6 text-[var(--on-speak)]">
                    {response}
                  </div>
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--speak-soft)] text-xs font-semibold text-[var(--speak)]">YOU</div>
                </div>
              )}
            </div>

            {!submitted ? (
              <div className="surface-card mt-6 p-4 sm:p-5">
                <label htmlFor="guest-response" className="text-xs font-semibold uppercase tracking-[0.14em] text-ink3">Your response</label>
                <p className="mt-2 text-sm text-ink2">{activeRound.prompt}</p>
                <textarea
                  id="guest-response"
                  disabled={!opponentReady}
                  value={response}
                  onChange={(event) => setResponse(event.target.value)}
                  placeholder="Write 2-4 sentences..."
                  rows={5}
                  aria-describedby="guest-response-count"
                  maxLength={4000}
                  className="field mt-4 resize-none text-sm leading-6"
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <span id="guest-response-count" className="text-xs text-ink3">{response.trim().length}/12 minimum characters</span>
                  <button type="button" onClick={submit} disabled={!opponentReady || response.trim().length < 12} className="btn btn-primary px-4 py-2 text-sm">
                    Send response <span aria-hidden="true">→</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="surface-raised mt-6 p-4 sm:p-5" aria-live="polite" data-testid="guest-round-feedback">
                <div className="flex items-start gap-3">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--success-soft)] text-sm text-[var(--success)]">✓</div>
                  <div>
                    <p className="text-sm font-semibold">Round reviewed</p>
                    <p className="mt-1 text-sm leading-6 text-ink2">{assessment?.strength}</p>
                    <p className="mt-2 text-sm leading-6 text-ink2">
                      <span className="font-semibold text-ink">Next move:</span> {assessment?.nextMove}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {assessment?.chips.map((chip) => (
                    <span
                      key={chip.label}
                      className={chip.observed
                        ? "pill border-[var(--success)]/30 bg-[var(--success-soft)] text-[var(--success)]"
                        : "pill border-[var(--review)]/30 bg-[var(--review-soft)] text-[var(--review)]"}
                    >
                      {chip.label} · {chip.observed ? "observed" : "not yet"}
                    </span>
                  ))}
                </div>
                <p className="mt-3 text-xs leading-5 text-ink3">
                  This is a local text check of observable features, not a debate score.
                </p>
                <button type="button" onClick={next} className="btn btn-primary mt-5 w-full px-4 py-3 text-sm">
                  {round === rounds.length - 1 ? "See my result" : "Take the next round"} <span aria-hidden="true">→</span>
                </button>
              </div>
            )}
          </section>

          <aside className="mt-6 space-y-4 lg:mt-0">
            <div className="surface-card p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink3">Round goal</p>
              <p className="mt-2 text-sm font-semibold">{activeRound.label}</p>
              <p className="mt-2 text-sm leading-6 text-ink3">{activeRound.prompt}</p>
            </div>
            <div className="surface-card p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink3">Coach lens</p>
              <div className="mt-3 space-y-3">
                {[
                  ["Claim", "Make one point"],
                  ["Reasoning", "Show why it follows"],
                  ["Opponent", "Answer their actual case"],
                ].map(([label, detail]) => (
                  <div key={label} className="flex gap-2 text-xs">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--speak)]" />
                    <span>
                      <span className="font-semibold text-ink">{label}</span>
                      <span className="ml-1 text-ink3">{detail}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <p className="px-1 text-xs leading-5 text-ink3">
              Guest feedback only checks what is visible in your wording{live ? "; the AI only writes the opponent's replies" : ""}. An account saves your debates and keeps coaching you on the same weakness over time.
            </p>
          </aside>
        </main>
      </div>
    </div>
  );
}

function GuestResult({
  motion,
  side,
  responses,
  repairSucceeded,
  acceptedRepairText,
  validation,
  onRepairSucceeded,
  onRetest,
  onSignUp,
  onRestart,
}: {
  motion: GuestMotion;
  side: "for" | "against";
  responses: string[];
  repairSucceeded: boolean;
  /**
   * The rewrite already accepted for this practice, if any. Coming back from
   * the retest ("Back to my result", or a reload) must show that accepted
   * repair again, not an empty box beside a "Now prove it" button.
   */
  acceptedRepairText?: string | null;
  /** Live judge-output validation for this surface, from the report the page loaded. */
  validation?: SurfaceValidation | null;
  /** Called with the accepted rewrite so the retest checks the same move. */
  onRepairSucceeded: (kind: GuestSkill, label: string, text: string, succeeded: boolean) => void;
  /** Move to the deliberate retest. Only offered once a repair succeeded. */
  onRetest: () => void;
  /** Called when the guest follows a sign-up link before taking the retest. */
  onSignUp?: () => void;
  onRestart: () => void;
}) {
  const rounds = motion.rounds;
  const assessment = assessGuestPractice(responses, rounds.map((round) => round.opponent));
  const sourceRound = rounds[assessment.sourceResponseIndex];
  const [repair, setRepair] = useState(() => acceptedRepairText ?? "");
  // Re-running the same deterministic check restores the same feedback the
  // learner saw when the repair was accepted.
  const [repairAssessment, setRepairAssessment] = useState<GuestRepairAssessment | null>(() =>
    acceptedRepairText
      ? assessGuestRepair(assessment.weakness.kind, acceptedRepairText, sourceRound?.opponent ?? "")
      : null,
  );

  function submitRepair() {
    if (repair.trim().length < 12) return;
    const outcome = assessGuestRepair(assessment.weakness.kind, repair.trim(), sourceRound?.opponent ?? "");
    setRepairAssessment(outcome);
    if (outcome.succeeded) {
      // The accepted rewrite is handed to the retest so it checks the SAME move
      // that was just repaired, not a fresh guess at what was weak.
      onRepairSucceeded(assessment.weakness.kind, assessment.weakness.label, repair.trim(), outcome.succeeded);
    }
  }

  const observations = [
    ["Clear claim", assessment.counts.claim],
    ["Reasoning link", assessment.counts.reasoning],
    ["Opponent addressed", assessment.counts.rebuttal],
    ["Impact compared", assessment.counts.impact],
    ["Named evidence", assessment.counts.evidence],
  ] as const;
  // The headline counts kinds of move that showed up at least once — the same
  // observations listed below, summed, never a score or a rating.
  const movesFound = observations.filter(([, count]) => count > 0).length;
  // Wordle-style: day number (only for today's shared motion), side, one
  // square per round, repair state. No words from the learner's writing.
  const shareCard = {
    ...(motion.id === LIVE_GUEST_MOTION_ID ? { dayNumber: dailyNumber(new Date().toISOString()) } : {}),
    side,
    marks: responses.map((response, index) => {
      const chips = assessGuestResponse(response, rounds[index]?.opponent ?? "", index).chips;
      const seen = (label: string) => chips.some((chip) => chip.label === label && chip.observed);
      return guestRoundMark({ opponent: seen("Opponent"), claim: seen("Claim"), reasoning: seen("Reasoning") });
    }),
    repaired: repairSucceeded || repairAssessment?.succeeded === true,
  };

  return (
    <div className="app-shell app-shell-guest">
      <div className="app-main">
        <header className="app-topbar app-topbar-guest">
          <Brand />
          <Link href="/login" className="btn btn-secondary px-3 py-1.5 text-xs">
            Sign in
          </Link>
        </header>
        <main id="main" className="app-content max-w-2xl">
          <PageHeader
            eyebrow="Rep complete"
            title="Your practice result"
            description="One thing you did well, one thing to fix, then a quick rewrite to fix it."
            actions={<span className="pill">Guest preview</span>}
          />

          <section className="surface-card result-headline p-5 sm:p-6" aria-labelledby="guest-headline" data-testid="guest-headline">
            <p id="guest-headline" className="result-headline-number">
              {movesFound}<span>/{observations.length}</span>
            </p>
            <p className="result-headline-caption">debate moves showed up in your writing</p>
            <ul className="result-headline-moves" aria-label="Moves observed">
              {observations.map(([label, count]) => (
                <li key={label} className={`result-headline-move${count > 0 ? " is-found" : ""}`}>
                  {count > 0 ? "✓ " : ""}{label}
                </li>
              ))}
            </ul>
            <div className="mt-3">
              <ShareResultButton title="Daily Debate" text={buildShareText(shareCard)} path={sharePath(shareCard)} />
            </div>
          </section>

          <section className="surface-card p-5 sm:p-6" data-testid="guest-result">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink3">Observed in your writing</p>
            <ValidationStatusLine validation={validation} testId="guest-validation-state" />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {observations.map(([label, count]) => (
                <div key={label} className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3">
                  <p className="text-xs text-ink3">{label}</p>
                  <p className="mt-1 text-sm font-semibold">
                    {count} of {responses.length} responses
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs leading-5 text-ink3">{assessment.note}</p>
          </section>

          <section className="surface-card p-5 sm:p-6" aria-labelledby="guest-strength-heading">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--success)]">You did well</p>
            <h2 id="guest-strength-heading" className="mt-1 text-lg font-semibold">One concrete strength</h2>
            <p className="mt-2 text-sm leading-6 text-ink2">{assessment.strength}</p>
          </section>

          <section className="surface-card p-5 sm:p-6" aria-labelledby="guest-weakness-heading" data-testid="guest-main-weakness">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--review)]">Main weakness</p>
            <h2 id="guest-weakness-heading" className="mt-1 text-lg font-semibold">{assessment.weakness.label}</h2>
            <p className="mt-2 text-sm leading-6 text-ink2">{assessment.weakness.why}</p>
            {assessment.sourceResponse && (
              <div className="mt-4 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink3">
                  Original move · round {assessment.sourceResponseIndex + 1}
                </p>
                <p className="mt-2 text-sm leading-6 text-ink2">{assessment.sourceResponse}</p>
              </div>
            )}
          </section>

          <section className="surface-raised p-5 sm:p-6" aria-labelledby="guest-repair-heading" data-testid="guest-repair">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--speak)]">Fix this now</p>
            <h2 id="guest-repair-heading" className="mt-1 text-lg font-semibold">Repair the missing move</h2>
            <p className="mt-2 text-sm leading-6 text-ink2">{assessment.weakness.repairPrompt}</p>

            {repairAssessment?.succeeded ? (
              <div
                className="mt-4 rounded-lg border border-[var(--success)]/30 bg-[var(--success-soft)] p-3 text-sm leading-6 text-[var(--success)]"
                aria-live="polite"
                data-testid="guest-repair-feedback"
              >
                {repairAssessment.feedback}
              </div>
            ) : (
              <>
                <label htmlFor="guest-repair-response" className="mt-4 block text-xs font-semibold uppercase tracking-[0.14em] text-ink3">
                  Your improved version
                </label>
                <textarea
                  id="guest-repair-response"
                  aria-describedby="guest-repair-count"
                  value={repair}
                  onChange={(event) => {
                    setRepair(event.target.value);
                    setRepairAssessment(null);
                  }}
                  rows={4}
                  placeholder="Rewrite the move here..."
                  maxLength={4000}
                  className="field mt-2 resize-none text-sm leading-6"
                />
                <p id="guest-repair-count" aria-live="polite" className="mt-1 text-xs text-ink3">
                  {repair.trim().length >= 12 ? "Ready to submit." : `${repair.trim().length}/12 minimum characters`}
                </p>
                <button
                  type="button"
                  onClick={submitRepair}
                  disabled={repair.trim().length < 12}
                  className="btn btn-primary mt-3 w-full px-4 py-3 text-sm"
                >
                  Check my repair <span aria-hidden="true">→</span>
                </button>
                {repairAssessment && (
                  <div
                    className="mt-4 rounded-lg border border-[var(--review)]/30 bg-[var(--review-soft)] p-3 text-sm leading-6 text-[var(--review)]"
                    aria-live="polite"
                    data-testid="guest-repair-feedback"
                  >
                    {repairAssessment.feedback}
                  </div>
                )}
              </>
            )}
          </section>

          {/* The loop is only complete once the repair is deliberately retested.

              DELIBERATE, DOCUMENTED EXCEPTION to the disclosure policy
              (retestDisclosure.ts). The guest arena is a guided DEMONSTRATION
              of the loop, not a measurement, so it is deliberately not covered:

              - the retest happens in the same session, immediately, on the same
                device — there is no delayed, un-cued opportunity to protect;
              - its verdict comes from a local heuristic over the learner's own
                text (`assessGuestRetest`), not from the server's canonical
                detector, and it never touches the learner's skill ledger;
              - the copy already says what it is: "One observed instance. It is
                not a validated measure of ability - that needs repeated
                measurement, which an account provides."

              Hiding the skill here would make the demo incoherent without
              protecting a measurement that does not exist. The account path —
              the one that IS measured — is fully covered by the policy. */}
          {repairSucceeded ? (
            <section className="surface-card flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between" aria-labelledby="guest-retest-cta" data-testid="guest-retest-cta">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--speak)]">Last step</p>
                <h2 id="guest-retest-cta" className="mt-1 text-base font-semibold">Now prove it in a fresh debate</h2>
                <p className="mt-1 text-sm leading-6 text-ink3">
                  Argue one more round and we will check whether the repaired move actually shows up under debate conditions.
                </p>
              </div>
              <button type="button" onClick={onRetest} className="btn btn-primary shrink-0 px-4 py-2 text-sm">
                Retest this skill →
              </button>
            </section>
          ) : (
            <p className="text-sm text-ink3">
              Repair the move above first - then you can retest it and see whether it held.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={onRestart} className="btn btn-secondary px-4 py-3 text-sm">
              Start again
            </button>
            <Link href={SIGN_UP_PATH} onClick={onSignUp} className="btn btn-primary px-4 py-3 text-center text-sm">
              Create a free account
            </Link>
          </div>
          <p className="text-center text-xs leading-5 text-ink3">
            Guest mode is one practice on one device. An account keeps the weakness, repair and later retest connected so progress is measured over time instead of guessed from a single rep.
          </p>
        </main>
      </div>
    </div>
  );
}

function GuestRetest({
  motion,
  weaknessKind,
  weaknessLabel,
  repairText,
  repairSucceeded: repairSucceededFlag,
  onFinish,
  onBack,
}: {
  motion: GuestMotion;
  weaknessKind: GuestSkill;
  weaknessLabel: string;
  repairText: string;
  /** The real outcome of the repair drill, not a guess from its length. */
  repairSucceeded: boolean;
  /** Finish the retest, reporting whether the repaired behaviour was observed. */
  onFinish: (demonstrated: boolean) => void;
  /** Go back to the result screen without answering the retest. */
  onBack: () => void;
}) {
  // A genuinely NEW challenge, not the round-3 pressure the learner has already
  // answered. Re-serving a seen prompt measures recall; an unseen one that
  // requires the same move is the only honest observation of transfer.
  const retestRound = motion.retest;
  const [response, setResponse] = useState("");
  const [submitted, setSubmitted] = useState(false);

  // The retest reads the REAL repair outcome. Guessing from the rewrite's
  // length would let a failed repair slide into "nothing to retest yet", and a
  // merely long repair into a demonstration it never earned.
  const repairSucceeded = repairText.trim().length >= 12 && repairSucceededFlag;
  const outcome = submitted
    ? assessGuestRetest(weaknessKind, repairSucceeded, response.trim(), retestRound.opponent)
    : null;

  return (
    <div className="app-shell app-shell-guest">
      <div className="app-main">
        <header className="app-topbar app-topbar-guest">
          <Brand />
          <div className="flex items-center gap-3 text-xs text-ink3">
            <span className="pill">Retest</span>
          </div>
        </header>
        <main id="main" className="app-content max-w-2xl">
          <PageHeader
            eyebrow="Deliberate retest"
            title="Now argue it again"
            description={`You repaired your ${weaknessLabel.toLowerCase()} move. Show it under real debate conditions.`}
            actions={<span className="pill">Guest retest</span>}
          />

          <section className="surface-card p-5 sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink3">The pressure round</p>
            <h2 className="mt-1 text-lg font-semibold">{motion.motion}</h2>
            <div className="mt-4 flex gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--surface-2)] text-xs font-semibold text-ink3">AI</div>
              <div className="max-w-2xl rounded-2xl rounded-tl-sm border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm leading-6 text-ink2">
                <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-ink3">Opponent</p>
                {retestRound.opponent}
              </div>
            </div>
            <p className="mt-4 text-sm text-ink2">{retestRound.prompt}</p>

            {!submitted ? (
              <>
                <label htmlFor="guest-retest-response" className="mt-4 block text-xs font-semibold uppercase tracking-[0.14em] text-ink3">
                  Your response
                </label>
                <textarea
                  id="guest-retest-response"
                  aria-describedby="guest-retest-count"
                  value={response}
                  onChange={(event) => setResponse(event.target.value)}
                  placeholder="Write 2-4 sentences..."
                  rows={5}
                  maxLength={4000}
                  className="field mt-2 resize-none text-sm leading-6"
                />
                <p id="guest-retest-count" aria-live="polite" className="mt-1 text-xs text-ink3">
                  {response.trim().length >= 12 ? "Ready to submit." : `${response.trim().length}/12 minimum characters`}
                </p>
                <button
                  type="button"
                  onClick={() => setSubmitted(true)}
                  disabled={response.trim().length < 12}
                  className="btn btn-primary mt-3 w-full px-4 py-3 text-sm"
                >
                  Send it <span aria-hidden="true">→</span>
                </button>
              </>
            ) : (
              <div
                className={`mt-4 rounded-lg border p-4 ${outcome?.demonstrated
                  ? "border-[var(--success)]/30 bg-[var(--success-soft)]"
                  : "border-[var(--review)]/30 bg-[var(--review-soft)]"}`}
                aria-live="polite"
                data-testid="guest-retest-outcome"
              >
                <p className="text-sm font-semibold">
                  {outcome?.demonstrated ? "Observed under pressure" : "Not observed this round"}
                </p>
                <p className="mt-1 text-sm leading-6 text-ink2">{outcome?.headline}</p>
                <p className="mt-2 text-sm leading-6 text-ink2">{outcome?.detail}</p>
                <p className="mt-3 text-xs leading-5 text-ink3">
                  Guest retest is one observed instance. It is not a validated measure of ability - that needs repeated measurement, which an account provides.
                </p>
              </div>
            )}
          </section>

          <div className="grid gap-3 sm:grid-cols-2">
            {/* Finishing is only offered once the retest has an answer. Before
                that, "Finish" used to record an unanswered retest as "Not
                observed under pressure" — a verdict on writing that was never
                submitted, carried into the done screen and the signup summary. */}
            {submitted ? (
              <button
                type="button"
                onClick={() => onFinish(outcome?.demonstrated === true)}
                className="btn btn-secondary px-4 py-3 text-sm"
              >
                Finish guest practice
              </button>
            ) : (
              <button type="button" onClick={onBack} className="btn btn-secondary px-4 py-3 text-sm">
                Back to my result
              </button>
            )}
            <Link href={SIGN_UP_PATH} className="btn btn-primary px-4 py-3 text-center text-sm">
              Create a free account
            </Link>
          </div>
          <p className="text-center text-xs leading-5 text-ink3">
            An account measures the same move across many debates, with explicit sample sizes - so progress is observed rather than guessed from one rep.
          </p>
        </main>
      </div>
    </div>
  );
}

function GuestDone({
  weaknessLabel,
  repairSucceeded,
  demonstrated,
  onRestart,
}: {
  weaknessLabel: string;
  repairSucceeded: boolean;
  demonstrated: boolean;
  onRestart: () => void;
}) {
  return (
    <div className="app-shell app-shell-guest">
      <div className="app-main">
        <header className="app-topbar app-topbar-guest">
          <Brand />
          <div className="flex items-center gap-3 text-xs text-ink3">
            <span className="pill">Rep complete</span>
          </div>
        </header>
        <main id="main" className="app-content max-w-2xl">
          <PageHeader
            eyebrow="Practice complete"
            title="One rep, fully closed"
            description="Debate, repair, retest — your practice was saved on this device."
            actions={<span className="pill">Guest mode</span>}
          />

          <section className="surface-card p-5 sm:p-6" aria-labelledby="guest-done-outcome" data-testid="guest-done">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink3">What happened</p>
            <h2 id="guest-done-outcome" className="mt-1 text-lg font-semibold">
              {demonstrated ? "Observed under pressure" : "Not observed this round"}
            </h2>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-ink2">
              <li>
                <span className="font-semibold text-ink">Weakness:</span> {weaknessLabel}.
              </li>
              <li>
                <span className="font-semibold text-ink">Repair drill:</span>{" "}
                {repairSucceeded ? "demonstrated." : "attempted — worth another pass."}
              </li>
              <li>
                <span className="font-semibold text-ink">Retest:</span>{" "}
                {demonstrated
                  ? "the repaired move showed up under debate conditions — one observed instance, not a measure of ability."
                  : "the move did not reappear under pressure. The repair itself still stands as completed practice."}
              </li>
            </ul>
            <p className="mt-3 text-xs leading-5 text-ink3">
              Guest practice reports single observed instances. Repeated measurement — the thing that turns a rep
              into evidence of ability — needs an account.
            </p>
          </section>

          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={onRestart} className="btn btn-secondary px-4 py-3 text-sm">
              Practice again
            </button>
            <Link href={SIGN_UP_PATH} className="btn btn-primary px-4 py-3 text-center text-sm">
              Create a free account
            </Link>
          </div>
          <p className="text-center text-xs leading-5 text-ink3">
            An account carries this rep over and measures the same move across many debates, with explicit sample
            sizes — so progress is observed rather than guessed from one rep.
          </p>
        </main>
      </div>
    </div>
  );
}

const LIVE_UNAVAILABLE_NOTICE =
  "The live opponent isn't available right now, so this practice uses a guided case on a sample motion. Nothing you write leaves this device.";

export default function GuestArena({
  validation = null,
  live: liveMotion = null,
}: {
  /** Live judge-output validation for the guest surface, from the report the page loaded. */
  validation?: SurfaceValidation | null;
  /** Today's shared motion when the server offers the live AI opponent to guests. */
  live?: GuestLiveMotion | null;
} = {}) {
  // Read the motion day before restoring state: the cache is invalidated per
  // motion day, so the day must be resolved first.
  const today = new Date().toISOString().slice(0, 10);
  const guidedMotion = guestMotionForDay(today);
  const restored = restoreArena(today);

  const [stage, setStage] = useState<Stage>(() => restored.stage);
  const [side, setSide] = useState<"for" | "against">(() => restored.side);
  const [responses, setResponses] = useState<string[]>(() => restored.responses);
  const [repair, setRepair] = useState<{ kind: GuestSkill; label: string; text: string; succeeded: boolean } | null>(() => restored.repair);
  const [retestDemonstrated, setRetestDemonstrated] = useState<boolean | null>(() => restored.retestDemonstrated);
  // Live is the default whenever the server offers it. A restored sprint keeps
  // its own mode (and transcript); a restored home re-reads today's offer.
  const [mode, setMode] = useState<GuestArenaMode>(() => {
    if (restored.stage !== "home" && restored.mode === "live" && restored.live) return "live";
    if (restored.stage !== "home") return "guided";
    if (!liveMotion) return "guided";
    return restored.mode ?? "live";
  });
  const [liveState, setLiveState] = useState<GuestLiveState | null>(() => {
    if (restored.stage !== "home" && restored.live) return restored.live;
    return liveMotion ? emptyGuestLiveState(liveMotion, restored.live?.persona) : null;
  });
  const [pending, setPending] = useState<GuestOpponentPending | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // One request per opponent slot at a time, even when an effect runs twice.
  const inflight = useRef<number | null>(null);

  const isLive = mode === "live" && liveState !== null;
  const motion = isLive && liveState ? buildLiveGuestMotion(liveState) : guidedMotion;

  // Persist every transition. Best effort like the signup carry-through:
  // private browsing may deny storage; the flow still finishes.
  useEffect(() => {
    try {
      window.sessionStorage.setItem(
        GUEST_ARENA_STORAGE_KEY,
        encodeGuestArenaProgress({
          version: 1,
          motionDate: today,
          stage,
          side,
          responses,
          repair,
          retestDemonstrated,
          mode,
          ...(isLive && liveState ? { live: liveState } : {}),
        }),
      );
    } catch {
      // Storage unavailable — nothing cached, nothing broken.
    }
  }, [today, stage, side, responses, repair, retestDemonstrated, mode, isLive, liveState]);

  function commitOpponent(index: number, text: string) {
    setLiveState((current) => {
      if (!current) return current;
      if (index >= GUEST_LIVE_ROUNDS) {
        // The retest challenge freezes once the learner has seen one.
        return current.retest === null ? { ...current, retest: text } : current;
      }
      if (current.opponents[index]) return current;
      const opponents = [...current.opponents];
      opponents[index] = text;
      return { ...current, opponents };
    });
  }

  function fallBackToGuided(message: string) {
    setMode("guided");
    setResponses([]);
    setNotice(message);
  }

  async function requestOpponent(index: number) {
    if (!liveState || inflight.current === index) return;
    inflight.current = index;
    setPending({ index, text: "", status: "loading" });
    const history = guestLiveHistory(liveState.opponents, responses, index - 1);
    try {
      const res = await fetch("/api/guest/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: index === 0 ? "application/json" : TURN_STREAM_ACCEPT },
        body: JSON.stringify({ side, persona: liveState.persona, history }),
      });
      const outcome = await readTurnResponse(res, {
        onDelta: (text) => setPending((current) => (current && current.index === index ? { ...current, text: current.text + text } : current)),
        onReset: () => setPending((current) => (current && current.index === index ? { ...current, text: "" } : current)),
      });
      const aiMessage = outcome?.body.aiMessage;
      if (!outcome || outcome.status >= 400 || typeof aiMessage !== "string" || !aiMessage.trim()) {
        const message = typeof outcome?.body.error === "string" ? outcome.body.error : undefined;
        throw Object.assign(new Error(message ?? "no reply"), { userMessage: message });
      }
      commitOpponent(index, aiMessage.trim());
      setPending(null);
    } catch (error) {
      const message = (error as { userMessage?: string }).userMessage;
      if (index === 0) {
        // Nothing has been written yet: switch the whole practice to the
        // guided case rather than make the learner wait on a dead opponent.
        setPending(null);
        fallBackToGuided(LIVE_UNAVAILABLE_NOTICE);
      } else if (index >= GUEST_LIVE_ROUNDS) {
        // The retest challenge is not worth a visible failure: use the
        // motion-independent one.
        setPending(null);
        commitOpponent(index, GUEST_LIVE_FALLBACK_RETEST);
      } else {
        setPending({ index, text: "", status: "error", message });
      }
    } finally {
      inflight.current = null;
    }
  }

  // The live sprint asks for exactly the opponent move it is missing: the
  // opening, the reply to the latest answer, or (after the third answer) the
  // retest's fresh challenge. Also resumes a reloaded tab.
  useEffect(() => {
    if (!isLive || !liveState || pending || inflight.current !== null) return;
    if (stage !== "debate" && stage !== "result") return;
    const next = Math.min(responses.length, GUEST_LIVE_ROUNDS);
    let slot: number | null = null;
    if (next < GUEST_LIVE_ROUNDS) {
      if (stage === "debate" && !liveState.opponents[next]) slot = next;
    } else if (liveState.retest === null) {
      slot = GUEST_LIVE_ROUNDS;
    }
    if (slot === null) return;
    // Scheduled, not called inline: the request updates state, and a cleared
    // timer means a double-run effect still sends exactly one request.
    const requested = slot;
    const timer = window.setTimeout(() => void requestOpponent(requested), 0);
    return () => window.clearTimeout(timer);
    // requestOpponent reads the current closure; the deps below are what decide the slot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, stage, responses.length, liveState?.opponents.length, liveState?.retest, pending]);

  function finishRetest(demonstrated: boolean) {
    saveGuestLoop(demonstrated ? "observed" : "not-observed");
  }

  /** Signing up from the result screen: carry the repair over, with no retest reading. */
  function saveBeforeRetest() {
    if (!repair) return;
    saveGuestLoop("not-run");
  }

  function saveGuestLoop(retestOutcome: GuestLoopSummary["retestOutcome"]) {
    // The completed loop is worth keeping: store a bounded summary for the
    // signup form so an account picks up where the guest left off. Best
    // effort — private browsing may deny storage; the flow still finishes.
    const assessment = assessGuestPractice(responses, motion.rounds.map((round) => round.opponent));
    // `demonstrated` is the RETEST reading (transfer under pressure), not the
    // drill reading. A successful repair that does not reappear under the new
    // challenge is a completed repair with unobserved transfer — it must not
    // be recorded as a failed repair. The two outcomes stay separate so the
    // carry-through never misreports a good drill as a bad one.
    const drillSucceeded = !!repair && repair.succeeded;
    const summary: GuestLoopSummary = {
      motion: motion.motion,
      weaknessKind: assessment.weakness.kind,
      weaknessLabel: assessment.weakness.label,
      repairState: !repair
        ? "needs_another_pass"
        : drillSucceeded
          ? "repair_demonstrated"
          : "partially_repaired",
      repairSucceeded: drillSucceeded,
      ...(repair?.text ? { repairText: repair.text.slice(0, 800) } : {}),
      retestOutcome,
      completedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(GUEST_LOOP_STORAGE_KEY, encodeGuestLoopSummary(summary));
    } catch {
      // Storage unavailable — nothing to carry through, nothing broken.
    }
  }

  /** A finished set of rounds marks today on the week row. Best effort, device-local. */
  function recordPracticeDay() {
    try {
      window.localStorage.setItem(GUEST_PRACTICE_DAYS_KEY, addGuestPracticeDay(window.localStorage.getItem(GUEST_PRACTICE_DAYS_KEY), today));
    } catch {
      // Storage unavailable — the week row simply stays empty.
    }
  }

  function freshLiveState(persona?: OpponentPersonaId): GuestLiveState | null {
    return liveMotion ? emptyGuestLiveState(liveMotion, persona ?? liveState?.persona) : null;
  }

  function restart() {
    try {
      window.sessionStorage.removeItem(GUEST_ARENA_STORAGE_KEY);
    } catch {
      // Storage unavailable — in-memory reset below is sufficient.
    }
    setStage("home");
    setResponses([]);
    setRepair(null);
    setRetestDemonstrated(null);
    setPending(null);
    setLiveState(freshLiveState());
    if (!liveMotion) setMode("guided");
  }

  function recordResponses(roundIndex: number, response: string) {
    setResponses((current) => {
      const next = [...current];
      next[roundIndex] = response;
      return next;
    });
  }

  const assessment = stage === "result" || stage === "retest"
    ? assessGuestPractice(responses, motion.rounds.map((round) => round.opponent))
    : null;

  if (stage === "debate") {
    return (
      <GuestDebate
        key={mode}
        motion={motion}
        side={side}
        rounds={motion.rounds}
        initialRound={Math.min(responses.length, motion.rounds.length - 1)}
        onRoundSubmit={recordResponses}
        onFinish={() => {
          recordPracticeDay();
          setStage("result");
        }}
        notice={mode === "guided" ? notice : null}
        live={
          isLive && liveState
            ? {
                pending,
                personaLabel: OPPONENT_PERSONA_LIST.find((p) => p.id === liveState.persona)?.label ?? "Balanced",
                onRetry: (index) => {
                  setPending(null);
                  void requestOpponent(index);
                },
                onGuided: (index) => {
                  setPending(null);
                  commitOpponent(index, GUEST_LIVE_FALLBACK_OPPONENT[index] ?? GUEST_LIVE_FALLBACK_RETEST);
                },
              }
            : undefined
        }
      />
    );
  }

  if (stage === "result" && assessment) {
    return (
      <GuestResult
        motion={motion}
        side={side}
        responses={responses}
        repairSucceeded={!!repair}
        acceptedRepairText={repair?.text ?? null}
        validation={validation}
        onRepairSucceeded={(kind, label, text, succeeded) => setRepair({ kind, label, text, succeeded })}
        onRetest={() => {
          // Freeze the retest challenge before it is shown: a late-arriving
          // generated one must never replace text the learner is answering.
          if (isLive && liveState?.retest === null) commitOpponent(GUEST_LIVE_ROUNDS, GUEST_LIVE_FALLBACK_RETEST);
          setStage("retest");
        }}
        onSignUp={saveBeforeRetest}
        onRestart={restart}
      />
    );
  }

  if (stage === "retest" && repair) {
    return (
      <GuestRetest
        motion={motion}
        weaknessKind={repair.kind}
        weaknessLabel={repair.label}
        repairText={repair.text}
        repairSucceeded={repair.succeeded}
        onFinish={(demonstrated) => {
          setRetestDemonstrated(demonstrated);
          finishRetest(demonstrated);
          setStage("done");
        }}
        onBack={() => setStage("result")}
      />
    );
  }

  if (stage === "done" && repair) {
    return (
      <GuestDone
        weaknessLabel={repair.label}
        repairSucceeded={repair.succeeded}
        demonstrated={retestDemonstrated === true}
        onRestart={restart}
      />
    );
  }

  return (
    <GuestHome
      motion={guidedMotion}
      today={today}
      live={{
        motion: liveMotion,
        mode: liveMotion ? mode : "guided",
        persona: liveState?.persona ?? "balanced",
        onPersona: (persona) => setLiveState((current) => (current ? { ...current, persona } : current)),
        onMode: (nextMode) => {
          setNotice(null);
          setMode(nextMode);
        },
        notice: mode === "guided" ? notice : null,
      }}
      onStart={(nextSide) => {
        setSide(nextSide);
        setResponses([]);
        setRepair(null);
        setRetestDemonstrated(null);
        setPending(null);
        setLiveState(freshLiveState());
        setStage("debate");
      }}
    />
  );
}
