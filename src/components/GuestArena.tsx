"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

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

const MODES = [
  { icon: "◉", tone: "speak", label: "Daily motion", detail: "A fresh, source-backed prompt every day." },
  { icon: "↗", tone: "review", label: "Rapid rebuttal", detail: "Train the exact weakness your last round found." },
  { icon: "✎", tone: "build", label: "Weak-link repair", detail: "Rewrite one graph-backed miss while the debate is still fresh." },
  { icon: "✦", tone: "build", label: "Free spar", detail: "Pick a side, bring a source, test your thinking." },
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

function ProgressStats() {
  return (
    <div className="grid grid-cols-3 divide-x divide-[var(--line)] rounded-xl border border-[var(--line)] bg-[var(--surface)]">
      <div className="px-3 py-3 sm:px-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink3">Streak</p>
        <p className="mt-1 text-lg font-semibold tabular-nums">4 <span className="text-sm">days</span></p>
      </div>
      <div className="px-3 py-3 sm:px-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink3">Level</p>
        <p className="mt-1 text-lg font-semibold tabular-nums">04 <span className="text-sm">/ 500</span></p>
      </div>
      <div className="px-3 py-3 sm:px-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink3">Best skill</p>
        <p className="mt-1 text-lg font-semibold">Clarity</p>
      </div>
    </div>
  );
}

function GuestHome({ onStart }: { onStart: (side: "for" | "against") => void }) {
  const [side, setSide] = useState<"for" | "against">("for");

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[var(--bg)]/95 px-4 py-3 backdrop-blur sm:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <Brand />
          <nav className="hidden items-center gap-6 text-xs font-medium text-ink3 md:flex" aria-label="Guest navigation">
            <a href="#how-it-works" className="transition hover:text-ink">How it works</a>
            <a href="#modes" className="transition hover:text-ink">Practice modes</a>
            <a href="#coach" className="transition hover:text-ink">The coach</a>
          </nav>
          <Link href="/login" className="btn btn-secondary px-3 py-2 text-xs">Sign in</Link>
        </div>
      </header>

      <main className="mx-auto flex max-w-7xl flex-col gap-10 px-4 py-8 sm:px-8 sm:py-12 lg:gap-14">
        <section className="grid items-center gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:gap-14">
          <div className="app-enter order-last lg:order-last">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink3">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
              Your daily 3-minute rep
            </div>
            <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-6xl">
              Win the point.<br /><span className="text-[var(--speak)]">Repair the move.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-ink2 sm:text-lg">
              A focused debate gym for making sharper claims, finding real evidence, and fixing the exact weak link your last argument exposed. Start free, no account required.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => onStart(side)} className="btn btn-primary px-5 py-3 text-sm">
                Try today&apos;s motion <span aria-hidden="true">→</span>
              </button>
              <a href="#how-it-works" className="btn btn-ghost px-4 py-3 text-sm">See the loop</a>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-xs text-ink3">
              <span className="inline-flex items-center gap-1.5"><span className="text-[var(--success)]">✓</span> Transparent scoring</span>
              <span className="inline-flex items-center gap-1.5"><span className="text-[var(--success)]">✓</span> Source-aware feedback</span>
              <span className="inline-flex items-center gap-1.5"><span className="text-[var(--success)]">✓</span> Voice or keyboard</span>
            </div>
          </div>

          <div className="home-hero surface-card app-enter order-first p-5 sm:p-6 lg:order-first" style={{ animationDelay: "80ms" }}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--speak)]">Today&apos;s challenge</p>
                <p className="mt-2 text-xs text-ink3">Education · 3 rounds · about 6 minutes</p>
              </div>
              <span className="pill border-[var(--speak)]/30 bg-[var(--speak-soft)] text-[var(--speak)]">Live</span>
            </div>
            <h2 className="mt-7 text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{MOTION}</h2>
            <p className="mt-3 text-sm leading-6 text-ink2">You will get a real opposing case, a clear round goal, and a coach note after every response.</p>
            <div className="mt-5 rounded-lg border border-[var(--speak)]/20 bg-[var(--review-soft)] px-3 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--speak)]">Today&apos;s coaching focus</p>
              <p className="mt-1 text-sm font-semibold text-ink">Use evidence for major claims.</p>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-2" role="group" aria-label="Choose a side">
              {(["for", "against"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setSide(option)}
                  aria-pressed={side === option}
                  className={`rounded-lg border px-3 py-3 text-left text-sm transition ${side === option ? "border-[var(--speak)] bg-[var(--speak-soft)] text-ink" : "border-[var(--line)] bg-[var(--surface)] text-ink3 hover:border-[var(--ink-3)]"}`}
                >
                  <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-ink3">Your side</span>
                  <span className="mt-1 block font-semibold">{option === "for" ? "Make the case" : "Push back"}</span>
                </button>
              ))}
            </div>
            <button type="button" onClick={() => onStart(side)} className="btn btn-primary mt-3 w-full px-4 py-3 text-sm">Start a free practice</button>
            <p className="mt-3 text-center text-[11px] text-ink3">No download · no card · your progress stays private</p>
          </div>
        </section>

        <section aria-label="Your progress" className="grid gap-4 lg:grid-cols-[1fr_1.35fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink3">Your progress</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight">Small reps compound.</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-ink3">Every round becomes a useful signal: what you said, what you missed, and the one move to try next.</p>
          </div>
          <ProgressStats />
        </section>

        <section id="modes" className="scroll-mt-24">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink3">Practice modes</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">Choose the rep you need.</h2>
            </div>
            <span className="text-xs text-ink3">Built for consistency, not hot takes.</span>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {MODES.map((mode) => (
              <button key={mode.label} type="button" onClick={() => onStart("for")} className={`home-mode-card home-mode-card-${mode.tone}`}>
                <span className="home-mode-icon text-lg" aria-hidden="true">{mode.icon}</span>
                <span className="mt-2 text-sm font-semibold">{mode.label}</span>
                <span className="max-w-[22rem] text-left text-xs leading-5 text-ink3">{mode.detail}</span>
                <span className="home-mode-arrow" aria-hidden="true">↗</span>
              </button>
            ))}
          </div>
        </section>

        <section id="how-it-works" className="scroll-mt-24 grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink3">The loop</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">A better kind of game.</h2>
            <p className="mt-3 text-sm leading-6 text-ink3">The point is not to sound certain. It is to learn how to move an argument forward when the other side is smart.</p>
            <div className="mt-5 flex items-center gap-2 text-xs text-ink3">
              <span className="font-semibold text-ink">1</span><span className="h-px w-8 bg-[var(--line)]" /><span>Claim</span>
              <span className="h-px w-8 bg-[var(--line)]" /><span className="font-semibold text-ink">2</span><span>Respond</span>
              <span className="h-px w-8 bg-[var(--line)]" /><span className="font-semibold text-ink">3</span><span>Improve</span>
            </div>
          </div>
          <div id="coach" className="surface-card scroll-mt-24 p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--review)]">After every round</p>
                <h3 className="mt-2 text-lg font-semibold">Feedback you can use immediately.</h3>
              </div>
              <span className="pill">Round 2 / 3</span>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {[
                ["Claim", "Clear", "var(--success)"],
                ["Evidence", "Needs a source", "var(--review)"],
                ["Rebuttal", "Strong", "var(--speak)"],
              ].map(([label, value, color]) => (
                <div key={label} className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3">
                  <div className="flex items-center justify-between gap-2 text-xs"><span className="text-ink3">{label}</span><span className="font-semibold" style={{ color }}>{value}</span></div>
                  <div className="mt-3 h-1 rounded-full bg-[var(--line)]"><div className="h-1 rounded-full" style={{ width: value === "Needs a source" ? "48%" : "88%", background: color }} /></div>
                </div>
              ))}
            </div>
            <p className="mt-4 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-3 text-sm leading-6 text-ink2"><span className="font-semibold text-ink">Coach note:</span> Your answer has a clean claim. Add one specific source or example before you compare impacts.</p>
          </div>
        </section>

        <footer className="border-t border-[var(--line)] pt-5 text-xs text-ink3 sm:flex sm:items-center sm:justify-between">
          <span>Daily Debate · Learn to disagree well.</span>
          <span className="mt-2 block sm:mt-0">Evidence first. Ego second.</span>
        </footer>
      </main>
    </div>
  );
}

function GuestDebate({ side, onFinish }: { side: "for" | "against"; onFinish: () => void }) {
  const [round, setRound] = useState(0);
  const [response, setResponse] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const activeRound = ROUNDS[round];

  function submit() {
    if (response.trim().length < 12) return;
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
    <div className="min-h-screen bg-[var(--bg)]">
      <header className="border-b border-[var(--line)] bg-[var(--bg)] px-4 py-3 sm:px-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <Brand />
          <div className="flex items-center gap-3 text-xs text-ink3"><span className="hidden sm:inline">Practice mode</span><span className="pill">Guest rep</span></div>
        </div>
      </header>
      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-8 sm:py-10 lg:grid-cols-[1fr_280px]">
        <section className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--speak)]">Today&apos;s motion</p><h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{MOTION}</h1></div>
            <span className="pill">{side === "for" ? "You: make the case" : "You: push back"}</span>
          </div>
          <div className="mt-6 flex items-center gap-2" aria-label={`Round ${round + 1} of ${ROUNDS.length}`}>
            {ROUNDS.map((item, index) => <div key={item.label} className={`h-1.5 flex-1 rounded-full ${index <= round ? "bg-[var(--speak)]" : "bg-[var(--line)]"}`} />)}
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-ink3"><span>Round {round + 1} of {ROUNDS.length} · {activeRound.label}</span><span>~ 2 min left</span></div>

          <div className="mt-6 space-y-4">
            <div className="flex gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--surface-2)] text-xs font-semibold text-ink3">AI</div>
              <div className="max-w-2xl rounded-2xl rounded-tl-sm border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm leading-6 text-ink2"><p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink3">Opponent</p>{activeRound.opponent}</div>
            </div>
            {submitted && <div className="ml-auto flex max-w-2xl justify-end gap-3"><div className="rounded-2xl rounded-tr-sm bg-[var(--speak)] px-4 py-3 text-sm leading-6 text-[var(--on-speak)]">{response}</div><div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--speak-soft)] text-xs font-semibold text-[var(--speak)]">YOU</div></div>}
          </div>

          {!submitted ? (
            <div className="surface-card mt-6 p-4 sm:p-5">
              <label htmlFor="guest-response" className="text-xs font-semibold uppercase tracking-[0.14em] text-ink3">Your response</label>
              <p className="mt-2 text-sm text-ink2">{activeRound.prompt}</p>
              <textarea id="guest-response" value={response} onChange={(event) => setResponse(event.target.value)} placeholder="Write 2–4 sentences…" rows={5} className="field mt-4 resize-none text-sm leading-6" />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><span className="text-[11px] text-ink3">{response.trim().length}/12 minimum characters</span><button type="button" onClick={submit} disabled={response.trim().length < 12} className="btn btn-primary px-4 py-2 text-sm">Send response <span aria-hidden="true">→</span></button></div>
            </div>
          ) : (
            <div className="surface-raised mt-6 p-4 sm:p-5" aria-live="polite">
              <div className="flex items-start gap-3"><div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--success-soft)] text-sm text-[var(--success)]">✓</div><div><p className="text-sm font-semibold">Round reviewed</p><p className="mt-1 text-sm leading-6 text-ink2">You made a direct claim and moved the conversation forward. Add a concrete source next time to make it harder to dismiss.</p></div></div>
              <div className="mt-4 flex flex-wrap gap-2"><span className="pill border-[var(--success)]/30 bg-[var(--success-soft)] text-[var(--success)]">Claim · clear</span><span className="pill border-[var(--review)]/30 bg-[var(--review-soft)] text-[var(--review)]">Evidence · next rep</span><span className="pill border-[var(--speak)]/30 bg-[var(--speak-soft)] text-[var(--speak)]">Tone · strong</span></div>
              <button type="button" onClick={next} className="btn btn-primary mt-5 w-full px-4 py-3 text-sm">{round === ROUNDS.length - 1 ? "See my result" : "Take the next round"} <span aria-hidden="true">→</span></button>
            </div>
          )}
        </section>

        <aside className="space-y-4 lg:pt-20">
          <div className="surface-card p-4"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink3">Round goal</p><p className="mt-2 text-sm font-semibold">{activeRound.label}</p><p className="mt-2 text-sm leading-6 text-ink3">{activeRound.prompt}</p></div>
          <div className="surface-card p-4"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink3">Coach lens</p><div className="mt-3 space-y-3">{[["Claim", "Make one point"], ["Evidence", "Name the support"], ["Rebuttal", "Answer their best case"]].map(([label, detail]) => <div key={label} className="flex gap-2 text-xs"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--speak)]" /><span><span className="font-semibold text-ink">{label}</span><span className="ml-1 text-ink3">{detail}</span></span></div>)}</div></div>
          <p className="px-1 text-[11px] leading-5 text-ink3">Your practice result is a preview. Create an account to save your graph, streak, and personalized drills.</p>
        </aside>
      </main>
    </div>
  );
}

function GuestResult({ onRestart }: { onRestart: () => void }) {
  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <header className="border-b border-[var(--line)] bg-[var(--bg)] px-4 py-3 sm:px-8"><div className="mx-auto flex max-w-6xl items-center justify-between"><Brand /><Link href="/login" className="btn btn-secondary px-3 py-2 text-xs">Save my progress</Link></div></header>
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 sm:px-8 sm:py-16">
        <div className="text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[var(--success-soft)] text-2xl text-[var(--success)]">✦</div><p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--success)]">Rep complete</p><h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">You showed up for the hard part.</h1><p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-ink3">A three-round practice is enough to find one useful next move. Save it, repeat it tomorrow, and watch the pattern change.</p></div>
        <div className="surface-card p-5 sm:p-6"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink3">Practice score</p><p className="mt-1 text-4xl font-semibold tabular-nums">82<span className="text-lg text-ink3"> / 100</span></p></div><span className="pill border-[var(--success)]/30 bg-[var(--success-soft)] text-[var(--success)]">Strong start</span></div><div className="mt-6 grid gap-3 sm:grid-cols-3">{[["Clarity", "88%", "var(--success)"], ["Rebuttal", "81%", "var(--speak)"], ["Evidence", "Needs reps", "var(--review)"]].map(([label, value, color]) => <div key={label} className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3"><p className="text-xs text-ink3">{label}</p><p className="mt-2 text-sm font-semibold" style={{ color }}>{value}</p></div>)}</div><p className="mt-4 rounded-lg bg-[var(--surface-2)] px-3 py-3 text-sm leading-6 text-ink2"><span className="font-semibold text-ink">Your next move:</span> bring one named source into your next answer before you compare the impact.</p></div>
        <div className="grid gap-3 sm:grid-cols-2"><button type="button" onClick={onRestart} className="btn btn-primary px-4 py-3 text-sm">Try another motion <span aria-hidden="true">→</span></button><Link href="/login" className="btn btn-secondary px-4 py-3 text-center text-sm">Create a free account</Link></div>
        <p className="text-center text-xs text-ink3">Daily Debate keeps the transcript, argument graph, and drills together so progress means more than a win screen.</p>
      </main>
    </div>
  );
}

export default function GuestArena() {
  const [stage, setStage] = useState<Stage>("home");
  const [side, setSide] = useState<"for" | "against">("for");

  if (stage === "debate") return <GuestDebate side={side} onFinish={() => setStage("result")} />;
  if (stage === "result") return <GuestResult onRestart={() => setStage("home")} />;
  return <GuestHome onStart={(nextSide) => { setSide(nextSide); setStage("debate"); }} />;
}
