# Status

Honest labels for what is shipped, provisional, or gated — with the
validation caveat that governs all of them. Last updated 2026-10-20 (numbers
below are the 2026-10-19 published artifact; the table is refreshed whenever
a new full-pack run lands).

> ## ⚠️ Validation status: no judge currently passes
>
> **Root cause since fixed (2026-10-24):** the four weekly benchmark runs
> before 2026-10-21 (04/05/12/19) were all **unpaced**, and every one failed
> on the provider-reliability gates for the same reason: the free tiers
> answered a 429 storm, and a 429 is a transport failure that lands in the
> reliability denominator — so the run measured the rate limiter, not the
> judge. #199 added a hardcoded `--pace-ms 15000`, but a hardcoded pace is
> correct for exactly one provider's ceiling, and the next scheduled run
> (Monday 2026-10-26) is its first test. The workflow now uses
> `--auto-pace`: one probe call per distinct provider, read that provider's
> OWN statement of its ceiling (its 200's rate-limit headers or its 429's
> own words, classified by `classifyRateLimit`), and pace the run at the
> slowest per-provider recommendation — the request gate is global, so the
> tightest ceiling governs. The pace is budget-capped at what the 350-minute
> job can carry, and a provider whose ceiling is tighter than the budget
> 429s honestly and is named in the artifact instead of silently timing the
> run out. Until a paced run actually lands, the numbers below still
> describe an unpaced artifact and must be read as transport measurements.
>
> As of the latest published benchmark run (2026-10-19,
> `docs/latest-judge-benchmark.json`, rendered per surface on `/metrics`),
> **no model clears the judge gates**:
>
> | | best measured | gate |
> |---|---|---|
> | Fixture-label agreement | **0.714** (cerebras, n=14) | ≥ 0.75 |
> | Calibration error (ECE) | **0.144** (cerebras) | ≤ 0.08 |
> | Position-swap stability | no usable measurement — every model's gate is INSUFFICIENT DATA | ≥ 0.97 |
> | Fake-citation influence | no usable measurement — every model's gate is INSUFFICIENT DATA | ≤ 0.05 |
>
> What that hides, stated plainly: **this run measures the free tier, not the
> judge.** The two invariance rows above have no number because *no* model
> produced a usable invariance sample — position swap needs 12 usable responses
> out of 24 and the best any model reached was 5. **cerebras** answered 42/192
> transport calls (22%) and still produced the best agreement (0.714 at n=14)
> and the best ECE (0.144); **openrouter** answered 76/312 (24%) for 0.667 at
> n=24 and ECE 0.221. **unorouter** and **kiraai** returned errors on every
> call (0/24 usable) — total outages, recorded as INSUFFICIENT DATA and never
> dropped from the record. Every model additionally failed the
> provider-reliability floor (≥ 0.75), so this run's primary finding is a
> transport problem, not a verdict-quality result.
>
> The last run that *did* measure invariance is the 2026-10-12 artifact (in
> git history): unorouter scored 0.455 position-swap stability, 0.619
> verbosity stability, 0.591 name stability and 0.5 fake-citation influence.
> Those remain the best evidence of how the judge behaves, and they are far
> below their gates. Its whitespace column is not evidence of anything — that
> probe was measuring nothing until it was fixed (see
> [docs/judge-experiments/errata.md](judge-experiments/errata.md)).
>
> **Which judge these numbers describe:** the free-tier models benchmarked so
> far (OpenRouter/UnoRouter; Kirai, since removed). The app now runs only on
> free tiers, failing over across UnoRouter, Groq, Cerebras, Gemini, NVIDIA and
> OpenRouter; Groq, Cerebras and Gemini have **no benchmark row yet** (the
> weekly workflow picks them up once their keys are repository secrets). Most
> free-tier failures are rate limits and quota errors (429/402), and a verdict
> may come from whichever provider answered — each verdict's stamp names it.
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

### The retest-timing lever: what the code does today, and what is not yet known

The roadmap's day-1 retargeting lever is **partly implemented and not yet
measured**. What the code does today:

- a successful repair enters the pending-retest queue immediately
  (`repair_retests`), oldest first, and the queue survives newer successes;
- the next debate the learner starts carries the test, provided its topic
  differs from the repaired debate's (`selectEligiblePendingRetest`);
- the dashboard therefore serves a **retargeted motion** when a test is
  pending, so the "different topic" rule does not cost a day
  (`practiceMotion.pickRetestMotion`);
- if the day offers no alternative motion, the test waits — and the wait is
  now silent, because the disclosure policy forbids announcing it.

So a retest *can* land on the next debate. What is **not** established is how
often it actually does, and how much of the gap between "repair" and "retest"
is scheduling versus the learner simply not returning. The `/analytics`
repair loop already tracks "Retest timing: prompted vs incidental" as
sample-gated observational association. The next step is to read that number
with real weekly users before changing the schedule: a retest that lands on
day 1 but is cued measures recall, and a retest that lands on day 14 but is
un-cued measures something the learner may no longer care about. No code
change to the schedule has been made on the strength of an unmeasured
hypothesis, and none should be until the scorecard has a baseline.

## Experimental surfaces (flag-gated, default off)

PvP navigation, friend challenges, voice input, and the corpus-validation
pages (judge benchmark, corpus metrics, human rating) are parked. They are
hidden from navigation, primary entry points, and marketing copy (the guest
home's "With an account" cards, the History header) unless
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
- The drill receipt survives the refresh it triggers: submitting today's drill used to unmount the feedback panel (the assignment row flips `open → attempted`, the dashboard reads only open assignments, and the "Continue training" card disappears), so the learner got no acknowledgement of what was observed. The dashboard now reads the attempted assignment too and recomputes the same observable signals server-side from the stored attempt text (the rubric is deterministic), so the receipt is server-rendered and survives a refresh, a reload and a return visit (`drillSignalsFromAttempt`, `src/lib/drillFeedback.ts`).
- The History screen can no longer be blanked by a cosmetic read: the timezone lookup used `.single()` (an error on zero rows) and its error was folded into the page's `loadError`, so a missing `profiles` row replaced the learner's whole record with "History could not be loaded". It now uses `.maybeSingle()`, is excluded from `loadError`, and falls back to UTC. A forfeit also no longer renders as "judge scored · for you" — the framing module's own attribution says no judge score was produced — and a tie, a forfeit and a match in progress are no longer coloured as a loss.
- Mobile navigation no longer disappears while a page loads: the Progress, History and debate-room loading skeletons rendered the desktop sidebar, which is hidden below 1024px, leaving a phone with no navigation at all until the real shell mounted.
- Progress topic averages use the length-normalised performance score (`/100`) instead of the raw per-turn XP total, which grew with the number of rounds and made a long debate look like a strong one; the Argument DNA timeline reports one measure per month (solo length-normalised, or the judge's score for a PvP-only month) instead of averaging two different constructs together, and its range switch now exposes `aria-pressed` and a 44px tap target.
- Best/weakest topic categories on Progress: observational averages over scored debates, shown only once a category has a minimum sample.
- Recovery-first solo state: Start is claim-first and atomic (one opening call + one canonical active debate per user/topic), stale Finish leases self-heal, timed modes survive reloads, and an accepted response can be used to **Finish with saved response** once the minimum debate length is satisfied.
- Simplified result screen: one strength, one weakness, one evidence line, **Fix this now**, length-normalized performance + cumulative XP secondary, full analysis behind progressive disclosure.
- Weak-link repair: server-checked rewrite of the flagged move with formative states and observable signals; the internal numeric rubric stays hidden, persists in `repair_results`, and links to the day's drill assignment for later retest scheduling.
- "Challenge me" side assignment: explainable, history-based side choice (side balance → performance gap → alternation → random when no data). Lightweight by design — not presented as optimised.
- Daily coaching goal: shown before the debate, assessed after it, numeric only when the data supports the precision.
- **The retest is a measurement, not a prompt.** While a deliberate retest is pending, no pre-debate surface names the skill under test, prints its instruction as the day's goal, or ties the test to a day; the skill is instead *excluded* from the visible coaching focus, the drill, the practice target, the priority card, the loop thread, the Argument DNA focus, the debate's own coaching goal, the motion kicker and the live coaching hints. The verdict is behavioural — the canonical `retestOutcomeFor` detector over the merged argument graph — not compliance with the goal line that was displayed; the four canonical outcomes map onto the existing `repair_retests` columns with no migration, and the result screen reveals the verdict and the skill's name only after the debate. The rule, its enforcement points, its honest limit (the product controls what it shows, not what a learner remembers) and its one documented exception (guest practice, a demo rather than a measurement) are in `docs/product.md` § "The retest is a measurement, not a prompt" and `src/lib/retestDisclosure.ts`; the policy is executable as tests in `src/lib/retestDisclosure.test.ts`.
- **One exclusion rule, everywhere, and it is a set.** The skill(s) under silent test are supplied by one helper (`skillsUnderTest`, `src/lib/retestDisclosure.ts`) to every pre-debate surface: the dashboard, Progress, Argument DNA, the drill coach, the debate's own coaching goal and the practice target. It returns **every** pending retest's skill, not one. A pending retest whose topic is not today's could still be the one the next eligible debate picks up, so a learner with two open loops has two skills under silent test, and naming or coaching either one would prompt the behaviour the retest is meant to measure. The practice target used to derive its own exclusion from the repair list — which orders skills by taxonomy key, while the pending queue orders them by age — so the two orders could disagree and the target could name the skill the next debate would test; it now takes the queue from the same source as the goal, and the exclusion is a union with the repair-derived set so a missing queue row cannot silently unblock a skill being measured.
- **One skill, one instruction.** The Progress screen showed a "Next practice" card ("Today, watch for …") and a "Focus this week" card (the goal line), each with a CTA to the same debate — and the two selectors behind them ranked skills differently: the coaching goal scores each skill by its *primary* metric and adjusts for movement, while the practice target scores by an *average across all its metrics* and adds a "needs more evidence" branch. A learner could be told to watch for Rebuttal and to practise Impact in the same debate, and the debate coaches only one of them. The practice target now follows the coaching line — the goal line is what the debate is *graded* against, so it wins — and keeps its own policy (persistent weakness, needs evidence, general) only when there is no coaching line. Both cards exclude the same skills under silent test, from the same pending-retest queue, so neither can leak the skill being measured.
- **A sprint no longer consumes the test.** A repair stays pending until a `repair_retests` row with `observable=true` exists. The Daily Sprint is started from the same card as a full debate and can carry a retest assignment, but three rounds cannot judge the skill — the detector says so, and the assignment then closed the repair with no verdict, so the one measurement the learner was waiting for was consumed by the one format that cannot make it. A sprint now records no verdict (`observable=false`), the repair stays pending, and the next full debate carries the test. The result card's copy for this case was already true ("This session was too short to judge the skill fairly. A full debate gives the behaviour room to appear.") and now matches what the data does.
- Engagement dimension coherence: the dimension named "Engagement" (persisted key `clarity`) measures the per-round argument-response rate — whether the learner answered the move the opponent actually made, on the round they made it. Its drills, its drill-attempt rubric, and its repair rubric all train and score that same behaviour (`src/lib/engagementSignals.ts` is the one shared definition). Sentence-length readability, which no metric observes, is gone from all three; a repair target is offered from the learner's unanswered engagement opportunity rather than their longest claim.
- Engagement is measurable end-to-end: `clarity` was the only repair kind with no deterministic weakness detector, so every engagement repair was hard-classified "not currently measurable" and every engagement retest returned "not-enough-evidence" — while the repair asked the learner to fix exactly that. `src/lib/opportunity.ts` now owns one round-level engagement definition (`engagementRoundsFor`) that the skill score, the weakness detector, the repair target selection and the retest read together, so none of them can drift apart. Building it surfaced the underlying blocker: the canonical answer rule refuses impact targets, so "answer the weighing move" was structurally unobservable and the weakness unfixable through the metric. `engagementAnsweredIds` credits answering weighing moves for engagement only (rebuttal coverage, drop detection and rewards are untouched), and `NOT_CURRENTLY_MEASURABLE_KINDS` is now empty — with its machinery kept as the guard for any future kind that lacks a detector.
- Progress screen: seven skills (Evidence, Rebuttal, Logic, Clarity, Impact, Steelmanning, Structure) with score + trend, strongest/weakest, current focus; raw metrics behind "How this was calculated". The live coaching ledger is explicitly bounded to the latest 100 completed debates and discloses when older history falls outside that window.
- Measurement honesty: Sprint results carry an explicit reduced-confidence note; `insufficient_evidence`, uncertainty lists, and evaluation stamps are preserved everywhere.
- PvP with atomic matchmaking, turn clocks, forfeits, judged verdicts with ensemble + fingerprints. Competitive trust claims stay conservative; the judge-validation gate is intact. (Flag-gated — see above.) The gate is read by every surface that renders an outcome: the result screen, the history list, and the lobby copy no longer claim "you won"/"you lost" while no benchmarked model clears the gates — they attribute the reading to the judge and show the measured reason (`src/lib/pvpOutcomeFraming.ts`).
- Async friend challenges: shareable `/challenge/<code>` link, persistent match state, expiry, turn state. (Foundation; flag-gated.)
- Guest practice without an account: deterministic local checks react to the actual response (claim, reasoning, opponent engagement, impact comparison, named evidence), identify one observable weakness, and offer a mini repair. The motion rotates from a curated set by UTC day (`src/lib/guestMotions.ts`), so guest mode costs nothing and stays deterministic. The loop completes the full cycle — debate → one weakness → repair → **retest under debate conditions** → an honest read of whether the move reappeared — before the signup prompt appears. Guest mode deliberately shows no numeric ability score: the retest reports one observed instance and names its sample size, never a claim of mastery. The guest home says plainly that guest practice checks five of the moves behind the seven skills (not "scores all seven"), and its account cards promise only what ships: kept progress, cross-debate tracking labelled unvalidated, and recent (not "every") debates. The retest can only be finished once it has been answered — an unanswered retest is never recorded as "not observed" — and every "Create a free account" CTA opens the sign-up tab (`/login?mode=signup`).
- Product analytics: allowlisted, bounded, no-free-text funnel events (`src/lib/productEvents.ts`), with transactional/idempotent solo round, completion and retest events plus an internal admin report at `/analytics` covering the training funnel, weekly loop volumes, and observational repair-effectiveness measurement.
- Blind corpus rating with position-bias control: `validateRating` requires at least one scored dimension per side, so a winner-only submission can never be stored as a full neutral rating via the `completeScores` fallback and contaminate the inter-rater reliability matrix that gates judge validation. Partial dimension sets remain allowed (unscored dimensions fall back at analysis time); ratings stay append-once with admin-only audited corrections.
- Free-only AI with cross-provider failover (2026-10): the paid Anthropic judge/opponent was removed. Every call walks the keyed free tiers (UnoRouter → Groq → Cerebras → Gemini → NVIDIA → OpenRouter), model by model then provider by provider, accepting only schema-valid output; per-verdict stamps record the provider and model that actually served. The durable daily spend cap (`AI_DAILY_SPEND_CAP_USD`) remains as a guard; free-tier calls are metered at $0.
- Privacy & data rights (Phase 3): `/privacy` and `/terms`, account self-service deletion (`DELETE /api/account` with password re-auth) backed by a transactional `delete_app_account(uuid)` erasure function, and a one-request JSON export (`GET /api/account/export`).
- Expired sessions, password-reset tokens, rate-limit buckets, stale solo start/finalization/submission leases, legacy zero-turn solo orphans, and stale challenge invites are swept daily by the unattended `backend-cleanup` workflow; `npm run db:cleanup` runs the same maintenance function manually. Database maintenance and manual migrations share one concurrency group so they cannot overlap.

## Provisional (measured, not validated)

- Skill scores and trends: deterministic and reproducible, but not yet validated against external measures of debating ability.
- Opponent personas, pressure levels, and mid-debate coaching hints: deterministic and inspectable, but not yet validated against learning outcomes.
- Coach focus selection and drill-outcome movement.
- The deliberate-retest verdict: now computed from observed behaviour by the canonical detector rather than from goal-compliance, and the product now gives no instruction for the skill under test, never names that skill before the debate, and never ties the test to a day. What the product controls is what it shows, not what a learner remembers: a learner who knows what they repaired can still guess that a given debate is the test. Whether an un-cued retest predicts anything about real skill retention is **not established** — no retention study, no A/B evidence, and no live user data exist for this or any comparable product.
- Ensemble-judge confidence heuristics.

## Known inconsistencies (analysed, deliberately not changed yet)

- **A pending retest never expires.** A repair with no completed observable assignment stays pending forever, so its skill stays excluded from the visible coaching, and a learner who quits and returns months later can meet "No focus line today". Expiring it would re-open the coaching on a skill whose transfer is still unmeasured — that weakens the measurement — so the honest fix is to let the learner resolve the open loop, which is a product decision and a new surface, not a silent timeout.
- **The retest assignment's conflict target does not match its unique index.** The insert uses `on conflict (repair_result_id, assigned_debate_id)`, while the index is on `assigned_debate_id` alone, so re-assigning one debate to a different repair would abort the start transaction with a 500 instead of starting unmeasured. Reachability is unestablished, so it is flagged rather than migrated blind.

## Shipped since the last audit round

- **Spoiler-free share card** (copied from Wordle). "Share result" on a fresh solo result and on the guest result shares `Daily Debate #N · For|Against`, one square per round (🟩 answered the opponent's move · 🟨 a reasoned point that did not answer it · 🟥 left it unanswered), and the repair state — never a word the learner wrote and never a score. Solo squares come from the canonical engagement definition (`engagementOpportunitiesFor` / `engagementAnsweredIds`); guest squares from the guest check's own observations. Guided practice on a sample motion is labelled "practice", not a numbered daily. The link opens `/s`, a public landing page that renders only validated codes from the URL, shows today's motion and a Start button, with an Open Graph image from `/api/share-image` (shapes only, no URL text). Shares are counted as `result_shared`. Meant to move: **new users**.
- **Product events the database was silently rejecting** (migration 044). The `product_events` name CHECK was last declared in 035, while the app added `weakness_feedback_missed`, `loop_streak_viewed`, `reminder_opted_in/opted_out/sent/acted` and `weekly_recap_viewed`. The best-effort recorder swallowed every rejected insert, so those analytics were empty rather than zero and the in-app reminder's 24h cap (read back from `reminder_sent`) never saw a send. 044 re-declares the full list; `productEventAllowlist.test.ts` now fails whenever the TypeScript list and the latest SQL declaration disagree.

- **A roll-forward-closed retest can no longer be overwritten by the abandoned debate** (migration 040). `complete_solo_debate_start` closes a repair's still-open assignment when a newer debate takes over the repair — correct, since an abandoned debate must not block transfer testing forever. But the finalizer wrote its verdict with no `completed_at IS NULL` guard, so finishing the abandoned debate later (a stale tab, a back button, a retry) overwrote the closed row: the retest record then named a debate that never carried the measurement, with a verdict computed from the wrong graph. The guarded finalizer only writes a verdict to a row that is still open for this debate; a skipped assignment records nothing, emits no `retest_completed` event, and the finish route reveals no verdict the durable state does not back (`retestAssignmentStillOpen`). The abandoned debate still completes — a completed debate must not be destroyed because a newer one started first. Proven non-vacuously by the real-Postgres suite: a late finalization with a "demonstrated" verdict leaves the closed row untouched and emits no retest events.
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
