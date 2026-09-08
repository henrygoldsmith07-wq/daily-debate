# Product: the daily loop

The product is organised around one loop:

> **Debate → identify one important weakness → repair it immediately → remember the weakness → deliberately test it in a future debate → measure whether it improved.**

Everything else (argument graphs, evidence audit, tracking grids, metric trajectories) exists to serve that loop and is hidden behind progressive disclosure.

## Screen hierarchy rule

Across every screen:

**User action first → coaching second → explanation third → technical detail last.**

## Today

- The motion, with today's coaching goal ("Answer the strongest opposing argument before adding another claim."), plus the evidence line from the previous debate when one exists.
- **Daily Sprint · ~4 min** is the primary button. **Full debate · 5–12 rounds** is the quieter secondary option.
- Side picker: For / Against / **Challenge me** (see below).
- Evidence cards stay available under a collapsed "Browse verified evidence" section.

## Daily Sprint vs Full Debate

| | Daily Sprint | Full Debate |
|---|---|---|
| Rounds | 3 (cap = min) | 5 minimum, 12 cap |
| Time | ~4 minutes | 10–20 minutes |
| Pipeline | same argument/evaluation pipeline | same |
| Result | one insight + one repair, **reduced measurement confidence** | complete analysis, standard confidence |

Start-screen copy is explicit about the format: *"Three focused rounds with directional feedback. Full Debate provides deeper analysis."*

Sprint results say so plainly: *"Sprint read: a 3-round session is a small sample. Treat this as practice signal, not a measurement of your ability."* Implementation: `src/lib/sprint.ts`.

## Result screen

Default view shows only:

1. Goal outcome (✓ / →, with the observed count).
2. **You did well** — one strength, grounded in the debate ("You directly responded to 3 of 3 opposing arguments.").
3. **Main weakness** — one highest-priority miss ("2 important claims had no supporting evidence") plus why it matters in plain language.
4. **FIX THIS NOW** — the primary action. It scrolls **directly to the repair exercise**; Full Analysis is not expanded automatically.
5. Score + XP, secondary.
6. **View full analysis** — collapsed: model feedback lists, argument graph, tracking grid.

Replays of finished debates render the same hierarchy server-side (strength, weakness, repair status, score, collapsed analysis), so a revisit never dumps the graph back on the user.

## Weak-link repair

`Fix this now` opens a one-minute exercise that:

- targets the most consequential observable miss from the finished debate (unsupported claim → fallacy → contradiction → unanswered move → missing impact → clarity);
- quotes the user's actual argument;
- gives a specific instruction;
- is scored server-side against observable moves (deterministic rubric — practice feedback, not a verdict);
- explains what worked / what to add;
- is **persisted** in `repair_results` with success flag and signals;
- **links into coaching**: a repair on the day's drill dimension marks that drill attempted, feeding the next coaching decision.

The debate's own score never changes.

## "Challenge me"

A third side option that picks for the user, with the reasoning shown:

- No/minimal history → random.
- Heavy side dominance (≥75% of last 8) → the other side (variety + steelmanning).
- Clear performance gap (≥8 points, ≥2 debates each side) → the weaker side.
- Otherwise → alternate from the last debate.

Every outcome carries a plain-language reason ("You've argued FOR in 7 of your last 8 debates — switching to AGAINST for variety and steelmanning practice."). Deliberately lightweight; never described as optimised. Implementation: `src/lib/challengeMe.ts`.

## Progress

Default view: the seven skill dimensions (Evidence, Rebuttal, Logic, Clarity, Impact, Steelmanning, Structure), each with score and a simple trend arrow (↑ improving / → steady / ↓ slipping / · not enough debates), strongest + weakest area, and the current training focus with a one-click practice action.

Behind **How this was calculated**: metric trajectories, per-debate slopes, the fixed benchmark comparison, and honest caveats (direction per metric, sprint noise, observational-only claims).

## Coaching loop

1. The ledger's weakest dimension (movement-adjusted, shared with the drill system — one selection policy, not two) becomes today's goal on the Today screen.
2. The goal travels with the debate (`solo_debates.coaching.dimension`).
3. At finish, the goal behaviour is assessed against the graph and persisted (`snapshot`, `demonstrated`).
4. The result screen reports it; the next day's goal accounts for it.

Goals are numeric only where previous behaviour justifies precision ("Answer at least 4 of 5" needs ≥3 opportunities last debate; otherwise the goal stays qualitative).

## Analytics

Privacy-conscious funnel events (`src/lib/productEvents.ts`, migration 004): allowlisted names only, bounded context, no free text, no device identifiers, silent no-op for guests. Captured: `daily_viewed`, `debate_started`, `sprint_started`, `full_debate_started`, `round_completed`, `debate_completed`, `repair_started`, `repair_completed`, `full_analysis_opened`, `progress_viewed`, `pvp_started`, `challenge_me_selected`, `challenge_link_created`, `challenge_link_accepted`.

Funnel semantics: `repair_started` is the click on **Fix this now** (client-side); `repair_completed` is a server-confirmed submission — so start/completion can be compared honestly.

### Admin funnel report (`/analytics`, admin-gated)

Computed from `product_events` by `src/lib/productFunnel.ts` and served at `/api/analytics/funnel`:

- Today → debate start rate;
- Sprint vs Full completion (by format);
- repair start/completion rate;
- D1/D7 return (with pending-user counts — users without a full window are never counted as churned);
- full-analysis open rate;
- Challenge Me usage, broken down by which rule fired;
- friend-challenge creation/acceptance.

Rates below a 5-user sample render as "not yet measurable" instead of small-n noise.

### Does repair work? (`src/lib/repairEffectiveness.ts`)

For each completed repair, the same weakness kind's presence is compared across the user's debates in the 30-day window before vs after the repair:

```text
weakness detected → repair completed → next relevant debates → improved / unchanged / worse
```

- Excludes the repaired debate itself; only debates that could actually express the weakness count.
- No later debates → "not yet measurable"; no earlier debates → "insufficient baseline". Nothing is silently dropped.
- A per-kind rate is only claimed with ≥5 repairs and ≥3 measurable — otherwise the report says "not yet claimable".
- The output is labelled observational: an association with the repair, not proof of causation.

## Async friend challenges

`POST /api/challenges` creates a shareable invite code on today's motion; the friend opens `/challenge/<code>`, accepts (sign-in required), and the pre-created PvP match routes them in. No simultaneity: the challenger opens, the opponent responds whenever. Match state persists in the normal PvP tables; invites expire after 7 days and claim atomically. The transcript replays through the existing PvP room. This is a foundation — the flow is functional but marked experimental.
