# Validation: what the numbers are allowed to claim

Daily Debate distinguishes five kinds of statement. Every surface is expected to respect these boundaries.

1. **Observable behaviour** — counts recomputed from the stored argument graph (claims, rebuttals, drops, contradictions, cited evidence). Fully determined, auditable.
2. **Model-extracted structure** — the graph nodes themselves were extracted by a model. The assessment carries `extraction.source`, `confidence`, and `uncertainty` records, and `insufficient_evidence` is returned rather than scoring an empty structure.
3. **Deterministic scores** — the 0–100 score and the seven skill dimensions are pure functions of the graph under a versioned policy (`SCORING_ENGINE_VERSION`, `evaluationEnvelope` stamps). Reproducible, not yet *validated*.
4. **Provisional heuristic confidence** — ensemble-judge confidence, score-gap bands, and judge splits are heuristics over 1–2 judge scores. Never gated on, never described as calibrated.
5. **Externally validated claims** — none yet. Human-agreement and calibration numbers require the rated benchmark corpus; until then, scoring evidence stays synthetic-only.

## Telemetry privacy posture

AI call telemetry (`ai_call_log`) never stores raw provider error text. Every failure is reduced by `classifyAiError` to bounded fields — `error_category` (rate_limit / auth / invalid_request / timeout / network / server / invalid_response / unknown), `error_code`, HTTP status, retryable — plus a sanitised, truncated diagnostic with credentials and response bodies stripped (enforced again at the `recordAiCall` boundary, so even a misbehaving caller cannot leak raw text). Database persistence of telemetry is **best-effort** (fire-and-forget mirror, not guaranteed delivery); the structured log drain is the guaranteed record. Product funnel events follow the same rules: allowlisted names, bounded context, no free text.

## Session length and confidence

- **Full debate (5–12 rounds)**: standard confidence; the generic extraction caveats apply.
- **Daily Sprint (3 rounds)**: explicitly **reduced confidence** — the result screen prints *"Sprint read: a 3-round session is a small sample. Treat this as practice signal, not a measurement of your ability."* (`measurementHonestyFor` in `src/lib/sprint.ts`).

Sprints feed the skill ledger (3 rounds still contain observable behaviour) but are noted as noisier in "How this was calculated".

## Insufficiency and uncertainty

- `insufficient_evidence` is a first-class outcome for debates and PvP verdicts; the legacy numeric fields are not a valid comparison in that state.
- Uncertainty lists (extraction issues, validation warnings, missing structure) are stored and displayed in the full analysis.
- "Too close to call" tie handling uses a 5-point threshold; PvP ties can be genuine, not forced.

## Progress claims

- Skill scores need ≥3 debates before the low-confidence flag lifts; trajectories need more.
- Improvement claims stay observational until 10 debates; causal claims wait for the rated corpus (`minimumForClaims`).
- Trend arrows on Progress are descriptive (improving / steady / slipping / not enough data), never predictive.
- Repair effectiveness (`src/lib/repairEffectiveness.ts`) is presence-based comparison across a 30-day window with ≥5-repair/≥3-measurable thresholds before any rate is claimed — and even then it is labelled an association, not causation.
- Repair kinds without a deterministic detector (clarity) are **not currently measurable** by construction, and weakness detection is side-scoped: opponent fallacies/contradictions never count against the user, and dropped arguments are read directionally (`DroppedArgument.owner` is the side whose argument went unanswered — a user's failure is opponent-owned entries, i.e. arguments the user left unanswered).
- Rebuttal semantics have ONE canonical implementation (`src/lib/opportunity.ts`): an opportunity is an opponent claim/counterclaim with a later turn to answer it; a valid target must exist, belong to the opponent, be a rebuttable kind, and predate the response (`isValidRebuttalTarget`); an answer must be chronologically valid; coverage is answered/eligible. Rewards, the skill ledger, turn scoring, weakness detection and the result story all read these definitions — no self-targets, future targets, dangling ids or malformed edges can earn credit anywhere, and evidence trails list exactly the nodes used in each calculation.
- Databases are sorted explicitly by completion time inside the measurement: "first retest" means the chronologically earliest eligible debate, never query order. All other analytics use order-independent aggregation (min/max/set membership).
- Product funnel rates (`src/lib/productFunnel.ts`) need a ≥5-user sample; D1/D7 return excludes users without a full window (pending, never churned). Completion is reported both per user and per debate session — a session-tagged event stream (migration 005) keeps the two from being conflated, and session coverage is printed rather than assumed.
- Hard report limits are probed, not hidden: every capped source (events, repairs, debate graphs) reports records loaded, the configured limit, and which metrics the cap can distort.

## Data-type honesty

PostgreSQL `numeric` columns (`before_score`, `attempt_score`, `movement`, rater `confidence`, judge-health gates) arrive as strings through node-postgres. The database/client boundary (`backend/sql.ts`) converts them to JS numbers once, for both transports — so sums, means, thresholds, and `typeof` filters downstream see real numbers. This ended a class of silent bugs (e.g. `meanRaterConfidence` was always null because string confidences failed the number filter).

## Benchmarks and gates

- Deterministic invariance + grounded-evidence benchmarks run on every `npm test` (offline).
- Live-model judge benchmarks run weekly with hard gates (`config/judge-gates.json`); breaches fail the run.
- The corpus campaign (1,000 debates × 3 blind ratings) is the path to human-validity claims; `/metrics` shows dashes, never placeholders, until minimum samples exist.
