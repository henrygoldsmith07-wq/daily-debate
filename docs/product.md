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

## Live debate

The default room keeps the normal daily rep focused: Text and Speech are immediately available, while Rapid Rebuttal and Prepared Speech sit behind **More modes**. Specialist formats remain accessible without making every capability compete for attention during a Sprint.

Turn submission is lossless under ordinary network failure. The composer keeps the exact draft until the server confirms the turn, disables itself locally while the request is in flight to reduce accidental double submission, and leaves a failed draft in place for one-click retry after connectivity returns.

## Result screen

Default view shows only:

1. Goal outcome (✓ / →, with the observed count).
2. **You did well** — one strength, grounded in the debate ("You directly responded to 3 of 3 opposing arguments.").
3. **Main weakness** — one highest-priority miss ("2 important claims had no supporting evidence") plus why it matters in plain language.
4. **FIX THIS NOW** — the primary action. It scrolls **directly to the repair exercise**; Full Analysis is not expanded automatically.
5. Length-normalized performance + cumulative XP, secondary.
6. **View full analysis** — collapsed: model feedback lists, argument graph, tracking grid.

Replays of finished debates render the same hierarchy server-side (strength, weakness, repair status, normalized performance, collapsed analysis), so a revisit never dumps the graph back on the user.

## Weak-link repair

`Fix this now` opens a one-minute exercise that:

- targets the most consequential observable miss from the finished debate (unsupported claim → fallacy → contradiction → unanswered move → missing impact → clarity);
- quotes the user's actual argument;
- gives a specific instruction;
- is scored server-side against observable moves (deterministic rubric — practice feedback, not a verdict);
- explains what worked / what to add;
- is **persisted** in `repair_results` with success flag and signals;
- **links into coaching**: a repair on the day's drill dimension marks that drill attempted, feeding the next coaching decision;
- retries remain raw practice history, but the latest retry refreshes the linked formative drill attempt so coaching never stays stuck on an abandoned first draft;
- if the user leaves after an unsuccessful rewrite, Today surfaces the newest unresolved repair with its formative state and an actionable cue so the core loop does not silently die between sessions.

Learner-facing repair checks use three formative states: **Needs another pass**, **Partially repaired**, and **Repair demonstrated**. The deterministic numeric rubric remains internal for compatibility and thresholds; it is not shown as a validated reasoning score. Rebuttal, evidence, logic and impact repairs require relationships between ideas rather than cue words alone, and every repair reminds the learner that the real test is later unprompted performance.

For longitudinal measurement, multiple rewrite submissions for the same user + debate + weakness kind are one **repair episode**. The first attempt anchors retry/conversion history, while the **first successful submission** anchors effectiveness and retest timing. Retries are preserved but cannot inflate repair denominators or create fake intervention cutoffs. A failed submission is practice history only: it stays retryable, does **not** count as repair completion, and does **not** unlock a deliberate next-debate retest.

The debate's stored performance read never changes; cumulative XP remains a separate reward quantity.

## Guest practice

Signed-out users get the same product philosophy in a deliberately lighter form:

1. three short responses to a fixed sample motion;
2. deterministic local checks of observable wording only: explicit claim, reasoning link, engagement with the opponent, impact comparison, and named evidence;
3. one concrete strength and one highest-priority missing move;
4. **Fix this now** with a rewrite of that move;
5. an account CTA only after the product has demonstrated the repair loop.

Guest analysis lives in `src/lib/guestAssessment.ts`. It does **not** assign a numeric debate/ability score, infer hidden reasoning quality, or claim validation. Trigger words alone are insufficient: a one-word “however” is not rebuttal, “matters more” is not impact comparison, and naming a source without explaining its relevance does not complete an evidence repair.

The guest result labels these checks as local observations, not measurement of debating ability. Responses stay client-side in this flow; they are not written to the authenticated product-event pipeline.

## "Challenge me"

A third side option that picks for the user, with the reasoning shown:

- No/minimal history → random.
- Heavy side dominance (≥75% of last 8) → the other side (variety + steelmanning).
- Clear performance gap (≥8 points, ≥2 debates each side) → the weaker side. Performance is normalized from cumulative turn points to a per-turn 0–100 scale first, so Sprint vs Full length cannot create the gap.
- Otherwise → alternate from the last debate.

Every outcome carries a plain-language reason ("You've argued FOR in 7 of your last 8 debates — switching to AGAINST for variety and steelmanning practice."). Deliberately lightweight; never described as optimised. Implementation: `src/lib/challengeMe.ts`.

## Progress

Default view: the seven skill dimensions (Evidence, Rebuttal, Logic, Clarity, Impact, Steelmanning, Structure), each with score and a simple trend arrow (↑ improving / → steady / ↓ slipping / · not enough debates), strongest + weakest area, and the current training focus with a one-click practice action.

Behind **How this was calculated**: metric trajectories, per-debate slopes, the fixed benchmark comparison, and honest caveats (direction per metric, sprint noise, observational-only claims).

## Drill feedback

Daily drills use a deterministic rubric internally so coaching can compare attempts consistently and diagnose whether the requested move appeared. That internal `attempt_score` is **not** shown as a learner ability score.

The learner sees:

- **Practice checked**;
- the bounded observable signals detected in the draft;
- an explicit note that the check is formative;
- later-debate movement as the only evidence that the skill changed.

This prevents a short drill from looking like a validated 0–100 measurement while preserving the existing diagnostic data used by coaching.

## Coaching loop

1. Normally, the ledger's weakest dimension (movement-adjusted, shared with the drill system — one selection policy, not two) becomes today's goal.
2. **A pending repair retest EXCLUDES its skill from the day's visible coaching.** It does not override it with transfer copy. The rule, its enforcement points and its tests live in `src/lib/retestDisclosure.ts`; see "The retest is a measurement, not a prompt" below.
3. A retest closes only when a distinct later debate was **explicitly assigned to that repair** and the durable `repair_retests` row completes with `observable=true`. `solo_debates.coaching.repairRetest` remains the per-debate provenance copy. A coincidental evidence/rebuttal/etc. reading from an unassigned debate cannot clear one or several repairs. A poor assigned reading still counts as a real retest; an assigned debate with no opportunity is recorded as completed/unobservable and leaves that repair eligible for another deliberate test. Starting a newer deliberate test rolls an abandoned older open assignment to completed/unobservable so an old topic cannot block the queue forever.
4. Same-day drill handling is conservative: reading Today/Progress is side-effect free. A proposed drill is only created or retargeted after the learner explicitly starts it with the coaching command endpoint. An unattempted drill may then be retargeted to a new repair focus, but an already-attempted drill is preserved as history rather than rewritten.
5. The goal travels with the debate (`solo_debates.coaching.dimension`). At finish, the result snapshot receives that dimension, assesses the observable goal behaviour where a deterministic proxy exists, and the exact same outcome is persisted as `demonstrated`. This is the **visible goal's** outcome — the skill the learner was actually instructed in — and is not the retest verdict.
6. **The retest verdict is behavioural, not goal-compliance.** It is computed by the canonical detector `retestOutcomeFor` (`src/lib/retest.ts`) over the merged argument graph, using the same weakness counters and the same opportunity test every other layer uses (`repairEffectiveness` / `opportunity.ts`). It used to be `snapshot.goalOutcome.demonstrated` — compliance with the goal line that had just been displayed — which measured the prompt rather than the behaviour, and could never be "demonstrated" for logic, impact, clarity or steelmanning because `assessGoalOutcome` has no deterministic proxy for them. The four canonical outcomes map onto the existing `repair_retests` columns without a migration: `skill-observed` → (observable=true, demonstrated=true), `skill-not-observed` → (true, false), `not-enough-evidence` → (true, null), `no-valid-opportunity` → (false, null). `retestAssignmentFor` owns that mapping; `skillJourneyServer.outcomeFromAssignment` decodes it back.
7. The result screen labels deliberate retests explicitly, and reveals the verdict — and with it, the name of the skill under test — only after the debate. Dimensions without a one-debate pass/fail rule are reported as observed-but-not-judged rather than given a guessed verdict.
8. Longitudinal coaching only consumes **observable opportunities**. Default zeroes do not become fake success: Impact needs something to weigh; Structure needs an opposing move or enough own claims to expose a contradiction; Steelmanning needs an opposing move. The same opportunity filtering applies to profile scores, trend slopes and post-drill movement.
9. Improvement rewards compare **whole prior debates with the whole current debate**. Turn-level assessments are merged per debate before the weakest-skill baseline is calculated. The longitudinal ledger fetches the newest bounded debate window and restores chronological order before trend math, so recent repairs/retests never disappear because a long-time user exceeded the cap.

Goals are numeric only where previous behaviour justifies precision ("Answer at least 4 of 5" needs ≥3 opportunities last debate; otherwise the goal stays qualitative).

## The retest is a measurement, not a prompt

A deliberate retest answers one question: **did the repair transfer when the learner was not told what to watch for?** That question is only answerable if the product does not prompt.

The product's own copy already promised this — "no reminder, no cue", "use it without a cue and the loop closes", "Only a later, unprompted, different-topic debate closes the loop" — while every pre-debate surface named the skill under test, printed that skill's instruction as the day's goal, and announced that today was the test. The claim and the implementation disagreed. A competitor survey found no product that closes the loop at all, so this one property is the moat; a cued retest gives it away.

### The rule

While a deliberate retest is pending, **no pre-debate surface may**:

1. name the skill under test;
2. give that skill's instruction or observable as the day's coaching;
3. state or imply that a retest is scheduled for today.

### How it is enforced

| Surface | Before | Now |
| --- | --- | --- |
| Goal line (Today, Progress) | the retest skill's instruction, with transfer copy | the ordinary focus, with the retest skill **excluded** (`buildCoachingGoal`, `pickFocusDimension`, `selectFocus`) |
| Today's practice target | "Retest: rebuttal is due" + the skill's observable | the ordinary target; the retest skill is excluded (`selectNextPractice`) |
| Continue-training card | "Retest: rebuttal is due" / "Start today's retest" | "A repair is waiting to be tested" / "Start today's debate" — the age of the repair stays, so the nudge is still auditable (`pickPriority`) |
| Loop thread | "Loop open: Rebuttal is repaired…" + "Today's debate … is the test" | "Loop open: a repair is waiting to be tested" + "A later debate, on a different topic, is the test — and it isn't signposted" (`buildLoopThread`) |
| Drill coach | the retest skill's drill, "Retest after repair" card | the drill focus excludes the retest skill; the card is gone (`/api/coach/today`, `CoachToday`) |
| Motion kicker / reason | "Today's retest motion" / "…so this tests transfer" | "Today's motion" / "A different motion today, so you meet a fresh argument…" (`TopicCard`, `pickRetestMotion`) |
| Live coaching hints | the hint that cues the skill under test fired every round | suppressed for the retest debate, before the one-warning/one-tip cap (`liveCoachingForTurn`, the solo turn route) |
| Result screen | reused the goal outcome under a "Repair retest ·" label | the behavioural verdict, with the skill named for the first time (`DebateResultCard`) |

The exclusion follows the Khan model: a mixed-skill session in which one skill is silently assessed, revealed afterwards.

### The honest limit

A learner who knows what they repaired can guess that a given debate is the test. The product cannot remove that knowledge, and no copy in the product should pretend otherwise. What the product guarantees — and what the copy now claims — is that it gives **no instruction** for that skill and **no announcement** of the day. The product says "without a prompt", not "unprompted".

### Scope

- **Guest practice** (`src/components/GuestArena.tsx`) is deliberately outside the policy and says so in the code: it is a guided demonstration of the loop, not a measurement. Its retest happens immediately in the same session, its verdict comes from a local heuristic over the learner's own text, it never touches the skill ledger, and its copy already states that it is "one observed instance… not a validated measure of ability". Hiding the skill there would make the demo incoherent without protecting a measurement that does not exist.
- The **post-repair screen** still says the repair will be tested later, on a different topic. That is the moment the loop's promise is made; removing it would make the repair feel unvalued. It names no day.

## Evidence-support honesty

Argument-graph citations distinguish **source identity** from **claim support**. A recognised institution is not enough to mark a claim supported.

- no attached source text → `unverified`;
- weak or mismatched claim/source overlap → `tangential`;
- only substantive source-text overlap can produce `supports`;
- grounded-evidence coverage counts only `supports`.
- a recognised source name must also use its registered root domain; name/domain mismatches remain `unverified` even when the attached excerpt appears to match the claim.

This prevents a plausible source name, missing excerpt, or decorative citation from silently increasing evidence coverage.

## Analytics

Privacy-conscious funnel events (`src/lib/productEvents.ts`, migrations 004/021/033): allowlisted names only, bounded context, no transcript text, no device identifiers, silent no-op for guests. State-defining solo events (round, debate and observable retest completion) are committed transactionally with their durable state and protected by idempotency indexes. The learning loop now distinguishes `repair_started` → `repair_attempted` → `repair_demonstrated` → `repair_episode_closed` → `retest_started` → `retest_completed` → `retest_skill_demonstrated`; legacy `repair_completed` rows remain readable but new code no longer emits that ambiguous name.

Funnel semantics: `repair_started` is the click on **Fix this now**; `repair_attempted` means a rewrite was persisted; `repair_demonstrated` means the prompted deterministic structure gate passed; `repair_episode_closed` is emitted only for the first successful attempt in that episode. `retest_completed` requires an observable later-debate reading for the repaired dimension, and `retest_skill_demonstrated` is emitted only where the existing deterministic goal rule can make that narrower pass/fail claim. No event by itself claims causal improvement.

### Admin funnel report (`/analytics`, admin-gated)

Computed from `product_events` by `src/lib/productFunnel.ts` and served at `/api/analytics/funnel`:

- Today → debate start rate;
- Debate completion (all formats) plus Sprint vs Full completion, in **both** units (see below);
- repair start/completion rate;
- D1/D7/D30 return (with pending-user counts — users without a full window are never counted as churned);
- time-to-first-value and per-session completion time (proper medians);
- full-analysis open rate;
- Challenge Me usage, broken down by which rule fired;
- friend-challenge creation/acceptance.

Rates below a 5-user sample render as "not yet measurable" instead of small-n noise.

**User vs session conversion.** User conversion counts each user once (a user who completes ≥1 sprint reads as 100%). Session conversion counts each debate separately via a bounded `debate_id` on the funnel events (migration 005 — a random UUID, no free text), so the same user reads as 10% if they completed 1 of 10 sprints. The report shows both, and states what share of funnel events carry a session id — legacy events without one are counted in user conversion only.

**Truthful truncation.** Every source table is fetched with a limit+1 probe (`takeBounded`): when a cap is hit, the report says so — records loaded, configured limit, and which metrics are affected (event caps distort funnel rates; repair, durable-retest and debate caps bound the effectiveness measurement). Debates additionally use bounded-window loading: only debates inside some repair's ±30-day window are fetched, so graph work stays proportional to what is actually measured.

### Does repair work? (`src/lib/repairEffectiveness.ts`)

For each completed repair, the same weakness kind's presence is compared across the user's debates in the 30-day window before vs after the repair:

```text
weakness detected → repair completed → next relevant debates → improved / unchanged / worse
```

- Excludes the repaired debate itself; only debates that could actually express the weakness count, and weakness counts are **side-scoped** (an opponent's fallacies or contradictions never register as the user's weakness).
- **Dropped-argument direction is explicit**: `DroppedArgument.owner` is the side whose argument went unanswered, so a user's rebuttal/structure failure is opponent-owned entries — arguments the user left unanswered. Weakness counts and drop detection read the canonical unanswered-opportunity set from `src/lib/opportunity.ts`; scoring (`groundedDroppedArguments`) and weakness measurement read the same canonical set from opposite sides, deliberately.
- **Opportunity gate**: debates that could not express the weakness are invisible to the measurement — evidence/structure/logic/impact repairs need user claims, rebuttal repairs need eligible canonical opponent opportunities, and engagement (clarity) repairs need a round where the opponent made a move the user had a later turn to answer. A clean debate with no opportunity is never counted as improvement.
- **No retry inflation**: raw rewrite attempts are collapsed to one repair episode per user + repaired debate + weakness kind. The first attempt remains the retry/conversion anchor, while the **first successful rewrite** anchors effectiveness and retest timing. Failed-only episodes remain attempt history and never enter repair-effectiveness or retest-outcome denominators. The best formative score and retry count remain visible for diagnostics.
- **No double-counting across distinct repair episodes**: after-windows stop at the next same-user same-kind repair episode, so later repairs never measure the same debates twice.
- **Explicit first retest**: the deliberate retest is the earliest completed, observable `repair_retests` assignment for that successful repair result. Ordinary later opportunity-bearing debates are longitudinal follow-up exposure only; they are never re-labelled as the deliberate retest.
- **Every repair kind has a deterministic detector — and they measure distinct things.** Evidence reads unsupported own claims; rebuttal reads the canonical unanswered-opportunity set; logic reads own fallacies; impact reads the absence of own impact moves; structure reads dropped threads plus own contradictions; **engagement (clarity) reads rounds the opponent opened and the user left unanswered** (`opportunity.engagementRoundsFor`). Engagement is deliberately broader than rebuttal — it also counts weighing moves — so a user can answer every opponent claim and still leave every weighing move unengaged, and a distinct weakness must register.
- Engagement is **round-level by construction**, matching the skill score it repairs: a round counts as answered when the side answered *any* of that round's opportunities, so the only weakness the score can observe is a round where *nothing* was answered. A node-level detector would flag weaknesses the score cannot see, and a retest would "improve" without the skill score moving. Answering a weighing move is credited here (`engagementAnsweredIds`) even though the canonical rebuttal chain refuses impact targets — otherwise "answer the move they made" would be unobservable and the weakness unfixable through the metric. Rebuttal coverage, drop detection and rewards are untouched by that widening.
- `NOT_CURRENTLY_MEASURABLE_KINDS` is currently **empty**, and that is a real claim, not an omission: a future kind without a genuine detector goes in the set and is immediately excluded from rates, from `classifyRepair`, and from the retest outcome (`weaknessPresentIn` returns `null`, never `false`, for members). `clarity` left that set when its detector made it measurable — keeping it there would have meant reporting "not measurable" for behaviour the product's own score reports every turn.
- The `/analytics` repair loop additionally reports a prompted-vs-incidental retest timing comparison: the prompted arm is the explicit durable retest assignment; the incidental arm is successful repairs whose later exposure came only from ordinary debates (no assignment). Both arms are sample-gated separately and reported as observational association only — not causation.
- No later debates → "not yet measurable"; no earlier debates → "insufficient baseline". Nothing is silently dropped.
- A per-kind rate is only claimed with ≥5 repairs and ≥3 measurable — otherwise the report says "not yet claimable".
- **Retest linkage**: only a debate explicitly assigned through durable `repair_retests` state is the deliberate retest. The report tracks whether the weakness recurred in that assigned observable retest; ordinary later opportunity-bearing debates are follow-up exposure, never silently promoted into the primary retest (rate claimed only at ≥3 measurable explicit retests).
- The output is labelled observational: an association with the repair, not proof of causation.

## Live PvP matchmaking

`POST /api/pvp/queue` delegates the entire join lifecycle to `join_pvp_queue_and_match()`: recover an existing active match, enqueue the caller, claim the oldest waiting opponent, create the match, and clear both queue rows inside one serialized database transaction per topic. This closes the simultaneous-first-join gap where two users could both enqueue and then wait forever.

The database also enforces **one active PvP match per player across both roles**. A trigger checks `player_a` and `player_b` together under deterministic per-player transaction locks, so a user cannot be `player_b` in one active match and `player_a` in another. Friend challenges use the same `pvp_matches` table and therefore inherit the invariant.

## Async friend challenges

`POST /api/challenges` creates a shareable invite code on today's motion; the friend opens `/challenge/<code>`, accepts (sign-in required), and the pre-created PvP match routes them in. No simultaneity: the challenger opens, the opponent responds whenever. Match state persists in the normal PvP tables; invites expire after 7 days and claim atomically. The transcript replays through the existing PvP room. This is a foundation — the flow is functional but marked experimental.


## Recovery guarantees

- Starting a debate is claim-first: only one request per user/topic may call the opening model, and durable state appears only when the debate row, opening turn, optional repair retest and start analytics can commit together.
- A lost Start response is idempotent: retrying returns the canonical active debate rather than creating another session.
- Accepted responses are durable before opponent generation begins.
- If opponent generation fails after an accepted response, the user can retry generation without re-entering the answer.
- Once the accepted saved response reaches the minimum debate length, **Finish with saved response** commits that exact response as the final answered round and completes the debate without requiring another AI opponent call.
- A crashed Finish request cannot permanently lock the debate: stale finalization leases are recoverable by normal turn/timer activity and scheduled maintenance.
- Rapid Rebuttal and Prepared Speech keep their original server-issued timer across reloads.
- Per-user streaks and daily drills share the stored profile timezone; finalization reads that timezone inside the same database transaction as the streak update. The global Daily Topic remains one UTC-keyed motion for everyone.
