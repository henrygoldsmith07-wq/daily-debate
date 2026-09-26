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
| `repairRetest.ts`, `repairRetestServer.ts` | Repair → deliberate next-debate retest policy; opportunity-aware release back to generic coaching |
| `sprint.ts` | Sprint/full format rules and measurement honesty |
| `challengeMe.ts` | Explainable side assignment |
| `argumentRepair.ts` | Repair target selection, structural repair paths + deterministic rewrite scoring |
| `friendChallenge.ts` | Async invite codes/expiry/turn notes |
| `productEvents.ts` | Allowlisted funnel events (silent on failure) |
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

## Data model (migrations 001–020)

Standard Postgres tables: `app_users`, `app_sessions`, `profiles`, `daily_topics`, `solo_debates` (+ `format`, `coaching`), `solo_debate_turns` (with `assessment` jsonb), `pvp_queue`, `pvp_matches`, `pvp_turns`, `rate_limits`, `benchmark_corpus`, `match_appeals`, `reports`, `corpus_items`, `corpus_ratings`, `drill_assignments`, `topic_evidence`, plus 004's `repair_results`, `challenge_invites`, `product_events`. Hand-written row types live in `src/lib/backend/database.types.ts`. Migration 015 extends `ai_call_log` with bounded structural-routing fields: taxonomy version, batch/input counts, route, fallback/ambiguity counts, and expensive judge legs avoided.

### Repair retest invariant

A persisted repair does not merely change copy. Every **successful** repair remains in the transfer-test queue until a later, different-topic debate genuinely exposes that target metric; newer repairs never erase older unresolved ones. Failed attempts remain retryable practice history and never unlock retest state. Today, Progress, the drill coach and solo-debate start derive the same pending queue and deliberately surface the **oldest unresolved** repair first so work cannot starve behind newer successes. The repaired debate cannot satisfy its own retest. Failed-but-observable retests count as tested, while no-opportunity debates keep only that repair pending. The debate stores `coaching.repairRetest` provenance so result/replay surfaces can distinguish deliberate retests from coincidental focus selection. Solo start also stores categorical `coaching.degradationReasons` when ledger, repair-queue or drill-outcome context is temporarily unavailable; the debate remains usable, while Ops Health reports the runtime degradation instead of interpreting a missing goal as intentional.

## Reliability & security

- **Convergent PvP matchmaking**: migration 020's `join_pvp_queue_and_match()` serializes join/enqueue/claim per topic, so simultaneous first-time joiners converge instead of both waiting forever. A cross-role trigger takes deterministic player advisory locks and rejects any active match sharing either player, including player_a ↔ player_b role swaps; the older partial indexes remain a same-column backstop.
- **Owned Postgres/auth**: scrypt password hashing, hashed session tokens, server-side session checks; the proxy does no DB/network work.
- **Rate limiting**: Postgres-backed `increment_rate_limit()`, shared across instances; in-memory fallback for guest mode.
- **Turn claiming**: solo turns and debate completion claim atomically (`update ... where status = 'active'` / `.is("user_message", null)`); concurrent losers get 409, never double points.
- **Provider fallback**: `withProviderFallback` retries with backoff then fails over; schema validation on every AI response; `aiTelemetry` logs outcomes.
- **Moderation & anti-cheat**: high-severity content blocking, repeat-turn rejection, length caps.
- **Compensating deletes**: a failed opening deletes the empty debate so the dashboard never links a dead end.
- **Graceful guest mode**: without `DATABASE_URL` the app runs a local guest loop.

## Testing

- **Unit**: `npm test` — all pure modules including sprint rules, coaching goal, challenge-me, repair targets, result snapshot, confidence differences, progress summary math.
- **DB integration**: `*.db.test.ts` run when `TEST_DATABASE_URL` is set (CI provisions ephemeral Postgres): matchmaking convergence/cross-role invariants and boolean enqueue results, migration 004–020 schema/constraints (coaching loop, session ids, AI log, enqueue boolean), jsonb array storage shape, repair persistence, invite lifecycle.
- **E2E**: Playwright against a production build with `E2E_MOCK_AI=1` — PvP flows, full-debate flow, and the Sprint → weakness → repair loop.
- **Benchmarks**: deterministic judge invariance on every test run; live-model weekly with gates.
