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
- Claim-to-source support is positive only when attached source text substantively matches the claim. Missing source text is **unverified**, weak/mismatched overlap is not counted as grounded coverage, and source-name plausibility alone never becomes support.
- Uncertainty lists (extraction issues, validation warnings, missing structure) are stored and displayed in the full analysis.
- "Too close to call" tie handling uses a 5-point threshold; PvP ties can be genuine, not forced.

## Progress claims

- Skill scores need ≥3 debates before the low-confidence flag lifts; trajectories need more.
- Improvement claims stay observational until 10 debates; causal claims wait for the rated corpus (`minimumForClaims`).
- Trend arrows on Progress are descriptive (improving / steady / slipping / not enough data), never predictive.
- Drill `attempt_score` is an internal deterministic formative rubric only. Learner-facing drill feedback shows observable signals, not the 0–100 value; improvement is claimed only from later debate observations.
- Repair effectiveness (`src/lib/repairEffectiveness.ts`) is presence-based comparison across a 30-day window with ≥5-repair/≥3-measurable thresholds before any rate is claimed — and even then it is labelled an association, not causation.
- Repair kinds without a deterministic detector (clarity) are **not currently measurable** by construction, and weakness detection is side-scoped: opponent fallacies/contradictions never count against the user, and dropped arguments are read directionally (`DroppedArgument.owner` is the side whose argument went unanswered — a user's failure is opponent-owned entries, i.e. arguments the user left unanswered).
- Rebuttal semantics have ONE canonical implementation (`src/lib/opportunity.ts`): an opportunity is an opponent claim/counterclaim with a later turn to answer it; a valid target must exist, belong to the opponent, be a rebuttable kind, and strictly predate the response (`isValidRebuttalTarget`); a valid answer must also have an owned response node of a permitted kind over a permitted relation (`isValidRebuttalResponse`); coverage is answered/eligible. Strong-material credit is reserved for valid counterclaim targets. Rewards, the skill ledger, turn scoring, weakness detection and the result story all read these definitions — no self-targets, future/same-round targets, dangling ids, invalid response nodes, or malformed edges can earn credit anywhere, and evidence trails list exactly the nodes used in each calculation.
- Databases are sorted explicitly by completion time inside the measurement: "first retest" means the chronologically earliest eligible debate, never query order. All other analytics use order-independent aggregation (min/max/set membership).
- Product funnel rates (`src/lib/productFunnel.ts`) need a ≥5-user sample; D1/D7 return excludes users without a full window (pending, never churned). Completion is reported both per user and per debate session — a session-tagged event stream (migration 005) keeps the two from being conflated, and session coverage is printed rather than assumed.
- Hard report limits are probed, not hidden: every capped source (events, repairs, debate graphs) reports records loaded, the configured limit, and which metrics the cap can distort.
- **Measurement readiness is separate from outcome quality.** Training-effectiveness evidence reports a measurement state (insufficient / measurable / stale / invalid) — whether the sample can support a metric at all — and lists observed outcomes (first-retest recurrence with n, median opportunities to recurrence) as observations with denominators. No observed value, good or bad, is encoded into operational-health colour; a high recurrence rate does not make the section "unhealthy", a low one does not make it "healthy". A user with more follow-up debates had more opportunities to recur and is never classified as worse for it — the per-retest and first-three measures are opportunity-adjusted by construction.

## Data-type honesty

PostgreSQL `numeric` columns (`before_score`, `attempt_score`, `movement`, rater `confidence`, judge-health gates) arrive as strings through node-postgres. The database/client boundary (`backend/sql.ts`) converts them to JS numbers once, for both transports — so sums, means, thresholds, and `typeof` filters downstream see real numbers. This ended a class of silent bugs (e.g. `meanRaterConfidence` was always null because string confidences failed the number filter).

## Benchmarks and gates

- Deterministic invariance + grounded-evidence benchmarks run on every `npm test` (offline).
- Live-model judge benchmarks run weekly with hard gates (`config/judge-gates.json`); breaches fail the run. Gate thresholds are fixed; new gates may only strengthen, never weaken, existing ones.
- **Sample gates**: every probe (position mirror, names, verbosity, style, prestige, whitespace, false citation, hedging, confident tone, ideological framing, political topic) publishes expected calls, usable calls, failed calls, completion ratio, minimum usable sample, measured value, and a PASS / FAIL / **INSUFFICIENT DATA** state. A probe below its minimum sample (half the pack) can never pass; failed calls stay in the denominators. The scoring rules live in `scripts/lib/judge-eval.mjs` (unit-tested by `npm run test:scripts`).
- **Provider reliability gate**: each judge must return usable data for ≥ 75% of attempted benchmark calls. This is a production-validation floor, distinct from model quality: a judge failing it is a transport problem (timeout / 4xx / 5xx / malformed responses — classified in `classifyProviderError`), not a quality verdict, and a small surviving sample can never qualify it.
- **Failure diagnostics**: every failed gate publishes affected fixtures, probe type, baseline vs perturbed verdicts, winner changes, score and confidence deltas, and provider errors — grouped into accuracy (wrong winner / tie handling), calibration (over/under-confidence by bin), invariance (side order / name / verbosity / style / prestige / formatting), and provider reliability. Full detail lives in `docs/latest-judge-benchmark.json` (`results[].diagnostics`).
- **Benchmark state truthfulness**: `docs/latest-judge-benchmark.json` and the leaderboard hold only the latest VALID run (at least one judge with usable data). Every run — including total outages — is appended to `docs/judge-benchmark-attempts.json`; an outage never overwrites the last real validation record, and stale rows never accumulate into the current leaderboard.
- The corpus campaign (1,000 debates × 3 blind ratings) is the path to human-validity claims; `/metrics` shows dashes, never placeholders, until minimum samples exist.

## Judge improvement protocol (controlled experiments)

- **One variable, always.** Prompt changes run as named experiments in `scripts/lib/judge-experiments.mjs`, each altering exactly one material instruction (arms today: `baseline` control, `citation-zero-weight` [REJECTED], `grounding-two-pass` [architecture]). Non-prompt architectures (two-pass evidence grounding; later ensembles, deterministic+qualitative splits, calibrated post-processing) enter as explicit experiment arms — complexity ships only when the benchmark pays for it, measured including latency and token cost.
- **Pre-registered decisions.** Each study has a sealed registration (`docs/judge-experiments/registrations/`) fixing hypothesis, target metric + minimum improvement margin + noise rule, protected metrics + maximum tolerated regression, runs per arm, minimum usable provider reliability and the adoption rule — all BEFORE any run. The runner computes the verdict from the registration's own numbers; outcomes are marked **supported / rejected / inconclusive** (never re-bricked after seeing data), and the registration hash is recorded in the study.
- **Full-pack, interleaved, repeated.** Arms run SERIALIZED and INTERLEAVED (`A,B,A,B,…` via `scripts/judge-study.mjs`) — never concurrently against rate-limited providers; each arm is preceded by a live quota probe, and a failed probe stops the study cleanly and resumably under the same seal. Inference uses ONLY runs clearing the registered reliability floor, and the registered runs-per-arm count is a hard requirement: fewer usable runs is always **INCONCLUSIVE**, never a reduced-power verdict. Excluded runs remain visible in the raw evidence with their exclusion reason.
- **Next experiment from aggregate evidence, never one metric.** Selection priority (2026-09): fixture/human agreement, calibration/ECE, fake-citation sensitivity, position invariance, name invariance, verbosity robustness. Repeatedly optimizing one metric while another regresses is a rejection, not a trade.
- **No fixture targeting.** Experiments are adopted only on whole-pack improvement; arms that fix one fixture while moving aggregate metrics are rejected. Difficult fixtures stay in the pack.
- **Adoption bar.** An arm replaces the default only if it improves its target metric without materially regressing agreement, ECE, position, names, verbosity, style, prestige, whitespace or provider reliability — the protected set. Adoption then flows through the normal CI: prompt bump, `PROMPT_VERSION` bump, green application checks, artifact PR merge.
- **Attribution baked in.** Every benchmark artifact carries `versions`: prompt version + hash, experiment name/hypothesis, fixture-pack hash, scoring-engine and graph-schema versions, gates hash, retry policy. Fixture labels are benchmark infrastructure, NOT human ground truth.

## Human-ratings immutability

Corpus ratings are **append-once**: the first submission for `(corpus_id, rater_id)` is accepted; any second submission is rejected with 409, never silently overwritten. The insert and the open→rated closure run in one locked statement (`src/lib/corpusRatingStore.ts`): the item row is `FOR UPDATE`-locked, and closure uses the row's persisted `rating_count` (migration 013) incremented under that lock — snapshot counting of rows cannot see ratings committed by racing transactions, the counter can. Closed items (rated / adjudicated / rejected) refuse new ratings at insert time, and two simultaneous final raters serialise so the item closes at exactly the required count (the loser is rejected and simply rates another item). Real-Postgres concurrency tests (`corpusRatingStore.db.test.ts`) prove every case. Corrections go through the admin-only `/api/corpus/correct` path, which requires a reason and appends a **self-contained** audit event — timestamp, actor, reason, complete `before` and `after` states — preserving the original record for end-to-end auditability (migration 012); each event's `before` must equal the previous event's `after`, and CI enforces it. Adjudication merges its consensus into the item's existing `side_mapping` instead of replacing provenance. Nine corpus consistency invariants (`npm run check:corpus`) gate CI against real Postgres, and `npm run repair:corpus` repairs historical closure drift safely (dry-run default, never destructive, idempotent).
