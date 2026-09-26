"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import PageHeader from "./PageHeader";
import {
  assessGuestPractice,
  assessGuestRepair,
  assessGuestResponse,
  type GuestRepairAssessment,
} from "@/lib/guestAssessment";

type Stage = "home" | "debate" | "result";

const MOTION = "Should every school day include a phone-free hour?";
const ROUNDS = [
  {
    label: "Make your case",
    opponent: "A phone-free hour gives students room to focus, talk, and reset without another notification competing for attention.",
    prompt: "Open with one clear claim and the reason it matters.",
  },
  {
    label: "Take the pressure",
    opponent: "A blanket rule sounds simple, but it can punish students who need a phone for accessibility, family care, or a safe trip home.",
    prompt: "Address the strongest objection before it addresses you.",
  },
  {
    label: "Close with impact",
    opponent: "The best policy is not the strictest one. It is the one students can follow while teachers can still protect learning time.",
    prompt: "Compare the trade-offs and make your recommendation.",
  },
];

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

function GuestHome({ onStart }: { onStart: (side: "for" | "against") => void }) {
  const [side, setSide] = useState<"for" | "against" | "challenge">("challenge");

  function resolveSide(): "for" | "against" {
    return side === "challenge" ? (Math.random() < 0.5 ? "for" : "against") : side;
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
                <p className="home-motion-meta">Education · 3 rounds · about 6 minutes</p>
              </div>
              <span className="pill border-[var(--speak)]/30 bg-[var(--speak-soft)] text-[var(--speak)]">Sample</span>
            </div>

            <div className="home-motion-body">
              <div>
                <h2 id="guest-motion" className="home-motion-title">{MOTION}</h2>
                <p className="home-motion-prompt">
                  You will get a real opposing case, a clear round goal, and feedback that reacts to what you actually write.
                </p>
              </div>

              <div className="home-coaching-focus">
                <span className="home-coaching-label">Today&apos;s coaching focus</span>
                <strong>Make the reasoning visible.</strong>
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
                      <span>{option === "for" ? "Make the case" : option === "against" ? "Push back" : "Pick my side"}</span>
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
                <p className="home-start-note">No download, no card. Your guest practice stays on this device.</p>
              </div>
            </div>
          </section>

          <section aria-labelledby="guest-account">
            <div className="section-heading">
              <h2 id="guest-account">With an account</h2>
              <span className="section-heading-note">Free</span>
            </div>
            <div className="home-secondary-grid">
              {[
                {
                  kicker: "Progress",
                  title: "A profile that persists",
                  copy: "Your argument graph, streak and skill trajectory are kept between debates instead of resetting each session.",
                },
                {
                  kicker: "Coaching",
                  title: "The next move, not just a score",
                  copy: "Each debate ends with one specific weakness to repair, drawn from the graph of what you actually argued.",
                },
                {
                  kicker: "Player vs Player",
                  title: "Debate other people",
                  copy: "Take today's motion head-to-head against another player and get a judged verdict on the transcript.",
                },
                {
                  kicker: "History",
                  title: "Every rep, replayable",
                  copy: "Go back to any past debate, read the transcript, and see how the scoring was reached.",
                },
              ].map((item) => (
                <article key={item.title} className="home-secondary-card">
                  <p className="home-secondary-kicker">{item.kicker}</p>
                  <h3>{item.title}</h3>
                  <p>{item.copy}</p>
                  <Link href="/login" className="home-secondary-action">
                    Create a free account →
                  </Link>
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
  side,
  onRoundSubmit,
  onFinish,
}: {
  side: "for" | "against";
  onRoundSubmit: (roundIndex: number, response: string) => void;
  onFinish: () => void;
}) {
  const [round, setRound] = useState(0);
  const [response, setResponse] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const activeRound = ROUNDS[round];
  const assessment = submitted
    ? assessGuestResponse(response, activeRound.opponent, round)
    : null;

  function submit() {
    if (response.trim().length < 12) return;
    onRoundSubmit(round, response.trim());
    setSubmitted(true);
  }

  function next() {
    if (round === ROUNDS.length - 1) {
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
                <h1 className="page-title mt-2">{MOTION}</h1>
              </div>
              <span className="pill">{side === "for" ? "You: make the case" : "You: push back"}</span>
            </div>
            <div className="mt-6 flex items-center gap-2" aria-label={`Round ${round + 1} of ${ROUNDS.length}`}>
              {ROUNDS.map((item, index) => (
                <div
                  key={item.label}
                  className={`h-1.5 flex-1 rounded-full ${index <= round ? "bg-[var(--speak)]" : "bg-[var(--line)]"}`}
                />
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-ink3">
              <span>Round {round + 1} of {ROUNDS.length} · {activeRound.label}</span>
              <span>~ 2 min left</span>
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
                  placeholder="Write 2–4 sentences…"
                  rows={5}
                  className="field mt-4 resize-none text-sm leading-6"
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-[11px] text-ink3">{response.trim().length}/12 minimum characters</span>
                  <button
                    type="button"
                    onClick={submit}
                    disabled={response.trim().length < 12}
                    className="btn btn-primary px-4 py-2 text-sm"
                  >
                    Send response <span aria-hidden="true">→</span>
                  </button>
                </div>
              </div>
            ) : (
              <div
                className="surface-raised mt-6 p-4 sm:p-5"
                aria-live="polite"
                data-testid="guest-round-feedback"
              >
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
                  {round === ROUNDS.length - 1 ? "See my result" : "Take the next round"} <span aria-hidden="true">→</span>
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
                {[["Claim", "Make one point"], ["Reasoning", "Show why it follows"], ["Opponent", "Answer their actual case"]].map(([label, detail]) => (
                  <div key={label} className="flex gap-2 text-xs">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--speak)]" />
                    <span><span className="font-semibold text-ink">{label}</span><span className="ml-1 text-ink3">{detail}</span></span>
                  </div>
                ))}
              </div>
            </div>
            <p className="px-1 text-[11px] leading-5 text-ink3">
              Guest feedback checks only what is visible in your wording. An account adds persisted debates, argument graphs and longitudinal coaching.
            </p>
          </aside>
        </main>
      </div>
    </div>
  );
}

function GuestResult({
  responses,
  onRestart,
}: {
  responses: string[];
  onRestart: () => void;
}) {
  const assessment = assessGuestPractice(responses, ROUNDS.map((round) => round.opponent));
  const [repair, setRepair] = useState("");
  const [repairAssessment, setRepairAssessment] = useState<GuestRepairAssessment | null>(null);
  const sourceRound = ROUNDS[assessment.sourceResponseIndex];

  function submitRepair() {
    if (repair.trim().length < 12) return;
    setRepairAssessment(
      assessGuestRepair(
        assessment.weakness.kind,
        repair.trim(),
        sourceRound?.opponent ?? "",
      ),
    );
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
          <Link href="/login" className="btn btn-secondary px-3 py-1.5 text-xs">Save my progress</Link>
        </header>
        <main id="main" className="app-content max-w-2xl">
          <PageHeader
            eyebrow="Rep complete"
            title="Your practice result"
            description="One observable strength, one useful weakness, then one immediate repair."
            actions={<span className="pill">Guest preview</span>}
          />

          <section className="surface-card p-5 sm:p-6" data-testid="guest-result">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink3">Observed in your writing</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {observations.map(([label, count]) => (
                <div key={label} className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3">
                  <p className="text-xs text-ink3">{label}</p>
                  <p className="mt-1 text-sm font-semibold">{count} of 3 responses</p>
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
              placeholder="Rewrite the move here…"
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
                className={`mt-4 rounded-lg border p-3 text-sm leading-6 ${repairAssessment.succeeded
                  ? "border-[var(--success)]/30 bg-[var(--success-soft)] text-[var(--success)]"
                  : "border-[var(--review)]/30 bg-[var(--review-soft)] text-[var(--review)]"}`}
                aria-live="polite"
                data-testid="guest-repair-feedback"
              >
                {repairAssessment.feedback}
              </div>
            )}
          </section>

          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={onRestart} className="btn btn-secondary px-4 py-3 text-sm">
              Start again
            </button>
            <Link href="/login" className="btn btn-primary px-4 py-3 text-center text-sm">
              {repairAssessment?.succeeded ? "Create account and retest this skill" : "Create a free account"}
            </Link>
          </div>
          <p className="text-center text-xs leading-5 text-ink3">
            Accounts keep the weakness, repair and later retest connected so progress can be measured over time instead of guessed from one practice.
          </p>
        </main>
      </div>
    </div>
  );
}

export default function GuestArena() {
  const [stage, setStage] = useState<Stage>("home");
  const [side, setSide] = useState<"for" | "against">("for");
  const [responses, setResponses] = useState<string[]>(["", "", ""]);

  function restart() {
    setStage("home");
    setResponses(["", "", ""]);
  }

  if (stage === "debate") {
    return (
      <GuestDebate
        side={side}
        onRoundSubmit={(roundIndex, response) => {
          setResponses((current) => {
            const next = [...current];
            next[roundIndex] = response;
            return next;
          });
        }}
        onFinish={() => setStage("result")}
      />
    );
  }

  if (stage === "result") {
    return <GuestResult responses={responses} onRestart={restart} />;
  }

  return (
    <GuestHome
      onStart={(nextSide) => {
        setSide(nextSide);
        setResponses(["", "", ""]);
        setStage("debate");
      }}
    />
  );
}
