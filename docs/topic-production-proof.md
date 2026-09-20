# Topic production proof (manual → idempotence → scheduled → AI)

Scheduling is proven only when all six hold independently in ops health
(`/ops-health`, `Production proofs` row backed by `assessTopicSlo`):

- `databaseReachable` — the production topic store is readable from this
  runtime. Nothing below is evaluated without it.
- `manualSuccess` — a real `workflow_dispatch` run of `topic-generation.yml`
  completed with `success` against the production database.
- `scheduledSuccessAfterManual` — a real `schedule` run (`event=schedule`)
  succeeded with `createdAt` later than the manual success. CI
  (`topic-pipeline`) and `workflow_dispatch` runs never count toward this fact.
- `sameDateContentIdempotence` — at least two separate successful,
  freshness-verified attempts share the same `targetDate`, the same
  non-null canonical topic fingerprint, and the same generator semantics.
  Two bare successes are NOT sufficient: under write-once semantics the
  second run verifies rather than rewrites, so only matching fingerprints
  prove the content is stable.
- `onTimeBeforeDeadline` — tomorrow's topic is stored and verified content
  for that date completed before the actual 03:00 UTC deadline
  (`freshness_ok=true`, not merely "not false").
- `aiGeneratedProductionSuccess` — a real production run returned a valid AI
  candidate that was stored with non-empty sources surviving the JSONB
  round-trip, and the freshness verifier passed for it. Curated fallback
  keeps availability when this is false; it never stands in for this fact.

## Write-once retries

Once a valid topic exists for a date, retry-ladder runs verify it and return
`already-present` with the existing metadata (title, fingerprint, evidence
count) instead of regenerating. The `UNIQUE(topic_date)` constraint
serialises concurrent retries: losers of the claim race re-read the winner
and converge. The only path that changes stored content is the deliberate
repair path for invalid or fingerprint-mismatched rows, which always replaces
evidence atomically with the new revision.

## Rerun procedure (same target date)

1. `gh workflow run topic-generation.yml` (manual success).
2. Immediately rerun the same workflow for the same target date; the second
   run must report `outcome=already-present` with the identical fingerprint.
3. Verify: exactly one `daily_topics` row for the date, matching fingerprints
   in both runs' `topic-run-evidence-*` artifacts, valid `generation_source`,
   evidence all stamped with the current revision fingerprint, verifier green,
   workflow green.
4. Evidence persists per run in `topic-run-evidence-*` artifacts
   (`scripts/topic-run-evidence.mjs` maps the flat generator/verifier files —
   never wrapped `.generator.*` paths), in `topic_run_log`
   (`scheduled_for`, `run_created_at`/`started_at` distinct, scheduler vs
   queue delay, `generator_result`, `provider_health`, `topic_fingerprint`,
   bounded `provider_attempts`, freshness verdict), and in
   `topic-telemetry-fallback.json` when the database itself is unreachable.

## Availability vs provider health

A stored curated fallback is a topic-availability success (`provider-failure`
outcome, `source=fallback`) but never provider health: `generator_result`
(`ai` | `fallback-after-provider-failure` | `fallback-by-policy` | `failure`)
and `provider_health` (`success` | `invalid-response` | `timeout` |
`rate-limit` | `authentication` | `quota` | `other`) are derived per run in
`scripts/record-topic-run.mjs` from the outcome plus the generator's own
`providerError`, with per-model `providerAttempts` (provider, model, outcome,
latency, HTTP status, error category) attached on both the success and
failure legs. Provider-level failover tries every usable provider's model
chain in priority order; providers without capacity (no key, explicitly
disabled, or kiraai without `KIRAAI_ENABLED=1`) are skipped, never called.
