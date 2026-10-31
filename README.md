# Daily Debate

One focused debate. One clear weakness. One immediate repair. One measurable improvement over time.

## What

Daily Debate is a daily reasoning trainer built around one loop:

1. **Debate** — a Daily Sprint (3 rounds, ~4 min) or a Full Debate (5–12 rounds) against an AI opponent.
2. **One weakness** — the result screen leads with a single highest-priority weakness, evidenced from your argument graph, not a wall of analytics.
3. **Repair now** — **Fix this now** opens a one-minute, server-scored rewrite exercise on the exact flagged move.
4. **Remember** — coaching goal, side history, and repair outcomes persist between sessions.
5. **Test again** — the next debate carries the same focus and assesses whether you demonstrated the target behaviour.
6. **Measure** — Progress shows seven skill dimensions with simple trends; improvement claims stay observational until enough debates exist.

Guests get the same loop deterministically, without an account or any network call, before signing up.

## Why

Practice quality beats practice volume. The product deliberately optimises the
smallest complete loop and measures whether it works before adding anything
else. Validation is published, not implied: as of the latest benchmark run **no
benchmarked judge clears the quality gates** (Groq, Cerebras and Gemini have no
benchmark row yet), so every training-loop number is unvalidated
and competitive claims stay behind `eloGate` — see
[docs/status.md](docs/status.md) for the honest numbers and
[docs/roadmap.md](docs/roadmap.md) for what is active (proving the loop) versus
parked (corpus, benchmarks, classrooms, tournaments, ranked play).

## Stack

Next.js (App Router) + a repository-owned Postgres/auth backend + free-tier AI only: the opponent, summaries, topics and PvP judge run over OpenAI-compatible free tiers (UnoRouter → Groq → Cerebras → Gemini → NVIDIA → OpenRouter). Each call fails over model by model and then provider by provider until one returns a schema-valid answer, so a rate-limited free tier does not take the product down. There is no paid provider. The app talks to standard Postgres through the Neon serverless driver.

## Run

1. Create a standard Postgres database (a pooled Neon/Vercel Postgres URL is recommended for serverless deployments).
2. Run `npm install`, copy `.env.example` to `.env.local`, and set `DATABASE_URL` plus at least one AI provider key. Configure the password-reset email variables before relying on account recovery.
3. Run `npm run db:migrate && npm run dev`.

## Deploying to Vercel

The Vercel project must point its **Root Directory** at the repository root (this is a standalone repo) with the framework preset left on **Next.js**.

Requests run through the Next.js 16 proxy in `src/proxy.ts`. The proxy only checks for the app's signed-in session cookie; it performs no database or third-party network work, so a backend outage cannot crash Vercel Routing Middleware. Without `DATABASE_URL`, `/` remains available in guest mode, `/login` explains that sign-in is unavailable, and protected pages redirect there.

**Previews must never share the production database.** Scope `DATABASE_URL` to **Production only**; point Preview (and local Development) at their own database — the Vercel–Neon integration can create a Neon branch per preview automatically, or set a dedicated `DATABASE_URL` override for the Preview environment. Sharing one URL across environments lets a preview build run migrations against production and leak preview writes into prod data. Redeploy after setting variables:

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Server-only pooled Postgres connection string. Never expose it with a `NEXT_PUBLIC_` prefix. |
| `UNOROUTER_API_KEY` / `GROQ_API_KEY` / `CEREBRAS_API_KEY` / `GEMINI_API_KEY` / `NVIDIA_API_KEY` / `OPENROUTER_API_KEY` | at least one (production) | Free-tier AI providers, tried in that order. Set as many as you can: each extra key is another fallback when a free tier is rate-limited. With none, solo debates, PvP judging and daily topics show an explicit "AI unavailable" state (daily topics fall back to the curated bank). `<LABEL>_DISABLED=1` removes one without deleting its key. |
| `<LABEL>_MODEL` / `<LABEL>_FALLBACK_MODELS` | optional | Per-provider model chain (e.g. `GROQ_MODEL`). Defaults and priority order live in `config/ai-providers.json`, shared by the app, the benchmark and topic generation. Free rosters change often; override when a provider retires a default. A provider that answers 429 is skipped by later requests until its Retry-After passes. The model that actually served is stamped into every verdict. |
| `AI_DAILY_SPEND_CAP_USD` | optional | Daily AI spend cap, default `10`; `off` disables. When hit: opponent/judge degrade to an explicit retryable unavailable state (never silent). |
| `AI_SPEND_UNCOSTED_CALL_USD` | optional | Declared charge for each call with no recorded cost (classifier.dev), default `0.02`. Free-tier provider calls are logged at $0 unless the provider reports a cost. |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | optional | Web Push reminders. Generate with `npx web-push generate-vapid-keys`; subject is `mailto:` or `https:`. All three unset = no opt-in shown, nothing sent. |
| `PUSH_DISPATCH_SECRET` | optional | ≥32 characters; protects `POST /api/push/dispatch`. Set the same value as the `PUSH_DISPATCH_SECRET` repository secret; the hourly `push-dispatch` workflow calls the URL in the `PROD_HEALTH_URL` variable. |
| `CLASSIFIER_DEV_ENABLED` | optional | `1` sends argument texts to classifier.dev. Default off everywhere until the service is disclosed in the privacy policy. |
| `NEXT_PUBLIC_EXPERIMENTAL_SURFACES` | optional | `1` re-enables the parked surfaces in navigation (PvP, friend challenges, voice input, corpus-validation pages). Default off — see [docs/status.md](docs/status.md). |
| `OPENROUTER_MODEL` | optional | Defaults to `nvidia/nemotron-3-super-120b-a12b:free`. |
| `OPENROUTER_FALLBACK_MODELS` | optional | Comma-separated failover chain. Defaults to free Nemotron 3 Super then Ultra. Empty string pins to one model. |
| `CORPUS_ADMIN_EMAILS` | optional | Leave unset to keep the corpus endpoints closed. |
| `RESEND_API_KEY` | required for password reset | Server-only Resend API key. Reset requests report the service unavailable when email delivery is not configured. |
| `PASSWORD_RESET_FROM` | required for password reset | Verified sender, for example `Daily Debate <accounts@yourdomain.com>`. |
| `APP_BASE_URL` | recommended | Canonical public origin used in reset links, for example `https://debate.example.com`. Vercel production URL is used as a fallback. |

After setting `DATABASE_URL`, run `npm run db:migrate` locally against the same database before deploying authenticated features.

**Deploys migrate themselves.** Production builds run pending migrations before `next build` (see `scripts/vercel-build.mjs`); a failed migration fails the build so the previous deployment stays live. Preview builds skip migrations unless `MIGRATE_ON_PREVIEW=1` is set for a preview-scoped database. Check ledger state any time with `npm run db:status` (non-zero exit while migrations are pending); `npm run db:policy` enforces the expand/contract rule (destructive SQL needs a `-- destructive-ok: <reason>` marker).

## Tests

- `npm test` — unit + regression suite (fully offline; DB invariant tests also run when `TEST_DATABASE_URL` is set).
- `npm run test:e2e` — Playwright against an ephemeral Postgres with `E2E_MOCK_AI=1`; includes PvP, full-debate, and the Sprint → weakness → repair loop.
- `npm run benchmark:judges` — live-model judge benchmark (weekly in CI).

## Documentation

| File | Contents |
|---|---|
| [docs/status.md](docs/status.md) | Feature status with honest labels, validation notice, capability map, model-call costs |
| [docs/product.md](docs/product.md) | The daily loop, Sprint vs Full, coaching goal, repair, screen-by-screen hierarchy |
| [docs/judging.md](docs/judging.md) | Argument graph, observable assessment, scoring policy, judge ensemble + invariance |
| [docs/evidence.md](docs/evidence.md) | Source grounding, citation verification, quote + claim-to-source matching |
| [docs/validation.md](docs/validation.md) | Measurement honesty, confidence labels, benchmarks, corpus, what stays provisional |
| [docs/architecture.md](docs/architecture.md) | Pipeline, data model, reliability, security, testing |
| [docs/roadmap.md](docs/roadmap.md) | Prove-the-loop scorecard, active backlog, parked surfaces, gating rule |
