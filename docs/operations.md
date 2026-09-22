# Operations: scope audit, reliability budgets, backup & recovery

## Scope audit (keep / simplify / merge / hide / remove)

Every surface judged against the core loop — **Open → Debate → Detect weakness → Repair → Retest → Measure improvement → Return**.

| Surface | Decision | Rationale |
|---|---|---|
| Today (dashboard) | **Keep, dominant** | The single entry point; Sprint CTA first, Full Debate secondary |
| Daily Sprint | **Keep** | The fast loop; reduced-confidence labelling honest |
| Full Debate | **Keep** | The deep read; standard confidence |
| Result screen | **Keep, simplified** | One strength, one weakness, one repair; score secondary |
| Weak-link repair | **Keep, primary action** | The loop's pivot; server-scored, persisted, coach-linked |
| Progress (7 skills) | **Keep, simplified** | Trends + focus; raw metrics behind disclosure |
| Coach drills | **Keep** | Same focus-selection policy as the Today goal; repair links into it |
| Challenge me | **Keep** | Lightweight, explainable side assignment |
| PvP + async challenges | **Keep, frozen scope** | Works; competitive claims gated until judge validation |
| History | **Keep** | Replay uses result hierarchy |
| Trust & research, /metrics | **Keep (evidence surfaces)** | Honest validation reporting; not user-loop surfaces |
| Leaderboard | **Frozen** | Visible but no Elo/ranked expansion until gates pass |
| Argument DNA | **Frozen** | Longitudinal view; no expansion until retention proven |
| Debate modes (speech/rapid/prepared) | **Kept, de-emphasised** | Optional composer affordances, not loop-critical |
| Classroom/team tooling | **Removed (code)** | No runtime references; scope-discipline cut |
| Tournaments, appeals, share text, retention quests, async transcripts | **Removed (code)** | Gated/future modules with zero non-test imports; resurrect from git when gated |
| `guest practice loop` | **Keep** | Zero-setup entry to the loop |

Removals are code-deletions (recoverable from git history), not disabled flags.

## Reliability engineering (in place)

- **CI gate**: lint → typecheck → unit + DB-invariant tests → build → `npm audit` (critical blocks) → authenticated Playwright E2E over a production build with ephemeral Postgres (`DATABASE_URL` provided to migration/seed scripts).
- **Migrations**: sequential SQL files, `app_migrations` ledger, statement-splitter tolerant of comments/dollar-quoting; `npm run db:migrate`.
- **Concurrency**: atomic turn claiming (`.is("user_message", null)`), atomic debate completion (`status = 'active'`), atomic PvP matchmaking (`FOR UPDATE SKIP LOCKED`), atomic invite claim (`status = 'open'`), DB unique constraints as backstops.
- **AI failures**: `withProviderFallback` (retries with backoff → model failover chain → optional second provider when configured), schema validation on every response, moderation gates, compensating deletes for dead debates.
- **Observability**: `aiTelemetry` ring buffer + structured log lines + durable `ai_call_log` (migration 006); product funnel events with user/session ids; admin views `/analytics`, `/metrics`.
- **Security**: scrypt password hashing, hashed session tokens, server-only DB access, SSRF-guarded source retrieval, moderation + length caps, admin allowlist gates, rate limits on every mutating route.

## Performance budgets

| Path | Budget | Rationale |
|---|---|---|
| Today page (server render) | ≤ 1 DB-roundtrip batch + ledger build | TopicCard + profile render from one `Promise.all` |
| Debate turn | p95 ≤ 6s wall (model-bound) | Composer shows thinking state; provider timeout 60s with failover |
| Finish debate | p95 ≤ 8s wall (summary + assessment) | Result screen streams after atomic completion |
| Bundle: first load JS | Next.js default budget; no new client libs added in this pass | Tailwind + React only |
| Ledger build | ≤ 100 debates × per-debate assessment merge | `buildLedgerForUser` caps at 100 |

Budgets are aspirational until request-timing instrumentation lands; the `ai_call_log` p95s are the first measured input.

## Backup & recovery (owned Postgres)

- **Backups**: use the provider's automated daily backup + PITR (Neon/Vercel Postgres both provide this). Verify a restore into a scratch database monthly: `pg_restore`/branch-restore, run `npm run db:migrate -- --check` against it, boot the app with `DATABASE_URL` pointed at the restore.
- **Recovery runbook**:
  1. Stop writes (pause deploys).
  2. Restore latest backup / PITR timestamp before the incident.
  3. Verify: `SELECT count(*) FROM solo_debates;` row counts match pre-incident expectations; run the DB invariant test suite with `TEST_DATABASE_URL` pointed at the restore.
  4. Redeploy with restored `DATABASE_URL`; spot-check Today, one replay, one PvP room.
- **Schema recovery**: migrations are the source of truth; a fresh database plus `npm run db:migrate` reproduces the schema.
- **Secrets**: none stored in the database; rotating provider keys requires no data work.

## Corpus integrity runbook

The blinded human corpus is the future ground truth for the judge, so its state is guarded by explicit invariants:

- `npm run check:corpus` (`scripts/check-corpus-invariants.mjs`) fails on impossible states: open items at/over the rating threshold, closed items below it, `rating_count` drift, duplicate `(corpus_id, rater_id)`, contributor self-ratings, malformed `presented_first`/winner values, incomplete correction audit events, and broken correction chains. CI runs it against real Postgres after the DB suite and again after the E2E suite.
- `npm run repair:corpus [-- --apply]` fixes historical closure drift safely: dry-run first (reports ids/counts), only flips `open -> rated` where the actual count meets the threshold, only syncs `rating_count` to reality, never deletes or edits ratings, idempotent.
- Real-Postgres concurrency coverage lives in `src/lib/corpusRatingStore.db.test.ts` (runs in CI via `TEST_DATABASE_URL`): threshold closure, simultaneous final raters, post-closure rejects, rollback atomicity, correction audit chains.

## Branch protection (main)

Enforced by repository ruleset `protect-main` (Settings → Rules → Rulesets, id 23355071), enforcement ACTIVE, **no bypass actors** — it applies to admins and owner accounts equally:

```text
main protection (ruleset protect-main, id 23355071, enforcement=active)
  ├─ require pull request before merge        (0 approving reviews; stale reviews dismissed on push)
  ├─ required status checks (strict, pending counted):
  │    verify          ← the "Daily Debate" workflow verify job (lint/type/unit+DB+scripts/build/audit)
  │    e2e             ← authenticated Playwright over a production build + corpus invariants
  │    topic-pipeline  ← real-Postgres generation idempotency + freshness verifier
  ├─ no branch deletion, no force push (non_fast_forward), no creating refs matching main
  └─ bypass: NONE for humans (admins and the owner included - the ruleset rejects direct pushes
     to main with GH013, and rejects merges before the required checks conclude; both verified live)
```

The check contexts above are the actual job ids in `.github/workflows/daily-debate.yml` — GitHub enforces those names, not "the workflow usually runs". The merge path is squash/merge/rebase (all allowed). Deliberately NOT enabled: the ruleset "restrict updates" rule — it treats every merge as an update and would lock all PRs out of main; the PR requirement plus required checks already make direct mutation impossible.

**Automated benchmark artifacts**: the weekly judge-benchmark workflow cannot push to main. It commits `docs/judge-*` refreshes to a `chore/judge-benchmark-*` branch, opens a PR, and merges it only after `verify` / `e2e` / `topic-pipeline` pass on that PR. A gate breach still marks the benchmark job red (weekly visibility) while the honest artifact PR flows through the same checks product code faces. Bot convenience goes through protection, never around it.

Emergency changes: the repo owner edits or disables the ruleset in the web UI (deliberate, audited action), then re-enables.

## Topic production SLO

Two INDEPENDENT dimensions, reported separately and combined by worst-of into
the ops-health status (`assessTopicSlo`):

**Scheduler reliability** (run history of topic-generation.yml; CI never counts):
healthy / degraded (1–2 consecutive scheduled failures) / failed (≥3
consecutive) / stale (>36h without any scheduled attempt finishing) /
unknown (never executed here).

**Topic availability** (production store content, deadline-enforced):
ready / pending-before-deadline (before 03:00 UTC, absence is NORMAL, not a
breach) / **missed-deadline (S1 BREACH after 03:00 UTC — immediate failed,
not waiting for the 36h stall detector)** / invalid (row exists but freshness
verification failed) / unknown (production store unreadable).

Overall = worst of the two severities. Example: one failed run with tomorrow
missing at 12:00 UTC reports `Scheduler: DEGRADED`, `Availability:
MISSED-DEADLINE`, overall FAILED — run history and content state stay
separable.

Definitions: **S1** tomorrow's topic stored by 03:00 UTC; **S2** exactly one
valid row per date (`UNIQUE(topic_date)` + post-write verifier); **S3** no
orphan evidence, bounded count; **S4** AI-failure-with-stored-fallback is
acceptable, not a breach; **S5** repeated scheduled failures escalate the
scheduler dimension as above.

Ops health also reports the **production proofs**: a successful manual
(`workflow_dispatch`) run and a subsequent successful **scheduled** run after
it — production scheduling is proven only when both exist. Each run persists
structured evidence (run id, event, target date, generator outcome,
provenance, topic count, evidence count, freshness verification, duration,
final result) to its step summary and a `topic-run-evidence-*` artifact, so
SLO state is auditable rather than inferred from the current DB row alone.

The target date is resolved from the **15:00 UTC cycle boundary**
(`resolveTargetDate` in `scripts/generate-topics.mjs`), not a raw clock+24h:
all four evening slots (and any dispatch before 15:00) target the day after
the most recent boundary. This is what makes a delayed slot recover: a 23:40
slot that starts at 02:00 still targets the same tomorrow — inside the
recovery window ahead of the 03:00 deadline — instead of silently advancing
to the next cycle. The freshness verifier's default date follows the same
rule, so a bare re-verification during a delayed run checks the right date.

## Scheduled jobs

- **Topic generation** (`topic-generation.yml`): six attempts on one retry ladder - 20:00, 21:30, 22:45, 23:40 UTC the previous evening, then 00:15 and 02:15 UTC post-midnight - all targeting the SAME tomorrow-date, because GitHub scheduled starts have been observed 4-5+ hours late and the 03:00 UTC availability SLO must survive that. The 02:15 slot doubles as the final availability verification before the deadline. Topics are WRITE-ONCE per date: the first valid write wins and later slots verify it (`already-present`) instead of regenerating. Healthy retries are READ-ONLY; the only content-replacing path is deliberate corruption repair, which runs as ONE transaction (topic update + evidence rebuild + revision-ownership invariant, COMMIT/ROLLBACK) so intermediate states like new-topic-plus-old-evidence can never be observed. **Legacy evidence is untrusted**: evidence with a NULL topic_fingerprint has unknown revision ownership (this production served Topic A's cards under an overwritten Topic B), so healing a legacy row preserves the topic content, writes the canonical fingerprint, and REBUILDS evidence for the current topic - zero cards is a valid outcome; unknown cards are never stamped. The config gate FAILS FAST (`config-failure`) when migration 018's fingerprint schema is missing - no generation attempt burns a retry slot on a schema-known failure. The 15:00 UTC cycle boundary keeps post-midnight slots on the SAME date until the deadline passes, then the next evening slot advances to the next cycle. Requires the `DATABASE_URL` repository secret; `--check-config` fails fast with `config-failure` when it is absent, unreachable, or schema-incomplete. Each run records durable telemetry to `topic_run_log` (scheduledFor, actual start, scheduler delay, completedAt, duration, target date, generator outcome, generator result, provider health, content fingerprint, bounded provider attempts, freshness, result) - scheduler delay, generator failure and availability failure are separately-reported facts; a late platform start is never counted as a generator failure. The workflow artifact additionally carries the EXACT triggering slot (`cronSlot`, `scheduledFor`, `schedulerDelayMs`) so the second-witness never has to infer the slot from the nearest clock time (which understated a 125-min delay as 35 min).
- **Canonical topic persistence**: every durable `daily_topics` write in the app goes through one write-once helper (`insertCanonicalTopicOnce` in `src/lib/dailyTopic.ts`): `INSERT ... ON CONFLICT (topic_date) DO NOTHING`, full canonical shape (topic_date, title, prompt, category, sources, generation_source, generation_reason, topic_fingerprint). The overwrite-style `storePreGeneratedTopic` was removed; the request-time fallback path persists through the same helper as `request-time-fallback`. The in-memory emergency fallback stays write-free and proof-free.
- **generation_reason** (migration 019): `generation_source` says WHAT the content is (ai | fallback); `generation_reason` says HOW it was created (ai | fallback-provider-failure | fallback-policy | request-time-fallback). An `already-present` retry READS the stored reason and reports it unchanged - it never reconstructs or mutates it. The freshness verifier rejects unknown reasons and flags rows missing a reason on a migrated database.
- **Public health probe** (`GET /api/health`): unauthenticated, non-sensitive reduction of the ops-health report (coarse states + proof booleans only — no titles, no counters; `src/lib/healthProbe.ts`, `dynamic = "force-dynamic"`, `no-store`, rate-limited). The deployed app is an independent witness of production state: its service-key DB view does not depend on the Actions `DATABASE_URL` secret whose absence caused the 2026-09 outage.
- **Ops-alert digest** (`ops-alert.yml`, daily 04:00 UTC - just after the deadline, so it judges the completed cycle): turns topic-pipeline health into a GitHub issue (`ops-alert` label) so a broken pipeline is a notification, not something someone must notice on a dashboard. Evidence: GitHub run history + the public health probe (repo variable `PROD_HEALTH_URL`, default the production domain) — the workflow deliberately holds NO database secret. Critical on scheduled failures, missed-deadline/invalid availability, an unreadable store, or a failed run with no later success (config-gate suspect); warning when the probe or proofs are unavailable; auto-closes the issue when everything is provably fine. Judgement is unit-tested in `scripts/lib/ops-alert.mjs`; probe freshness/coherence rules in `src/lib/healthProbe.ts`.
- **Second-witness delay telemetry**: `topic_run_log` stays the primary delay source, but when the production DB is unreachable - exactly when "platform late vs database down" matters most - ops health derives delays from GitHub run history. The workflow artifact's EXACT slot fields (`cronSlot`, `scheduledFor`, `actualCreatedAt`, `actualStartedAt`, `schedulerDelayMs`) are preferred evidence; nearest-clock-slot inference is only a last resort because it understates large delays (a 20:00 trigger created at 22:05 is a 125-min delay, not the 35 min a 21:30-slot guess reports). DB rows always win where both exist. Witness rows never claim availability facts; those stay DB-backed.
- **Ops-alert stage awareness**: failure alerts classify the failed STAGE from evidence (failed workflow step name via the jobs API, the probe's migration-018 readiness flag) into configuration | migration/schema | provider | generation | database write | freshness verification | telemetry | unknown. Alert text reports `stage = ..., reason = ...` - the legacy "config/db gate is the prime suspect" line only appears, labelled as a suspect, when no stage evidence exists. A config=pass / generation=pass / freshness=FAIL run (the migration-018 production pattern) is therefore reported as a freshness-verification failure with the migration named, not guessed.
- **Production proofs** (all six on ops health, required before "scheduling works"): database reachable, successful manual run, later successful scheduled run, same-date content idempotence (matching fingerprints from separate verified attempts), one on-time freshness-verified write before the deadline, and one real AI-generated production success. See `docs/topic-production-proof.md`.
- **Judge benchmark** (`judge-benchmark.yml`, weekly): needs at least one provider key secret. Free-tier providers enforce per-day request caps — a run landing on a depleted quota honestly reports `INSUFFICIENT DATA` / provider-reliability FAIL and is appended to `docs/judge-benchmark-attempts.json` without overwriting the last valid record.
