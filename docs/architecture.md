# Architecture

## Pipeline

One pipeline, stable typed interfaces between stages. No parallel scoring or coaching subsystems.

```text
Transcript
    ↓
Structural routing (classifier.dev, versioned multi-label roles)
    ↓
Specialised deterministic checks (evidence / rebuttal / response / lightweight)
    ↓
Argument extraction (model; per turn)
    ↓
Observable features (deterministic recomputation — observableAssessment.ts)
    ↓
Evidence verification (citationVerifier, quoteVerification)
    ↓
Scoring policy (versioned weights → score, status, components)
    ↓
Coaching interpretation (skillLedger → adaptiveCoach → coachingGoal/resultSnapshot)
    ↓
User-facing explanation (Today, result screen, Progress, DNA)
```

## Key modules

| Module | Role |
|---|---|
| `argGraph.ts` | Graph types + pure helpers + validation |
| `argumentTaxonomy.ts`, `argumentRouting.ts` | Versioned rhetorical-role labels, classifier.dev batching/confidence policy, route selection, and routing telemetry |
| `observableAssessment.ts` | Feature extraction, scoring policy, insufficiency rules |
| `argumentEvaluation.ts` | Engine findings: overclaims, fake precision, rebuttal/steelman quality, deterministic structural checks |
| `evidenceVerification.ts`, `citationVerifier.ts`, `quoteVerification.ts` | Evidence grounding and verification |
| `skillLedger.ts`, `skillLedgerServer.ts` | Longitudinal metric vectors and trajectories |
| `adaptiveCoach.ts` | 7-dimension profile, focus selection, drills, attempt scoring |
| `coachingGoal.ts`, `resultSnapshot.ts` | The daily goal, goal outcome and one-weakness result story |
| `repairRetest.ts`, `repairRetestServer.ts` | Repair → deliberate retest queue; durable `repair_retests` assignment/outcome state, topic eligibility and opportunity-aware completion |
| `coachingContextServer.ts` | Shared best-effort coaching context for Today, Progress, drill assignment and solo start; explicit ok/partial/unavailable states |
| `sprint.ts` | Sprint/full format rules and measurement honesty |
| `challengeMe.ts` | Explainable side assignment |
| `argumentRepair.ts` | Repair target selection, structural repair paths + deterministic rewrite scoring |
| `friendChallenge.ts` | Async invite codes/expiry/turn notes |
| `productEvents.ts` | Allowlisted funnel events (silent on failure) |
| `productFunnelServer.ts`, `aiOpsServer.ts` | Admin analytics loaders with explicit complete/partial/unavailable semantics; never convert read failure into zero activity |
| `backend/*` | Owned Postgres/auth: sessions, query builder, rate limits |

Structural routing is rhetorical only: it never labels a viewpoint as true,
correct, preferable, or the winner. Low-confidence, `other`, unknown, and
fallback classifications keep the existing ensemble path open. The graph
assessment and judge remain authoritative when they disagree with a routing
hint. Routing telemetry stores counts and decisions, never submitted text.

### Classifier.dev: external processing, traffic sampling, and evaluation

The structural classifier is the only component that sends submitted text to
an external processor (classifier.dev, `POST /v1/classify`; keyless per-IP
free tier). Request/response handling is verified against the service's live
OpenAPI contract (see the "classifier.dev API contract" tests in
`argumentRouting.test.ts`): versioned multi-label taxonomy, `tier`
fast/smart, `multi` with a two-label cap, calibrated confidences, and
defensive parsing — length mismatches, `unscored` rows, and withheld
confidences all degrade to the local fallback, which can never take a
judge-avoidance route.

What leaves the boundary per call: argument texts truncated to
`CLASSIFIER_DEV_MAX_INPUT_CHARS` (4,000) characters, plus the motion title
and prompt (context for the off-topic label only). Never sent or stored:
debate ids, user ids, winners, scores, or political/correctness judgements —
the classification instructions explicitly exclude truth, ideology, and which
side should win.

What is stored: `ai_call_log` keeps bounded operational fields only
(input/batch counts, route, fallback/ambiguity counts, avoided judge legs,
sanitised error codes); `judge_verdict.shadowRouting` keeps bounded
per-debate metadata (role counts, winners, scores, size/round buckets).
Neither stores raw debate text.

Traffic control: judged PvP debates are hash-sampled
(`CLASSIFIER_SHADOW_SAMPLE_RATE`, default 25% — see `shadowSampling.ts`)
before any remote call. Sampling is uniform over a stable debate key, so gate
denominators stay unbiased while external calls drop by roughly three
quarters. Non-sampled debates take the local fallback path and never enter
shadow denominators. Human-grounded corpus runs and live solo shaping are not
sampled. Adoption gates (`route-adoption-gates-v1`, sealed in
`docs/route-registrations/v1`) are unchanged by any of this.

Evaluation: `ARGUMENT_ROLE_EVAL_DATASET` (60 labelled paragraphs: five per
role plus ten mixed-role) with precision/recall/F1, confusion matrix,
confidence calibration (ECE), latency, fast-vs-smart comparison, and
shadow-route agreement in `rhetoricalRoleEvaluation.ts`, all covered by
`rhetoricalRoleEvaluation.test.ts`.

## Data model (migrations 001–032)

Standard Postgres tables: `app_users`, `app_sessions`, `profiles`, `daily_topics`, `solo_debates` (+ `format`, `coaching`, durable result/finalization fields), `solo_debate_turns` (with `assessment`, `training_meta`, and response-window timestamps), `pvp_queue`, `pvp_matches`, `pvp_turns`, `rate_limits`, `benchmark_corpus`, `match_appeals`, `reports`, `corpus_items`, `corpus_ratings`, `drill_assignments`, `topic_evidence`, plus 004's `repair_results`, `challenge_invites`, `product_events` and 025's durable `repair_retests`. Hand-written row types live in `src/lib/backend/database.types.ts`. Migration 026 adds per-turn training metadata. Migration 027 adds retry-safe finalization, exact persisted result payloads, and atomic rewards/retest completion. Migration 028 adds server-issued timed-mode windows and atomic solo-turn advancement. Migration 029 stages accepted user submissions before any external AI call, adds tokenized opponent-generation leases, records non-resettable per-mode response windows, and moves authoritative turn timing plus finalization lease refreshes entirely onto the PostgreSQL clock. Migration 030 closes the turn/finish state machine: finalization is a hard barrier, only the current pending turn can be claimed, the legacy migration-028 advancement RPC is removed, profile timezone is persisted, and streak-day selection uses the database clock in that IANA timezone. Migration 031 makes recovery self-healing: stale finalization leases are reclaimed by turn/timer work and scheduled cleanup, a durably staged answer can be committed as the final answered round when the minimum length is met, solo round numbers are unique in PostgreSQL, and compact performance/bonus fields are stored directly on `solo_debates`. Migration 032 hardens that recovery layer: timed-window mutation locks the debate before its turn so Finish cannot cross the timer barrier, and compact-result backfill accepts only safely parseable payload values before falling back to scored turns.

### Repair retest invariant

A persisted repair does not merely change copy. Every **successful** repair is identified by its stable `repair_results.id`. Migration 025 persists each deliberate assignment in `repair_retests`, including the assigned debate and eventual `observable` / `demonstrated` outcome. A repair remains pending until it has a durable completed assignment with `observable=true`; completion therefore cannot disappear when an old debate falls outside the bounded skill-ledger window. A completed but unobservable assignment leaves the repair eligible for another later transfer test. Before a newer assignment is inserted, an older unfinished assignment for that repair is rolled forward as completed/unobservable, so an abandoned prior-topic debate cannot permanently block transfer testing. Database uniqueness still prevents one debate from serving two repairs and keeps at most one open assignment per repair under concurrency. The shared coaching-context loader selects the **oldest pending repair eligible on the current topic**. `solo_debates.coaching.repairRetest` remains the per-debate provenance copy and migration 025 backfills legacy assignments from it; while legacy debates remain in the ledger window, the loader reconciles observable outcomes into durable state. Solo start also stores categorical `coaching.degradationReasons` when ledger, repair-state or drill-outcome context is temporarily unavailable; Today, Progress and coach APIs consume the same `ok` / `partial` / `unavailable` context rather than inventing empty coaching data.

## Reliability & security

- **Convergent PvP matchmaking**: migration 020's `join_pvp_queue_and_match()` serializes join/enqueue/claim per topic, so simultaneous first-time joiners converge instead of both waiting forever. A cross-role trigger takes deterministic player advisory locks and rejects any active match sharing either player, including player_a ↔ player_b role swaps; the older partial indexes remain a same-column backstop.
- **Owned Postgres/auth**: scrypt password hashing, hashed session tokens, server-side session checks; the proxy does no DB/network work.
- **Rate limiting**: Postgres-backed `increment_rate_limit()`, shared across instances; in-memory fallback for guest mode.
- **Durable solo submissions**: migration 029 stages an accepted user answer before classifier/opponent-provider work. A tokenized generation lease prevents concurrent requests from duplicating model calls; provider failure releases only the lease, so the same staged answer can resume without re-entering or re-beating a timed deadline. Finalizing the staged answer, optional next AI turn, and `round_count` is one transaction.
- **Server-clock timed modes**: per-round response windows are issued and validated with PostgreSQL `clock_timestamp()`. Each timed mode keeps its first window for that round, so switching Text → Rapid cannot reset an expired Rapid attempt. Migration 032 makes timer work follow the same debate → turn lock order as submission/finalization and starts a fresh database-clock timestamp only after lock acquisition. The browser receives a remaining duration and converts it to a local countdown without comparing wall clocks.
- **Durable finalization**: migration 027 claims completion with a lease, persists the exact result payload, and commits debate completion, profile rewards/streaks, coaching state and repair-retest outcome atomically. Migration 030 acquires that barrier before transcript loading. Migration 031 lets turn/timer work atomically clear an abandoned stale finalization lease and extends scheduled maintenance to clear stale finalization/submission leases, so a crashed serverless request cannot strand an active debate.
- **Saved-response completion**: once a response has been durably staged, provider failure never forces the user to discard it. If that accepted response brings the debate to its minimum length, the user may finish with the saved response; PostgreSQL commits that staged answer as the final answered round without creating another opponent turn, then the normal deterministic finalizer runs.
- **Round identity**: `solo_debate_turns` now has a database `UNIQUE (debate_id, round_number)` constraint in addition to turn-bound request IDs. The state-machine assumption is therefore enforced by storage, not only application code.
- **Turn identity + idempotency**: every solo submission names the exact pending turn it answers. A stale tab gets a conflict rather than having its old draft attached to a newer round; retrying the identical request for an already-committed turn replays the committed result.
- **Rate limiting**: authenticated solo turn, timer and finish actions use per-user primary buckets plus looser secondary IP abuse ceilings so unrelated users behind one NAT do not share the normal action budget.
- **Performance vs XP**: solo performance is the mean deterministic turn score normalized to 0–100, making 5- and 12-round debates comparable. Migration 031 persists `performance_score` and `bonus_xp` as compact columns. Migration 032 repairs the historical backfill without unsafe JSON casts or requiring scored turns when a valid persisted performance already exists; genuinely unavailable legacy performance stays unknown rather than becoming a synthetic zero. History never needs to load full assessment JSON just to render these numbers.
- **Timezone semantics**: profile timezone is initialized from the browser's IANA zone at account creation (or once for older UTC-default accounts on sign-in) and then treated as stable profile state. Streaks and per-user daily drills use that stored local day. The globally shared Daily Topic deliberately remains keyed to UTC so every user sees one canonical motion for the same pipeline date.
- **Timed-mode reloads**: an unsubmitted Rapid/Prepared attempt hydrates from the persisted `response_mode` and re-reads the original server window after reload; reloading never silently falls back to Text or resets the timed attempt.
- **Provider fallback**: `withProviderFallback` retries with backoff then fails over; schema validation on every AI response; `aiTelemetry` logs outcomes.
- **Moderation & anti-cheat**: high-severity content blocking, repeat-turn rejection, length caps.
- **Compensating deletes**: a failed opening deletes the empty debate so the dashboard never links a dead end.
- **Graceful guest mode**: without `DATABASE_URL` the app runs a local guest loop.

## Testing

- **Unit**: `npm test` — all pure modules including sprint rules, coaching goal, challenge-me, repair targets, result snapshot, confidence differences, progress summary math.
- **DB integration**: `*.db.test.ts` run when `TEST_DATABASE_URL` is set (CI provisions ephemeral Postgres): matchmaking convergence/cross-role invariants, migrations through 032, finalization idempotence, durable pre-provider submission staging/resume, non-resettable server-timed windows, atomic solo-turn advancement, jsonb storage shape, repair persistence and invite lifecycle.
- **E2E**: Playwright against a production build with `E2E_MOCK_AI=1` — PvP flows, full-debate flow, and the Sprint → weakness → repair loop.
- **Benchmarks**: deterministic judge invariance on every test run; live-model weekly with gates.
