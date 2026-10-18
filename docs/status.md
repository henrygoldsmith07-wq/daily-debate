# Status

Honest labels for what is shipped, provisional, or gated — with the
validation caveat that governs all of them. Last updated 2026-10-18 (numbers
below are the 2026-10-12 published artifact; the table is refreshed whenever
a new full-pack run lands).

> ## ⚠️ Validation status: no judge currently passes
>
> As of the latest published benchmark run (2026-10-12,
> `docs/latest-judge-benchmark.json`, rendered per surface on `/metrics`),
> **no model clears the judge gates**:
>
> | | best measured | gate |
> |---|---|---|
> | Fixture-label agreement | **0.696** (openrouter, n=23) | ≥ 0.75 |
> | Calibration error (ECE) | **0.105** (unorouter, n=24) | ≤ 0.08 |
> | Position-swap stability | **0.455** (unorouter; the only usable measurement this run) | ≥ 0.97 |
> | Fake-citation influence | **0.5** (unorouter) | ≤ 0.05 |
>
> What those bests hide, stated per row: **openrouter** reached the best
> agreement but answered only 72/300 transport calls (probe/audit instability
> — provider rate limits and quota errors, not a verdict-quality result), so
> every invariance gate for it is INSUFFICIENT DATA. **unorouter** answered
> 278/312 and failed 13 of 14 gates (ideological asymmetry is the only PASS);
> its 0.455 position-swap and 0.5 fake-citation readings are the worst
> published numbers for either gate, replacing the 0.792 / 0.381 readings the
> table had quoted from the 2026-09-14 prompt-v5 artifact (a kiraai free tier
> that has since been retired mid-session). **kiraai** returned
> errors on every call (0/24 usable) — a total outage recorded as
> INSUFFICIENT DATA, never dropped from the record.
>
> **Which judge these numbers describe:** only the free-chain models
> (OpenRouter/UnoRouter/Kirai). The production judge, Anthropic
> `claude-sonnet-5`, has **never been benchmarked**: the weekly workflow does
> not run it, because a benchmark run spends paid API credit
> (`npm run benchmark:judges -- --models anthropic` with `ANTHROPIC_API_KEY`
> runs it on demand). Most free-chain failures are provider rate limits and
> quota errors (429/402), so these figures do not measure the shipped judge
> in either direction — the judge users see is **unmeasured**, not measured
> and failing.
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
- Engagement dimension coherence: the dimension named "Engagement" (persisted key `clarity`) measures the per-round argument-response rate — whether the learner answered the move the opponent actually made, on the round they made it. Its drills, its drill-attempt rubric, and its repair rubric all train and score that same behaviour (`src/lib/engagementSignals.ts` is the one shared definition). Sentence-length readability, which no metric observes, is gone from all three; a repair target is offered from the learner's unanswered engagement opportunity rather than their longest claim.
- Engagement is measurable end-to-end: `clarity` was the only repair kind with no deterministic weakness detector, so every engagement repair was hard-classified "not currently measurable" and every engagement retest returned "not-enough-evidence" — while the repair asked the learner to fix exactly that. `src/lib/opportunity.ts` now owns one round-level engagement definition (`engagementRoundsFor`) that the skill score, the weakness detector, the repair target selection and the retest read together, so none of them can drift apart. Building it surfaced the underlying blocker: the canonical answer rule refuses impact targets, so "answer the weighing move" was structurally unobservable and the weakness unfixable through the metric. `engagementAnsweredIds` credits answering weighing moves for engagement only (rebuttal coverage, drop detection and rewards are untouched), and `NOT_CURRENTLY_MEASURABLE_KINDS` is now empty — with its machinery kept as the guard for any future kind that lacks a detector.
- Progress screen: seven skills (Evidence, Rebuttal, Logic, Clarity, Impact, Steelmanning, Structure) with score + trend, strongest/weakest, current focus; raw metrics behind "How this was calculated". The live coaching ledger is explicitly bounded to the latest 100 completed debates and discloses when older history falls outside that window.
- Measurement honesty: Sprint results carry an explicit reduced-confidence note; `insufficient_evidence`, uncertainty lists, and evaluation stamps are preserved everywhere.
- PvP with atomic matchmaking, turn clocks, forfeits, judged verdicts with ensemble + fingerprints. Competitive trust claims stay conservative; the judge-validation gate is intact. (Flag-gated — see above.) The gate is read by every surface that renders an outcome: the result screen, the history list, and the lobby copy no longer claim "you won"/"you lost" while no benchmarked model clears the gates — they attribute the reading to the judge and show the measured reason (`src/lib/pvpOutcomeFraming.ts`).
- Async friend challenges: shareable `/challenge/<code>` link, persistent match state, expiry, turn state. (Foundation; flag-gated.)
- Guest practice without an account: deterministic local checks react to the actual response (claim, reasoning, opponent engagement, impact comparison, named evidence), identify one observable weakness, and offer a mini repair. The motion rotates from a curated set by UTC day (`src/lib/guestMotions.ts`), so guest mode costs nothing and stays deterministic. The loop completes the full cycle — debate → one weakness → repair → **retest under debate conditions** → an honest read of whether the move reappeared — before the signup prompt appears. Guest mode deliberately shows no numeric ability score: the retest reports one observed instance and names its sample size, never a claim of mastery.
- Product analytics: allowlisted, bounded, no-free-text funnel events (`src/lib/productEvents.ts`), with transactional/idempotent solo round, completion and retest events plus an internal admin report at `/analytics` covering the training funnel, weekly loop volumes, and observational repair-effectiveness measurement.
- Blind corpus rating with position-bias control: `validateRating` requires at least one scored dimension per side, so a winner-only submission can never be stored as a full neutral rating via the `completeScores` fallback and contaminate the inter-rater reliability matrix that gates judge validation. Partial dimension sets remain allowed (unscored dimensions fall back at analysis time); ratings stay append-once with admin-only audited corrections.
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
