# Daily Debate

A daily critical-thinking app: debate an AI opponent (by typing or speaking)
across at least five rounds and get scored on depth, evidence, logic,
rebuttal quality, and clarity — or challenge another player head-to-head on
today's topic and let an AI judge declare the winner. Points, levels, and
streaks make it a game.

## Stack

Next.js (App Router) + Supabase (auth, Postgres, Realtime) + OpenRouter (primary, default model `z-ai/glm-5.2:free` with automatic failover) / Anthropic (alternate judge backend).

> **On the free tier:** `z-ai/glm-5.2:free` is served by a single upstream provider whose shared pool is often saturated and returns 429 for long stretches. Requests retry with backoff and then fail over to the next model in `OPENROUTER_FALLBACK_MODELS`. Most of these models also bill reasoning tokens against `max_tokens` — GLM 5.2 spent 324 of 349 completion tokens thinking — so reasoning is disabled by default; endpoints that require it are retried without the flag.

## Features

- **Daily topic** — a new debatable proposition is generated once per day
  (`getOrCreateTodayTopic`), grounded with 3-5 real, well-known institutions
  relevant to the topic (their homepage + what angle/data they're known for).
  The model does not have live web access in this app, so these are named
  credible sources to go research yourself, not live-fetched citations.
- **Solo debate vs AI** — pick a side, then go back and forth with an AI
  arguing the opposite side for a minimum of 5 rounds (capped at 12). Each
  response is converted into an observable argument graph; the legacy five
  display badges are projections of graph features, not model-authored 0-10
  judgements. Finishing awards derived points, updates your level, and updates
  your daily streak.
- **Player vs player** — join the matchmaking queue for today's topic, get
  randomly assigned a side, and take alternating turns. Once both players hit
  the round limit, a model extracts the argument graph and deterministic rules
  compute the score from claims, citations, relevance, rebuttal coverage,
  responses, impacts, dropped arguments, contradictions, concessions, and
  high-confidence fallacies. If the graph is not sufficient, the result is
  explicitly `insufficient_evidence`, not a forced winner.
- **Voice input/output** — the mic button uses the browser's Web Speech API
  (`SpeechRecognition`) to dictate your response as text before sending; the
  AI's messages are read aloud with `speechSynthesis`. Both are Chrome-family
  only; the composer falls back to typing where unsupported.
- **Gamification** — points per turn (legacy 5-bucket sum) **plus improvement bonuses** for behaviours that indicate skill growth: complete debate +50, improve weakest skill +20, ground a claim +15, answer every rebuttal +20, beat benchmark +30, unfamiliar topic +10. Dashboard leads with coaching signals (weakness, recent improvement, skill rating), not vanity metrics. Global leaderboard included.
- **UX polish** — Ctrl/⌘+Enter to send, auto-scroll in the debate room,
  color-coded score badges, copyable result summary, mobile-friendly header,
  clearer empty states and loading indicators.

## Setup

1. Create a Supabase project and run the migrations in `supabase/migrations/`
   (including 004 for stored observable assessments and 005 for benchmark
   provenance).
2. Copy `.env.example` to `.env.local` and fill in your Supabase project URL,
   anon key, service role key, and an `OPENROUTER_API_KEY`.
3. `npm install && npm run dev`.

## Deploying to Vercel

The Vercel project must point its **Root Directory** at the repository root
(this is a standalone repo, not the monorepo it was split out of) with the
framework preset left on **Next.js**.

Every route runs through `middleware.ts`, which builds a Supabase client on each
request. If the Supabase variables are absent the middleware throws and *every*
path returns 500 — including `/login` — so set these in **Settings → Environment
Variables** for Production, Preview, and Development before the first deploy:

| Variable | Required | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Inlined at build time; changing it needs a redeploy, not just a restart. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Same build-time inlining. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Server-only. Never expose it with a `NEXT_PUBLIC_` prefix. |
| `OPENROUTER_API_KEY` | yes | Primary judge; solo debates and daily topics fail without it. |
| `OPENROUTER_MODEL` | optional | Defaults to `z-ai/glm-5.2:free`. |
| `OPENROUTER_FALLBACK_MODELS` | optional | Comma-separated failover chain. Defaults to free Nemotron 3 Ultra then Super. Empty string pins to one model. |
| `ANTHROPIC_API_KEY` | optional | Second judge in the ensemble when present. |
| `CORPUS_ADMIN_EMAILS` | optional | Leave unset to keep the corpus endpoints closed. |

A paused Supabase project produces the same symptoms as missing credentials, so
confirm the project is active before debugging the deployment itself.

## Argument graph & judging (why the winner won)

Every finished debate now produces a structured **argument graph**: `claim → evidence → counterclaim → rebuttal → impact`.
The model can extract graph nodes, but `src/lib/observableAssessment.ts` recomputes observable features and the score. The score has explicit weights, per-component evidence references, an extraction-confidence/uncertainty record, a five-point tie threshold, and an `insufficient_evidence` outcome. It does not use text length or source count as evidence quality; a claim receives at most the best relevant, grounded support link.

The scored features are `claimsMade`, `claimsDirectlySupported`, `evidenceActuallyCited`, `evidenceRelevance`, `directRebuttals`, `rebuttalCoverage`, `droppedArguments`, `contradictions`, `unsupportedAssertions`, `concededPoints`, `argumentResponses`, `impactHandling`/`impactComparison`, and `confidentlyDetectableFallacies`. The existing graph remains the audit surface and UI explanation.

### Source-grounded evidence

Evidence nodes are **source-grounded**: `ArgNode.citations?: EvidenceCitation[]` (`{ sourceName, homepage?, excerpt? }`). Judging prompts in both `src/lib/openrouter.ts` and `src/lib/anthropic.ts` now require that every `cited`/`strong` evidence node carry ≥1 citation naming a **real institution or outlet** (root homepage only — never invent article URLs). `validateGraph()` enforces this: cited/strong evidence without citations is a validation error, shown in the UI as `⚠ no citation`. New helpers:

- `groundedEvidenceRatio(graph)` — share of cited/strong evidence that is grounded
- `claimCoverageWithGroundedEvidence(graph)` — share of claims backed by grounded evidence
- `ArgGraphView` renders `↳ Pew, Lazard` per evidence node and a **Source grounding** panel; uncited cited/strong nodes get a `⚠ no citation` flag.

### Quote verification

Quoted spans in evidence are checked against the cited source's excerpt
(`src/lib/quoteVerification.ts`): verbatim quotes verify, close-but-not-verbatim
reads as paraphrase, partial overlap is flagged misquoted, and a quote absent
from the source is flagged **fabricated**. `evidenceQualityScore` folds source
tier + quote fidelity + date recency into one 0–1 score, and the graph evidence
report (`graphEvidenceReport`) counts fabricated quotes and docks its score for
them.

### Claim-to-source matching

A claim's content is checked against the best-matching cited excerpt
(`claimSourceMatch` in `src/lib/quoteVerification.ts`) and graded
**supported → weak → mismatched** — a claim that only repeats the source's name
is weak, and a claim whose content appears nowhere in the cited source is a
decorative citation. `graphEvidenceReport` counts mismatched claims
(`claimMismatchCount`), demotes those links to tangential, and docks its score
for them. No excerpt attached means **unverifiable**, not a violation.

### Judge benchmarks (invariance + grounded coverage)

`src/lib/benchmarks.test.ts` + `src/lib/benchmark.fixtures.ts` run on every `npm test` without network/DB:

- **Grounded evidence benchmark** — synthetic grounded graphs pass validation; uncited cited-nodes are flagged; metrics computed.
- **Judge invariance benchmark** — deterministic graph scoring verifies that swapping A/B ownership preserves every argument and inverts only the side label, while whitespace/verbosity changes do not buy points. Transcript fixtures still exercise the label-swap harness. Live-model invariance (run the real OpenRouter judge twice with shuffled framing and assert `winner` stability) belongs in a future `*.e2e.ts` suite — fixtures are reusable for it.

Until invariance is measured on the real judge, Elo/rank/social expansion stays paused — the task brief's milestone.

## Rate limiting & testing

- **Rate limiting** is now Supabase-backed (`supabase/migrations/002_rate_limits.sql`): `rate_limits(key, count, reset_at)` is shared across all serverless instances with a local in-memory fallback for tests/local dev without credentials. Migration `006_rate_limit_atomic.sql` adds an atomic `increment_rate_limit()` RPC so concurrent instances cannot undercount; the read-then-write path remains as a fallback when the RPC isn't deployed. 002 also ships `cleanup_rate_limits()` — schedule it via Supabase cron (or pg_cron) to prune expired windows. Before serious public use (PvP expansion) run all migrations. See `src/lib/rateLimit.ts` (`checkRateLimit` is async — callers `await` it).
- **Tests:** `npm test` (`vitest run`) / `npm run test:watch`. The assessment tests cover score composition, evidence references, insufficient evidence, side swaps, verbosity, source-count traps, and eloquent-nonsense vs concise-evidence cases.

## Trust, bias & benchmark suite (9.5)

New pure modules in `src/lib/` — all offline, all in `npm test` without credentials:

- **Citation verification** (`citationVerifier.ts`) — allowlist of ~25 real institutions (Nature/Reuters/AP/Pew/NREL/Lazard/NIST…), `verifyCitation`/`verifyGraphCitations` flags `hallucination` / `unknown_source` / `bad_url` / `missing_homepage`, root-homepage-only rule, tiered `sourceQualityScore` (1=peer-reviewed → 3=unknown) and `graphSourceQuality`. Live homepage reachability is a future async check; offline allowlist catches fake-institution hallucination.
- **User-attached evidence** (`evidence.ts`) — `UserEvidence { url, title?, excerpt? }`, `validateUserEvidence` (https + length) and `inferSourceFromUrl` (e.g. nature.com → Nature) so debaters can bring their own sources; future: surface to judge prompt + server-side fetch verify.
- **Judge invariance** (`judgeInvariance.ts`) — transforms: `swapLabels` (position bias), `stripNames` (name/identity bias), `inflateVerbosity` (verbosity bias), `addConfidenceHedge` (confidence bias), `injectFakeSource` (hallucination probe), plus `checkLabelInvariance` mock. Real-model double: call the live judge twice over the same `TRANSCRIPTS` fixture with `swapLabels` and assert winner stability in a future `*.e2e.ts`.
- **Labelled corpus** (`humanCorpus.ts`) — the repository fixture has rater-shaped records, but `auditCorpusLabels` marks it `unverified_fixture` because this checkout contains no independent provenance that proves human annotation. Agreement/calibration numbers are regression diagnostics, not human-validity claims, until moderated-annotation provenance is imported.
- **Heuristic enrichers** (`argHeuristics.ts`) — `detectRepetition` (Jaccard ≥0.72, same owner), `rebuttalCoverage` / `rebuttalAddressesTargets`, `fallacyHints` (lexicon over text). Intended to complement the judge and make the graph auditable/editable (nodes filterable offline).
- **Drills & weakness** (`drills.ts`) — `drillsFor` (ground a claim / close dropped / fix fallacy / weigh impact) and `weaknessProfile` + `topWeakness` across recent graphs for targeted practice and repeated personal weakness cards.
- **Competitive** (`competitive.ts`) — `eloGate({ invarianceOk, humanAgreement })` (70% human threshold), Elo math (`kFactor`, `expectedScore`, `eloDelta`), and `pickOpponent` (FIFO while gate closed, Elo-bucketed within 150 when open). Tournaments/challenges stay gated.
- **Moderation & anti-cheat** (`moderation.ts`) — `moderateMessage` (harassment/spam/caps/injection) + `isBlocked`, `repeatScore`, `isSuspiciousLength`. Real PvP abuse (multi-account, voting rings) lives in future Supabase functions; this catches cheap tricks.
- **Transcripts & async** (`transcript.ts`) — `transcriptForReplay` (ordered), `isOverdue` (per-turn clock), `DEFAULT_ASYNC` (24h/turn, 7d total) scaffold for replayable + asynchronous debates.
- **Retention** (`retention.ts`) — `dailyQuests`, `weeklyTarget`, `comebackCopy`, `onboardingChecklist` so retention does not rely purely on streaks.
- **Speech fallbacks** — `useSpeechRecognition` already degrades to typing; now documented for Safari/Firefox, with dictation + paste as alternatives (Web Speech API is Chrome-family only).

Tests: `src/lib/dailyDebate95.test.ts` (24 tests) covering all of the above.

Live-model note: run the real OpenRouter/Anthropic judge twice per fixture with each transform and report `positionBias`, `nameBias`, `verbosityBias`, `confidenceBias`, `hallucinationRate` — keep fixtures in `benchmark.fixtures.ts` reusable and add a `scripts/judge-invariance-e2e.mjs` once an API key is provisioned.

## Known limitations / TODO before wider PvP

- **Elo/ranking stays gated by `eloGate`** (invariance + ≥70% human agreement) — matchmaking is FIFO until green. Tournament/challenge modes stay behind the same gate.
- Live-model judge invariance e2e (real Gemini calls) still needs an API key — fixtures + `judgeInvariance` transforms are ready for it.
- Article-level citation verification (fetch the URL and check the excerpt) is a future server action; the offline allowlist is the floor.

## Argument-evaluation engine

`src/lib/argumentEvaluation.ts` adds deterministic detectors on top of the observable graph, surfaced as `assessment.engine` on every scored debate:

- **Causal overclaim detection** — certainty/causal language ("proves", "guarantees", "leads to") checked against the side's own evidence: unhedged causation over associational-only citations is flagged high-severity.
- **Fake-precision detection** — decimal-exact figures ("exactly 3.42%") without a nearby attribution cue; bare "per" deliberately does not count as a source cue.
- **Rebuttal-quality scoring** (beyond coverage) — target coverage × evidence-backing × engagement with the opponent's strongest material (impacts/counterclaims) × substance.
- **Steelman-quality scoring** — steelman markers ("even if", "granting", "concede") plus recorded concessions, minus strawman/ad-hominem penalties.

## Longitudinal skill ledger

`/progress` turns scored debates into measurable improvement. For each completed debate the stored observable assessment is re-merged and reduced to a metric vector — unsupported-claim rate, rebuttal coverage, evidence grounding (allowlist-verified), dropped arguments, contradictions, impact handling, steelmanning, fallacy frequency, causal overclaims, fake-precision figures, uncited-evidence rate, clarity — then trajectories are computed per metric: first-vs-last window deltas, least-squares slope per debate, and an `improved` flag with a noise floor. A fixed deterministic benchmark opponent provides a reference vector every user is compared against, and recurring weaknesses map to targeted drills (`weaknessTracker`). Improvement claims stay observational until 10 debates; causal claims wait for the rated corpus.

## Adaptive coach

`/progress` now leads with an **Argument Skill Profile** — seven dimensions (Evidence, Rebuttal, Logic, Clarity, Impact, Steelmanning, Structure) scored 0–100 from the same deterministic pipeline that grades debates, rendered as bars. Below it sits **Today's training focus**: the lowest dimension adjusted by movement (improving ones are deprioritised), served as a 2–5 minute drill from a rotating library.

Drills are **measurable end-to-end**: `drill_assignments` (migration 010) records before-score → drill → scored attempt → skill movement from subsequent debates (`movementAround`). Dimensions whose recent drills produce negative movement are excluded from recommendations until their skill moves again — the coach stops prescribing what doesn't work for you. Attempt scoring uses the judge's own detectors (contrastive moves, real-institution citations, weighing language, fallacy checks) so practice and performance share one rubric.

## Live judge benchmarks (gated deployment)

`npm run benchmark:judges` runs the invariance/bias suite against **real model APIs** (`scripts/judge-benchmark.mjs`, dependency-free so Node actually executes it — the previous `.ts`-importing script silently no-op'd). For each configured provider/model it judges the labelled fixtures base + 9 invariance transforms + political/ideological audit probes, then measures: position-mirror stability, per-transform stability, false-citation influence, ideological asymmetry, fixture-label agreement, ECE, latency and token spend.

Results merge into `docs/judge-leaderboard.md` (one row per model) with raw JSON at `docs/latest-judge-benchmark.json`. Deployment gates live in `config/judge-gates.json`; `--enforce` exits non-zero on breach, and `.github/workflows/judge-benchmark.yml` runs the suite weekly plus on demand. Current live findings are in the leaderboard file — including gate results that models must pass before judging real matches.

## Debate modes & speech analysis

Four debate modes change the training stimulus:

| Mode | Time | Purpose | Voice |
|---|---|---|---|
| **Text** | untimed | Analytical argument construction with citations | optional |
| **Speech** | ~60s soft / 180s hard | Actual debating practice for pace and filler analysis | expected |
| **Rapid Rebuttal** | 45s soft / 60s hard | Immediacy and concision — answer an argument fast | expected |
| **Prepared Speech** | 180s soft / 300s hard | Extended structured case with signposting | expected |

`src/lib/speechAnalysis.ts` measures seven debating-relevant vocal characteristics from transcript metadata: **pace** (words/minute, ideal 120–170), **filler density** (um/uh/like per 100 words), **pause patterns**, **structural signposting** (first/furthermore/therefore density), **contrastive moves** (however/even if/granting = rebuttal engagement), **argument repetition** (Jaccard vs prior turn), and **rebuttal immediacy** (seconds between opponent's turn and user starting). `scoreSpeechQuality()` composites these into a 0–100 score. Deliberately does NOT score accent, pitch, tone, or vocal characteristics irrelevant to debating quality.

## AI providers

**NVIDIA (build.nvidia.com) is the primary transport** when `NVIDIA_API_KEY` is set — direct Nemotron access (default Ultra, failing over to Super) without the shared free-pool saturation. Without an NVIDIA key the same module uses the **OpenRouter free tier** (GLM 5.2 → Nemotron Ultra → Super). Both transports share retry/backoff with Retry-After handling, reasoning-token control, and schema-validated outputs; per-model failover is configured via `NVIDIA_FALLBACK_MODELS` / `OPENROUTER_FALLBACK_MODELS`.

Solo flows additionally validate every response against `aiSchema.ts`; PvP judging runs the primary transport + Anthropic in parallel as an ensemble.

## Human-evaluation corpus population pipeline

The evaluation pipeline (six-dimension rubric, inter-rater reliability → comparison → calibration → bias) needs a real human-labelled corpus. Migration `008_corpus_pipeline.sql` plus `src/app/api/corpus/*` add the collection tooling:

- `POST /api/corpus/import` *(admin)* — imports finished solo/PvP debates as anonymised items: sides become "Side A"/"Side B", contributor identity and AI/user mapping stay server-side (`corpus_items.contributor_id` / `side_mapping`, never exposed to raters). Stratified by length bucket, topic category, and ability band.
- `GET/POST /api/corpus/rate` — blind rating: raters get the next open item they didn't author and haven't rated, submit six-dimension scores per side + winner + confidence; double-submission blocked by unique constraint; self-rating rejected.
- `GET /api/corpus/reliability` *(admin)* — human-human reliability FIRST: per-dimension ICC across raters, pairwise winner Cohen's κ, strata coverage (length × ability × subject), and an `agreementReady` count. Also reports **population progress** against target: total/fully-rated items vs the 500-item goal, remaining-to-target, mean rater confidence, and `cellsNeedingCoverage` — every length bucket and ability band below 30 items is named explicitly, including zero-coverage cells. System-vs-human accuracy is only meaningful over agreement-ready items.
- `POST /api/corpus/adjudicate` *(admin)* — settles disputed items by rater majority or explicit override.

Set `CORPUS_ADMIN_EMAILS` to enable admin endpoints (closed when unset). Until this corpus is populated and humans agree with each other, the evidence registry's status stands: scoring evidence remains synthetic-only.

### Flagship campaign — 1,000 debates × 3 blind ratings

The corpus is the product's flagship claim, stratified at import time by **deterministic** signals (no model judgement): debate difficulty (`dynamics_tier`: close / decisive / weak-vs-weak from observable score gaps), evidence density (evidence nodes per claim), writing style (formal / hedged / plain / intense via `styleFeatures`), plus length, subject, and ability band. Migration `009_population_strata.sql` adds those columns and indexes.

- Raters work at **`/rate`**; admins run the campaign from **`/corpus-admin`**.
- `POST /api/corpus/system-comparison` now also stores citation-integrity flags per judged graph and supports `"swapCheck": true` — a mirrored-transcript re-judgement that records position-swap stability per item.
- **`GET /api/corpus/metrics`** and the public **`/metrics`** page publish the headline table live: human consensus agreement, judge-vs-consensus agreement, close-debate accuracy, position-swap stability, calibration error (ECE over system-verdict confidence), and citation-flag rate on judged graphs.
- Honesty gates are built in: every metric is `null` until its minimum sample exists (e.g. judge rows need ≥30 judged debates, close-debate ≥20), and consensus requires genuine multi-rater agreement. Dashes on `/metrics` mean *not yet measurable*, never a placeholder number.

Raters use **`/rate`** in the app: blind transcript, six-dimension 1–5 scoring per side, winner + confidence + rationale. Admins run the campaign from **`/corpus-admin`**: population progress vs the 500-item target (with named strata needing recruitment), per-dimension ICC, the adjudication queue (transcript + anonymised rater verdicts; accept-majority or override), and a one-click system comparison. Once items are `agreementReady`, `POST /api/corpus/system-comparison` judges them with the live ensemble and reports winner agreement against human consensus. That number (plus ≥70% agreement on a large corpus) is what eventually un-gates ranked play; until then it stays synthetic-only in the evidence registry.

## PvP reliability

- One turn per `(match, player, round)` enforced by a DB unique index (008), backing the API's concurrency guards.
- Turn timestamps (`pvp_matches.turn_started_at`) power late-submission rejection (>30 min) and forfeit claims (`POST /api/pvp/[matchId]/forfeit`) so abandoned matches resolve without fabricating a judge score.
- The room resyncs on focus/tab-visible and falls back to snapshot polling if Realtime drops; stress suites fuzz source verification + moderation (they caught and killed a ReDoS in link-spam detection).

## Roadmap

- [`docs/roadmap.md`](docs/roadmap.md) — evaluation corpus, judge bias benchmarks, and the gated path to ranked/tournament/classroom play.

