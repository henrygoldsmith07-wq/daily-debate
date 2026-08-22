# Daily Debate

A daily critical-thinking app: debate an AI opponent (by typing or speaking)
across at least five rounds and get scored on depth, evidence, logic,
rebuttal quality, and clarity — or challenge another player head-to-head on
today's topic and let an AI judge declare the winner. Points, levels, and
streaks make it a game.

## Stack

Next.js (App Router) + Supabase (auth, Postgres, Realtime) + Gemini API (primary) / Anthropic (alternate judge backend).

## Features

- **Daily topic** — a new debatable proposition is generated once per day
  (`getOrCreateTodayTopic`), grounded with 3-5 real, well-known institutions
  relevant to the topic (their homepage + what angle/data they're known for).
  Gemini does not have live web access in this app, so these are named
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
- **Gamification** — points per round, levels, and daily streaks, plus a
  global leaderboard.
- **UX polish** — Ctrl/⌘+Enter to send, auto-scroll in the debate room,
  color-coded score badges, copyable result summary, mobile-friendly header,
  clearer empty states and loading indicators.

## Setup

1. Create a Supabase project and run the migrations in `supabase/migrations/`
   (including 004 for stored observable assessments and 005 for benchmark
   provenance).
2. Copy `.env.example` to `.env.local` and fill in your Supabase project URL,
   anon key, service role key, and a `GEMINI_API_KEY`.
3. `npm install && npm run dev`.

## Argument graph & judging (why the winner won)

Every finished debate now produces a structured **argument graph**: `claim → evidence → counterclaim → rebuttal → impact`.
The model can extract graph nodes, but `src/lib/observableAssessment.ts` recomputes observable features and the score. The score has explicit weights, per-component evidence references, an extraction-confidence/uncertainty record, a five-point tie threshold, and an `insufficient_evidence` outcome. It does not use text length or source count as evidence quality; a claim receives at most the best relevant, grounded support link.

The scored features are `claimsMade`, `claimsDirectlySupported`, `evidenceActuallyCited`, `evidenceRelevance`, `directRebuttals`, `rebuttalCoverage`, `droppedArguments`, `contradictions`, `unsupportedAssertions`, `concededPoints`, `argumentResponses`, `impactHandling`/`impactComparison`, and `confidentlyDetectableFallacies`. The existing graph remains the audit surface and UI explanation.

### Source-grounded evidence

Evidence nodes are **source-grounded**: `ArgNode.citations?: EvidenceCitation[]` (`{ sourceName, homepage?, excerpt? }`). Judging prompts in both `src/lib/gemini.ts` and `src/lib/anthropic.ts` now require that every `cited`/`strong` evidence node carry ≥1 citation naming a **real institution or outlet** (root homepage only — never invent article URLs). `validateGraph()` enforces this: cited/strong evidence without citations is a validation error, shown in the UI as `⚠ no citation`. New helpers:

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
- **Judge invariance benchmark** — deterministic graph scoring verifies that swapping A/B ownership preserves every argument and inverts only the side label, while whitespace/verbosity changes do not buy points. Transcript fixtures still exercise the label-swap harness. Live-model invariance (run the real Gemini judge twice with shuffled framing and assert `winner` stability) belongs in a future `*.e2e.ts` suite — fixtures are reusable for it.

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

Live-model note: run the real Gemini/Anthropic judge twice per fixture with each transform and report `positionBias`, `nameBias`, `verbosityBias`, `confidenceBias`, `hallucinationRate` — keep fixtures in `benchmark.fixtures.ts` reusable and add a `scripts/judge-invariance-e2e.mjs` once an API key is provisioned.

## Known limitations / TODO before wider PvP

- **Elo/ranking stays gated by `eloGate`** (invariance + ≥70% human agreement) — matchmaking is FIFO until green. Tournament/challenge modes stay behind the same gate.
- Live-model judge invariance e2e (real Gemini calls) still needs an API key — fixtures + `judgeInvariance` transforms are ready for it.
- Article-level citation verification (fetch the URL and check the excerpt) is a future server action; the offline allowlist is the floor.

## Human-evaluation corpus population pipeline

The evaluation pipeline (six-dimension rubric, inter-rater reliability → comparison → calibration → bias) needs a real human-labelled corpus. Migration `008_corpus_pipeline.sql` plus `src/app/api/corpus/*` add the collection tooling:

- `POST /api/corpus/import` *(admin)* — imports finished solo/PvP debates as anonymised items: sides become "Side A"/"Side B", contributor identity and AI/user mapping stay server-side (`corpus_items.contributor_id` / `side_mapping`, never exposed to raters). Stratified by length bucket, topic category, and ability band.
- `GET/POST /api/corpus/rate` — blind rating: raters get the next open item they didn't author and haven't rated, submit six-dimension scores per side + winner + confidence; double-submission blocked by unique constraint; self-rating rejected.
- `GET /api/corpus/reliability` *(admin)* — human-human reliability FIRST: per-dimension ICC across raters, pairwise winner Cohen's κ, strata coverage (length × ability × subject), and an `agreementReady` count. Also reports **population progress** against target: total/fully-rated items vs the 500-item goal, remaining-to-target, mean rater confidence, and `cellsNeedingCoverage` — every length bucket and ability band below 30 items is named explicitly, including zero-coverage cells. System-vs-human accuracy is only meaningful over agreement-ready items.
- `POST /api/corpus/adjudicate` *(admin)* — settles disputed items by rater majority or explicit override.

Set `CORPUS_ADMIN_EMAILS` to enable admin endpoints (closed when unset). Until this corpus is populated and humans agree with each other, the evidence registry's status stands: scoring evidence remains synthetic-only.

Raters use **`/rate`** in the app: blind transcript, six-dimension 1–5 scoring per side, winner + confidence + rationale. Admins run the campaign from **`/corpus-admin`**: population progress vs the 500-item target (with named strata needing recruitment), per-dimension ICC, the adjudication queue (transcript + anonymised rater verdicts; accept-majority or override), and a one-click system comparison. Once items are `agreementReady`, `POST /api/corpus/system-comparison` judges them with the live ensemble and reports winner agreement against human consensus. That number (plus ≥70% agreement on a large corpus) is what eventually un-gates ranked play; until then it stays synthetic-only in the evidence registry.

## PvP reliability

- One turn per `(match, player, round)` enforced by a DB unique index (008), backing the API's concurrency guards.
- Turn timestamps (`pvp_matches.turn_started_at`) power late-submission rejection (>30 min) and forfeit claims (`POST /api/pvp/[matchId]/forfeit`) so abandoned matches resolve without fabricating a judge score.
- The room resyncs on focus/tab-visible and falls back to snapshot polling if Realtime drops; stress suites fuzz source verification + moderation (they caught and killed a ReDoS in link-spam detection).

## Roadmap

- [`docs/roadmap.md`](docs/roadmap.md) — evaluation corpus, judge bias benchmarks, and the gated path to ranked/tournament/classroom play.

