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

## Scheduled jobs

- **Topic generation** (`topic-generation.yml`, daily 02:00 UTC): requires the `DATABASE_URL` repository secret; `--check-config` fails fast with `config-failure` when it is absent or unreachable (never a silent success). After configuration, verify with a manual `workflow_dispatch`, then confirm the next scheduled run; re-runs for the same target date are idempotent (one row per date, provenance stored, evidence bounded).
- **Judge benchmark** (`judge-benchmark.yml`, weekly): needs at least one provider key secret. Free-tier providers enforce per-day request caps — a run landing on a depleted quota honestly reports `INSUFFICIENT DATA` / provider-reliability FAIL and is appended to `docs/judge-benchmark-attempts.json` without overwriting the last valid record.
