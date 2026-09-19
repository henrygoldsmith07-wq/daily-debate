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
| `coachingGoal.ts`, `resultSnapshot.ts` | The daily goal and the one-weakness result story |
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

## Data model (migrations 001–015)

Standard Postgres tables: `app_users`, `app_sessions`, `profiles`, `daily_topics`, `solo_debates` (+ `format`, `coaching`), `solo_debate_turns` (with `assessment` jsonb), `pvp_queue`, `pvp_matches`, `pvp_turns`, `rate_limits`, `benchmark_corpus`, `match_appeals`, `reports`, `corpus_items`, `corpus_ratings`, `drill_assignments`, `topic_evidence`, plus 004's `repair_results`, `challenge_invites`, `product_events`. Hand-written row types live in `src/lib/backend/database.types.ts`. Migration 015 extends `ai_call_log` with bounded structural-routing fields: taxonomy version, batch/input counts, route, fallback/ambiguity counts, and expensive judge legs avoided.

## Reliability & security

- **Atomic PvP matchmaking**: `claim_pvp_match` uses `FOR UPDATE SKIP LOCKED`; partial unique indexes guarantee ≤1 active match per player.
- **Owned Postgres/auth**: scrypt password hashing, hashed session tokens, server-side session checks; the proxy does no DB/network work.
- **Rate limiting**: Postgres-backed `increment_rate_limit()`, shared across instances; in-memory fallback for guest mode.
- **Turn claiming**: solo turns and debate completion claim atomically (`update ... where status = 'active'` / `.is("user_message", null)`); concurrent losers get 409, never double points.
- **Provider fallback**: `withProviderFallback` retries with backoff then fails over; schema validation on every AI response; `aiTelemetry` logs outcomes.
- **Moderation & anti-cheat**: high-severity content blocking, repeat-turn rejection, length caps.
- **Compensating deletes**: a failed opening deletes the empty debate so the dashboard never links a dead end.
- **Graceful guest mode**: without `DATABASE_URL` the app runs a local guest loop.

## Testing

- **Unit**: `npm test` — all pure modules including sprint rules, coaching goal, challenge-me, repair targets, result snapshot, confidence differences, progress summary math.
- **DB integration**: `*.db.test.ts` run when `TEST_DATABASE_URL` is set (CI provisions ephemeral Postgres): matchmaking invariants and boolean enqueue results, migration 004–008 schema/constraints (coaching loop, session ids, AI log, enqueue boolean), jsonb array storage shape, repair persistence, invite lifecycle.
- **E2E**: Playwright against a production build with `E2E_MOCK_AI=1` — PvP flows, full-debate flow, and the Sprint → weakness → repair loop.
- **Benchmarks**: deterministic judge invariance on every test run; live-model weekly with gates.
