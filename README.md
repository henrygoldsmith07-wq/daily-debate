# Daily Debate

One focused debate. One clear weakness. One immediate repair. One measurable improvement over time.

Daily Debate is a daily reasoning trainer: argue today's motion against an AI opponent (in a ~4-minute Sprint or a full 5–12-round debate), get one clear coaching insight grounded in the arguments you actually made, repair your weakest link immediately, and watch whether the fix sticks across debates.

## Stack

Next.js (App Router) + a repository-owned Postgres/auth backend + OpenRouter (primary judge, default model `nvidia/nemotron-3.5-lightning:free` with automatic failover through the free Nemotron chain). The app talks to standard Postgres through the Neon serverless driver.

## The daily loop

The product is built around one loop:

1. **Debate** — a Daily Sprint (3 rounds, ~4 min) or a Full Debate (5–12 rounds).
2. **One weakness** — the result screen leads with a single highest-priority weakness, evidenced from your argument graph, not a wall of analytics.
3. **Repair now** — the **Fix this now** action opens a one-minute rewrite exercise on the exact flagged move. Scored server-side, remembered, and linked into coaching.
4. **Remember** — the coaching goal, side history, and repair outcomes persist between sessions.
5. **Test again** — the next debate carries the same focus; the result assesses whether you demonstrated the target behaviour.
6. **Measure** — the Progress screen shows seven skill dimensions with simple trends; improvement claims stay observational until enough debates exist.

## Feature status

Honest labels for what is shipped, provisional, or gated:

**Shipped**

- Daily Sprint (3 rounds) and Full Debate (5–12 rounds) through the same argument/evaluation pipeline.
- Simplified result screen: one strength, one weakness, one evidence line, **Fix this now**, score/XP secondary, full analysis behind progressive disclosure.
- Weak-link repair: server-scored rewrite of the flagged move, persisted in `repair_results`, linked to the day's drill assignment.
- "Challenge me" side assignment: explainable, history-based side choice (side balance → performance gap → alternation → random when no data). Lightweight by design — not presented as optimised.
- Daily coaching goal: shown before the debate, assessed after it, numeric only when the data supports the precision.
- Progress screen: seven skills (Evidence, Rebuttal, Logic, Clarity, Impact, Steelmanning, Structure) with score + trend, strongest/weakest, current focus; raw metrics behind "How this was calculated".
- Measurement honesty: Sprint results carry an explicit reduced-confidence note; `insufficient_evidence`, uncertainty lists, and evaluation stamps are preserved everywhere.
- PvP with atomic matchmaking, turn clocks, forfeits, judged verdicts with ensemble + fingerprints. Competitive trust claims stay conservative; the judge-validation gate is intact.
- Async friend challenges: shareable `/challenge/<code>` link, persistent match state, expiry, turn state. (Foundation; UI marked experimental.)
- Guest practice loop without an account.
- Product analytics: allowlisted, bounded, no-free-text funnel events (`src/lib/productEvents.ts`), with an internal admin report at `/analytics` covering the training funnel and observational repair-effectiveness measurement.

**Provisional (measured, not validated)**

- Skill scores and trends: deterministic and reproducible, but not yet validated against external measures of debating ability.
- Coach focus selection and drill-outcome movement.
- Ensemble-judge confidence heuristics.

**Gated / future**

- Ranked play, Elo expansion, tournaments: stay behind `eloGate` (judge invariance + ≥70% human agreement on a real corpus).
- Judge validation on live models: weekly benchmark runs (`npm run benchmark:judges`), gates in `config/judge-gates.json`.

## Documentation

| File | Contents |
|---|---|
| [docs/product.md](docs/product.md) | The daily loop, Sprint vs Full, coaching goal, repair, screen-by-screen hierarchy |
| [docs/judging.md](docs/judging.md) | Argument graph, observable assessment, scoring policy, judge ensemble + invariance |
| [docs/evidence.md](docs/evidence.md) | Source grounding, citation verification, quote + claim-to-source matching |
| [docs/validation.md](docs/validation.md) | Measurement honesty, confidence labels, benchmarks, corpus, what stays provisional |
| [docs/architecture.md](docs/architecture.md) | Pipeline, data model, reliability, security, testing |
| [docs/roadmap.md](docs/roadmap.md) | Evaluation corpus, judge bias benchmarks, gated path to ranked play |

## Setup

1. Create a standard Postgres database (a pooled Neon/Vercel Postgres URL is recommended for serverless deployments).
2. Run `npm install`, copy `.env.example` to `.env.local`, and set `DATABASE_URL` plus at least one AI provider key.
3. Run `npm run db:migrate && npm run dev`.

Authenticated users get the full daily-topic experience. Signed-out users get a local guest practice loop first, so the product can be evaluated before starting a debate account.

## Deploying to Vercel

The Vercel project must point its **Root Directory** at the repository root (this is a standalone repo) with the framework preset left on **Next.js**.

Requests run through the Next.js 16 proxy in `src/proxy.ts`. The proxy only checks for the app's signed-in session cookie; it performs no database or third-party network work, so a backend outage cannot crash Vercel Routing Middleware. Without `DATABASE_URL`, `/` remains available in guest mode, `/login` explains that sign-in is unavailable, and protected pages redirect there. Set the variables in **Settings → Environment Variables** for Production, Preview, and Development, run the migration against that database, then redeploy:

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Server-only pooled Postgres connection string. Never expose it with a `NEXT_PUBLIC_` prefix. |
| `OPENROUTER_API_KEY` | at least one of these | Primary judge when set; solo debates, PvP judging, and daily topics fail without any provider key. |
| `UNOROUTER_API_KEY` / `KIRAAI_API_KEY` / `BAI_API_KEY` | alternative judges | Free-model OpenAI-compatible transports tried in priority order (NVIDIA → OpenRouter → UnoRouter → Kirai → B.ai). |
| `OPENROUTER_MODEL` | optional | Defaults to `nvidia/nemotron-3.5-lightning:free`. |
| `OPENROUTER_FALLBACK_MODELS` | optional | Comma-separated failover chain. Defaults to free Nemotron 3 Super then Ultra. Empty string pins to one model. |
| `CORPUS_ADMIN_EMAILS` | optional | Leave unset to keep the corpus endpoints closed. |

After setting `DATABASE_URL`, run `npm run db:migrate` locally against the same database before deploying authenticated features.

## Tests

- `npm test` — unit + regression suite (fully offline; DB invariant tests also run when `TEST_DATABASE_URL` is set).
- `npm run test:e2e` — Playwright against an ephemeral Postgres with `E2E_MOCK_AI=1`; includes PvP, full-debate, and the Sprint → weakness → repair loop.
- `npm run benchmark:judges` — live-model judge benchmark (weekly in CI).
