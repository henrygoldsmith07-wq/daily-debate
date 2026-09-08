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

Sprint results say so plainly: *"Sprint read: a 3-round session is a small sample. Treat this as practice signal, not a measurement of your ability."* Implementation: `src/lib/sprint.ts`.

## Result screen

Default view shows only:

1. Goal outcome (✓ / →, with the observed count).
2. **You did well** — one strength, grounded in the debate ("You directly responded to 3 of 3 opposing arguments.").
3. **Main weakness** — one highest-priority miss ("2 important claims had no supporting evidence") plus why it matters in plain language.
4. **FIX THIS NOW** — the primary action.
5. Score + XP, secondary.

Behind **View full analysis**: overall feedback, strengths/improvements lists, the argument graph, the tracking grid, leaderboard link. Implementation: `src/lib/resultSnapshot.ts` builds the story from the merged observable assessment; `DebateRoom.tsx` renders it.

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

## Async friend challenges

`POST /api/challenges` creates a shareable invite code on today's motion; the friend opens `/challenge/<code>`, accepts (sign-in required), and the pre-created PvP match routes them in. No simultaneity: the challenger opens, the opponent responds whenever. Match state persists in the normal PvP tables; invites expire after 7 days and claim atomically. The transcript replays through the existing PvP room. This is a foundation — the flow is functional but marked experimental.
