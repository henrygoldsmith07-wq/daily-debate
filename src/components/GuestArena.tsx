"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import PageHeader from "./PageHeader";
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
    };
  } catch {
    // Corrupt or stale cache degrades to a fresh home — never half-restored.
    return { stage: "home", side: "for", responses: [], repair: null, retestDemonstrated: null };
  }
}

// The guest loop mirrors the signed-in product loop:
//   debate -> one weakness -> fix it now -> retest it -> see what moved.
//
// Everything here is deterministic and local. No provider call, no account, no
// cost: guest mode is a real but deliberately limited sample of the product, not
// a degraded copy of it. Nothing leaves the device: mid-practice progress sits
// in this tab's sessionStorage (a reload resumes where you left off), and the
// closing summary sits in localStorage for the signup form. The closing signup
// prompt appears only AFTER the learner has actually seen value.

type Stage = "home" | "debate" | "result" | "retest" | "done";

function Brand() {
  return (
    <Link href="/" className="home-brand-lockup" aria-label="Daily Debate home">
      <Image src="/logo.svg" alt="" width={30} height={30} className="rounded-lg" aria-hidden="true" />
      <span className="home-brand-copy">
        <span className="block text-sm font-semibold tracking-tight">Daily Debate</span>
        <span className="block text-[10px] uppercase tracking-[0.16em] text-ink3">Think in public</span>
      </span>
    </Link>
  );
}

function GuestHome({ motion, onStart }: { motion: GuestMotion; onStart: (side: "for" | "against") => void }) {
  const [side, setSide] = useState<"for" | "against" | "challenge">("challenge");

  function resolveSide(): "for" | "against" {
    // "Challenge me" assigns the side. It is derived from the date so a reload
    // cannot silently swap the side mid-practice; a random pick would make the
    // transcript unreadable on a second visit.
    const day = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) / 86_400_000;
    return day % 2 === 0 ? "for" : "against";
  }

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

          <section className="home-motion-card surface-card" aria-labelledby="guest-motion">
            <div className="home-motion-heading">
              <div>
                <p className="home-motion-kicker">Today&apos;s motion</p>
                <p className="home-motion-meta">
                  {motion.topic} · {motion.rounds.length} rounds · about {SPRINT_ESTIMATE_MINUTES} minutes
                </p>
              </div>
              <span className="pill border-[var(--speak)]/30 bg-[var(--speak-soft)] text-[var(--speak)]">Sample</span>
            </div>

            <div className="home-motion-body">
              <div>
                <h2 id="guest-motion" className="home-motion-title">{motion.motion}</h2>
                <p className="home-motion-prompt">
                  You will get a guided sample opposing case, a clear round goal, and feedback that reacts to what you actually write.
                </p>
              </div>

              <div className="home-coaching-focus">
                <span className="home-coaching-label">Today&apos;s coaching focus</span>
                <strong>{motion.coachingFocus}</strong>
              </div>

              <div className="home-start-block">
                <div className="home-side-label">Your side</div>
                <div className="home-side-picker" role="group" aria-label="Choose a side">
                  {(["challenge", "for", "against"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setSide(option)}
                      aria-pressed={side === option}
                      className={`home-side-option ${side === option ? "selected" : ""}`}
                    >
                      <span className="home-side-option-label">
                        {option === "for" ? "For" : option === "against" ? "Against" : "Challenge me"}
                      </span>
                      <span>{option === "for" ? "Make the case" : option === "against" ? "Push back" : "Pick for me"}</span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => onStart(resolveSide())}
                  className="home-start-button btn btn-primary px-4 py-3 text-sm"
                >
                  Start a free practice <span aria-hidden="true">→</span>
                </button>
                <p className="home-start-note">
                  No download, no card. Ends with one weakness, one repair, and a retest. Your guest practice stays on this device.
                </p>
              </div>
            </div>
          </section>

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
                { step: "1", kicker: "Debate", title: "Three rounds against a guided case", copy: "Each round, answer what the opponent actually said instead of just adding another point. The opponent is scripted in guest mode, so nothing you write leaves your device." },
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

function GuestDebate({
  motion,
  side,
  rounds,
  onRoundSubmit,
  onFinish,
  initialRound,
}: {
  motion: GuestMotion;
  side: "for" | "against";
  rounds: GuestMotion["rounds"];
  onRoundSubmit: (roundIndex: number, response: string) => void;
  onFinish: () => void;
  /** Resume a reloaded tab at the first unanswered round (completed rounds are kept). */
  initialRound?: number;
}) {
  const [round, setRound] = useState(() => Math.min(Math.max(initialRound ?? 0, 0), rounds.length - 1));
  const [response, setResponse] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const activeRound = rounds[round];
  const assessment = submitted ? assessGuestResponse(response, activeRound.opponent, round) : null;

  function submit() {
    if (response.trim().length < 12) return;
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
            <div className="mt-2 flex items-center justify-between text-[11px] text-ink3">
              <span>Round {round + 1} of {rounds.length} · {activeRound.label}</span>
              {/* No fabricated countdown: guest practice is untimed and free.
                  Showing "~2 min left" next to a round that never expires
                  invents urgency the flow does not have. */}
              <span>{round + 1 === rounds.length ? "Final round" : "Take your time"}</span>
            </div>

            <div className="mt-6 space-y-4">
              <div className="flex gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--surface-2)] text-xs font-semibold text-ink3">AI</div>
                <div className="max-w-2xl rounded-2xl rounded-tl-sm border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm leading-6 text-ink2">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink3">Opponent</p>
                  {activeRound.opponent}
                </div>
              </div>
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
                  value={response}
                  onChange={(event) => setResponse(event.target.value)}
                  placeholder="Write 2-4 sentences..."
                  rows={5}
                  className="field mt-4 resize-none text-sm leading-6"
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-[11px] text-ink3">{response.trim().length}/12 minimum characters</span>
                  <button type="button" onClick={submit} disabled={response.trim().length < 12} className="btn btn-primary px-4 py-2 text-sm">
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
                <p className="mt-3 text-[11px] leading-5 text-ink3">
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
            <p className="px-1 text-[11px] leading-5 text-ink3">
              Guest feedback only checks what is visible in your wording. An account saves your debates and keeps coaching you on the same weakness over time.
            </p>
          </aside>
        </main>
      </div>
    </div>
  );
}

function GuestResult({
  motion,
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

  return (
    <div className="app-shell app-shell-guest">
      <div className="app-main">
        <header className="app-topbar app-topbar-guest">
          <Brand />
          <Link href={SIGN_UP_PATH} onClick={onSignUp} className="btn btn-secondary px-3 py-1.5 text-xs">Create account</Link>
        </header>
        <main id="main" className="app-content max-w-2xl">
          <PageHeader
            eyebrow="Rep complete"
            title="Your practice result"
            description="One thing you did well, one thing to fix, then a quick rewrite to fix it."
            actions={<span className="pill">Guest preview</span>}
          />

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
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink3">
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
                  value={repair}
                  onChange={(event) => {
                    setRepair(event.target.value);
                    setRepairAssessment(null);
                  }}
                  rows={4}
                  placeholder="Rewrite the move here..."
                  className="field mt-2 resize-none text-sm leading-6"
                />
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

          {/* The loop is only complete once the repair is deliberately retested. */}
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
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink3">Opponent</p>
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
                  value={response}
                  onChange={(event) => setResponse(event.target.value)}
                  placeholder="Write 2-4 sentences..."
                  rows={5}
                  className="field mt-2 resize-none text-sm leading-6"
                />
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
                <p className="mt-3 text-[11px] leading-5 text-ink3">
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
            <p className="mt-3 text-[11px] leading-5 text-ink3">
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

export default function GuestArena({
  validation = null,
}: {
  /** Live judge-output validation for the guest surface, from the report the page loaded. */
  validation?: SurfaceValidation | null;
} = {}) {
  // Read the motion day before restoring state: the cache is invalidated per
  // motion day, so the day must be resolved first.
  const today = new Date().toISOString().slice(0, 10);
  const motion = guestMotionForDay(today);
  const restored = restoreArena(today);

  const [stage, setStage] = useState<Stage>(() => restored.stage);
  const [side, setSide] = useState<"for" | "against">(() => restored.side);
  const [responses, setResponses] = useState<string[]>(() => restored.responses);
  const [repair, setRepair] = useState<{ kind: GuestSkill; label: string; text: string; succeeded: boolean } | null>(() => restored.repair);
  const [retestDemonstrated, setRetestDemonstrated] = useState<boolean | null>(() => restored.retestDemonstrated);

  // Persist every transition. Best effort like the signup carry-through:
  // private browsing may deny storage; the flow still finishes.
  useEffect(() => {
    try {
      window.sessionStorage.setItem(
        GUEST_ARENA_STORAGE_KEY,
        encodeGuestArenaProgress({ version: 1, motionDate: today, stage, side, responses, repair, retestDemonstrated }),
      );
    } catch {
      // Storage unavailable — nothing cached, nothing broken.
    }
  }, [today, stage, side, responses, repair, retestDemonstrated]);

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
      retestOutcome,
      completedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(GUEST_LOOP_STORAGE_KEY, encodeGuestLoopSummary(summary));
    } catch {
      // Storage unavailable — nothing to carry through, nothing broken.
    }
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
        motion={motion}
        side={side}
        rounds={motion.rounds}
        initialRound={Math.min(responses.length, motion.rounds.length - 1)}
        onRoundSubmit={recordResponses}
        onFinish={() => setStage("result")}
      />
    );
  }

  if (stage === "result" && assessment) {
    return (
      <GuestResult
        motion={motion}
        responses={responses}
        repairSucceeded={!!repair}
        acceptedRepairText={repair?.text ?? null}
        validation={validation}
        onRepairSucceeded={(kind, label, text, succeeded) => setRepair({ kind, label, text, succeeded })}
        onRetest={() => setStage("retest")}
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
      motion={motion}
      onStart={(nextSide) => {
        setSide(nextSide);
        setResponses([]);
        setRepair(null);
        setStage("debate");
      }}
    />
  );
}