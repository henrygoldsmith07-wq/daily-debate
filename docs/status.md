# Status

Honest labels for what is shipped, provisional, or gated — with the
validation caveat that governs all of them. Last updated 2026-10-07.

> ## ⚠️ Validation status: no judge currently passes
>
> As of the latest published benchmark run, **no model clears the judge gates**
> (`docs/latest-judge-benchmark.json`, rendered per surface on `/metrics`):
>
> | | best measured | gate |
> |---|---|---|
> | Fixture-label agreement | **0.583** (n=24) | ≥ 0.75 |
> | Calibration error (ECE) | **0.189** | ≤ 0.08 |
> | Position-swap stability | **0.792** | ≥ 0.97 |
> | Fake-citation influence | **0.381** | ≤ 0.05 |
>
> The default judge returned usable data for **4 of 72** benchmark calls. A
> fake injected citation moves its verdict roughly a third of the time.
>
> **What follows from that, stated plainly:** the software below is real and
> works, but **every training-loop output it produces — weakness detection,
> repair targeting, the seven skill dimensions, trend arrows, PvP verdicts — is
> unvalidated.** There are no externally validated claims in this project yet
> ([docs/validation.md](validation.md), tier 5). Competitive claims stay gated;
> the training loop does not make competitive claims, but it does present
> numbers derived from an unvalidated instrument, and that is stated in the
> product rather than only in this file.

## Current focus

**Prove the loop.** The only active priority is growing real weekly use of the
daily loop; see [docs/roadmap.md](roadmap.md) for the scorecard and the parked
backlog.

## Experimental surfaces (flag-gated, default off)

PvP navigation, friend challenges, voice input, and the corpus-validation
pages (judge benchmark, corpus metrics, human rating) are parked. They are
hidden from navigation and primary entry points unless
`NEXT_PUBLIC_EXPERIMENTAL_SURFACES=1` — the routes, components, and tests all
stay in the codebase and pass with the flag on (the e2e webServer sets it).
Elo remains code + tests only and was never rendered.

## Shipped

"Shipped" means the **software** ships and works — it does not mean the
**claims** it produces are validated; see the notice above and `/metrics`.

- Daily Sprint (3 rounds) and Full Debate (5–12 rounds) through the same argument/evaluation pipeline.
- Opponent adversary controls: six personas (Skeptic, Lawyer, Philosopher, Economist, Devil's Advocate, Expert) plus three pressure levels (Easy, Challenging, Expert). Personas change how the AI attacks and pressure changes how hard — they are prompt-level controls and never touch the deterministic scoring.
- Three targeted practice formats beside Sprint/Full: Flash (1 round, ~60 seconds), Cross-examination (4 probing-question rounds), Socratic (4 question-only rounds). All carry reduced measurement confidence with an explicit note.
- Real-time coaching: deterministic mid-debate hints (unanswered opposition, contradictions, ungrounded claims, absolute language) computed from the same per-turn observable evidence as the score — no extra model calls, advisory only.
- Best/weakest topic categories on Progress: observational averages over scored debates, shown only once a category has a minimum sample.
- Recovery-first solo state: Start is claim-first and atomic (one opening call + one canonical active debate per user/topic), stale Finish leases self-heal, timed modes survive reloads, and an accepted response can be used to **Finish with saved response** once the minimum debate length is satisfied.
- Simplified result screen: one strength, one weakness, one evidence line, **Fix this now**, length-normalized performance + cumulative XP secondary, full analysis behind progressive disclosure.
- Weak-link repair: server-checked rewrite of the flagged move with formative states and observable signals; the internal numeric rubric stays hidden, persists in `repair_results`, and links to the day's drill assignment for later retest scheduling.
- "Challenge me" side assignment: explainable, history-based side choice (side balance → performance gap → alternation → random when no data). Lightweight by design — not presented as optimised.
- Daily coaching goal: shown before the debate, assessed after it, numeric only when the data supports the precision.
- Progress screen: seven skills (Evidence, Rebuttal, Logic, Clarity, Impact, Steelmanning, Structure) with score + trend, strongest/weakest, current focus; raw metrics behind "How this was calculated". The live coaching ledger is explicitly bounded to the latest 100 completed debates and discloses when older history falls outside that window.
- Measurement honesty: Sprint results carry an explicit reduced-confidence note; `insufficient_evidence`, uncertainty lists, and evaluation stamps are preserved everywhere.
- PvP with atomic matchmaking, turn clocks, forfeits, judged verdicts with ensemble + fingerprints. Competitive trust claims stay conservative; the judge-validation gate is intact. (Flag-gated — see above.)
- Async friend challenges: shareable `/challenge/<code>` link, persistent match state, expiry, turn state. (Foundation; flag-gated.)
- Guest practice without an account: deterministic local checks react to the actual response (claim, reasoning, opponent engagement, impact comparison, named evidence), identify one observable weakness, and offer a mini repair. The motion rotates from a curated set by UTC day (`src/lib/guestMotions.ts`), so guest mode costs nothing and stays deterministic. The loop completes the full cycle — debate → one weakness → repair → **retest under debate conditions** → an honest read of whether the move reappeared — before the signup prompt appears. Guest mode deliberately shows no numeric ability score: the retest reports one observed instance and names its sample size, never a claim of mastery.
- Product analytics: allowlisted, bounded, no-free-text funnel events (`src/lib/productEvents.ts`), with transactional/idempotent solo round, completion and retest events plus an internal admin report at `/analytics` covering the training funnel, weekly loop volumes, and observational repair-effectiveness measurement.
- Judge reliability & cost controls (Phase 3): pinned paid default judge (`claude-sonnet-5` via `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` to override), free-provider chain gated off everywhere by default (`JUDGE_ALLOW_FREE_PROVIDERS`), a durable daily spend cap (`AI_DAILY_SPEND_CAP_USD`, fail-open on meter error, explicit retryable degradation), and per-verdict judge provider/model stamps.
- Privacy & data rights (Phase 3): `/privacy` and `/terms`, account self-service deletion (`DELETE /api/account` with password re-auth) backed by a transactional `delete_app_account(uuid)` erasure function, and a one-request JSON export (`GET /api/account/export`).
- Expired sessions, password-reset tokens, rate-limit buckets, stale solo start/finalization/submission leases, legacy zero-turn solo orphans, and stale challenge invites are swept daily by the unattended `backend-cleanup` workflow; `npm run db:cleanup` runs the same maintenance function manually. Database maintenance and manual migrations share one concurrency group so they cannot overlap.

## Provisional (measured, not validated)

- Skill scores and trends: deterministic and reproducible, but not yet validated against external measures of debating ability.
- Opponent personas, pressure levels, and mid-debate coaching hints: deterministic and inspectable, but not yet validated against learning outcomes.
- Coach focus selection and drill-outcome movement.
- Ensemble-judge confidence heuristics.

## Gated / future

- Ranked play, Elo expansion, tournaments: stay behind `eloGate` (judge invariance + ≥75% human agreement on a real corpus, matching `config/judge-gates.json`).
- Judge validation on live models: weekly benchmark runs (`npm run benchmark:judges`), gates in `config/judge-gates.json`.

## Capability map

Working baseline by subsystem — most parked roadmap items are *extensions of
these*, not new subsystems.

| Capability | Where |
|------------|-------|
| Argument graph `claim → evidence → counterclaim → rebuttal → impact` | `src/lib/argGraph.ts` |
| Source-grounded evidence + citation allowlist / quality score | `src/lib/citationVerifier.ts` |
| User-attached evidence (URL inference) | `src/lib/evidence.ts` |
| Judge invariance transforms (swap labels, strip names, verbosity, hedge, fake source) | `src/lib/judgeInvariance.ts` |
| Labelled fixture corpus (provenance currently unverified) | `src/lib/humanCorpus.ts` |
| Heuristic enrichers (repetition, rebuttal coverage, fallacy hints) | `src/lib/argHeuristics.ts` |
| Adaptive drills + weakness/profile selection | `src/lib/adaptiveCoach.ts`, `src/lib/coachLoop.ts` |
| Elo gating + matchmaking | `src/lib/competitive.ts` |
| Finished-debate replay from persisted turns | `src/app/debate/[debateId]/page.tsx` |
| Voice input (Web Speech API, Chrome-family) | `src/components` (flag-gated) |

## Model calls per surface

Cost is a design constraint, not an afterthought. A configured daily spend cap
bounds all of it (`AI_DAILY_SPEND_CAP_USD`, default $10/day).

| Surface | Model calls | Notes |
|---|---|---|
| Sprint debate | 4 per debate | 1 opening + 2 opponent turns + 1 summary/assessment pass |
| Full debate | N+1 per debate | N = user turns (5–12), plus one summary call |
| PvP | 1 judge call per verdict | opponent turns are the two humans |
| Daily topic | ≤ 1/day globally | falls back to the curated bank on failure or cap |
| Guest practice | 0 | fully deterministic, no network |
| classifier.dev argument routing | 0 by default | off until disclosed in the privacy policy (`CLASSIFIER_DEV_ENABLED`) |
