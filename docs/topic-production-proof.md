# Topic production proof (manual → idempotence → scheduled)

Scheduling is proven only when all four hold independently in ops health
(`/ops-health`, `Production proofs` row backed by `assessTopicSlo`):

- `manualSuccess` — a real `workflow_dispatch` run of `topic-generation.yml`
  completed with `success` against the production database.
- `idempotenceRerun` — ≥2 successful `topic_run_log` rows share the same
  `target_date` (same-date rerun: exactly one `daily_topics` row, evidence
  replaced not accumulated, provenance consistent, freshness green).
- `scheduledSuccessAfterManual` — a real `schedule` run succeeded with
  `createdAt` later than the manual success. CI (`topic-pipeline`) and
  `workflow_dispatch` runs never count toward this fact.
- `onTimeBeforeDeadline` — tomorrow's topic is stored and a telemetry row for
  that date completed before the 03:00 UTC deadline with freshness passing.

## Rerun procedure (same target date)

1. `gh workflow run topic-generation.yml` (manual success).
2. Immediately rerun the same workflow for the same target date; the pipeline
   is idempotent (`ON CONFLICT (topic_date) DO UPDATE`, evidence
   delete-then-insert capped at 3, cycle-boundary target dates, guarded
   freshness target).
3. Verify: exactly one `daily_topics` row for the date, no duplicate evidence,
   valid `generation_source`, verifier green, workflow green.
4. Evidence persists per run in `topic-run-evidence-*` artifacts
   (`scripts/topic-run-evidence.mjs` maps the flat generator/verifier files —
   never wrapped `.generator.*` paths), in `topic_run_log`
   (`scheduled_for`, `run_created_at`/`started_at` distinct, scheduler vs
   queue delay, `generator_result`, `provider_health`, freshness verdict), and
   in `topic-telemetry-fallback.json` when the database itself is unreachable.

## Availability vs provider health

A stored curated fallback is a topic-availability success (`provider-failure`
outcome, `source=fallback`) but never provider health: `generator_result`
(`ai` | `fallback-after-provider-failure` | `fallback-by-policy` | `failure`)
and `provider_health` (`success` | `invalid-response` | `timeout` |
`rate-limit` | `authentication` | `quota` | `other`) are derived per run in
`scripts/record-topic-run.mjs` from the outcome plus the generator's own
`providerError`, with per-model `providerAttempts` (outcome + latency)
attached on both the success and failure legs.
