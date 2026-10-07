# Daily Debate — Roadmap

One priority is active: **prove the daily loop with real users.** Everything
else — the evaluation corpus, judge benchmarks, classrooms, tournaments — is
parked, kept, and tested, until the loop has real weekly users. Feature status
lives in [docs/status.md](status.md); this file is about what happens next.

## Prove the loop (current focus)

The product is one loop: debate today → one evidenced weakness → repair it
immediately → deliberate retest → measured improvement. A week counts as
"real" when the loop's volume grows **and** the loop's mechanics actually
fire. The weekly scorecard below is computed from `product_events`; read it
every week at `/analytics` (admin; JSON at `/api/analytics/funnel`), which
renders the same numbers as its **Weekly loop volumes** table.

| Weekly metric | Definition (`product_events`) | Now | 8-week target |
|---|---|---|---|
| Active users | distinct users with any tracked event | read at /analytics | ≥ 25 |
| Debate starts | `sprint_started` + `full_debate_started` + `solo_debate_started` sessions | 〃 | ≥ 50 |
| Debates completed | `debate_completed` events | 〃 | ≥ 30 |
| Completion rate | completed ÷ starts (reported only at ≥5 starts) | 〃 | ≥ 60% |
| Repairs demonstrated | successful repair completions (legacy retries excluded) | 〃 | ≥ 12 |
| Repair → retest | `retest_completed` ÷ repairs demonstrated | 〃 | ≥ 30% |
| Returning users | active users whose first-ever activity was before that week | 〃 | ≥ 40% of active |
| D1 return | users back exactly 1 day after first activity (≥5 eligible to report) | 〃 | ≥ 25% |

**Baseline: not yet measured.** Production has only just become stable enough
to trust its own numbers (deploys migrate themselves, the daily topic never
fails closed, the judge is pinned and spend-capped). The first job is one
clean week of recorded numbers — not a feature. The targets are proposed
floors for a loop that "works": completion above coin-flip, a repair after
roughly every second completed debate, one new user in four back the next
day. Re-read them after two weeks of real data instead of defending them.

**Weekly rhythm**

1. **Monday** — record the new row from `/analytics` Weekly loop volumes.
2. **One loop improvement per week, maximum.** Nothing that adds a surface.
3. **Friday** — check returning + D1. If a number moved, understand why
   before adding anything; if nothing moved, cut something.

**What counts as progress:** the weekly row goes up. **What does not:** new
features, new surfaces, or claims.

## Active backlog (serves the loop only)

- **Retest timing.** The repair → deliberate-retest hand-off exists; make the
  retest land when the user is likely to act on it (day 1, not day 14), and
  measure whether prompted retests beat incidental ones.
- **Coach focus steering.** Repair outcomes already persist; let the next
  debate's focus and the drill assignment consume them explicitly, then
  measure the repair → retest → recurrence chain the analytics page tracks.
- **Measurement honesty, kept.** Sprint's reduced-confidence label,
  `insufficient_evidence` surfaces, evaluation stamps, "not yet measurable"
  rates — these are features. Do not regress them under pressure to look good.
- **Loop latency.** p95 of the first paint and the first judge turn; loop
  starts die on slow first rounds.
- **Judge transparency in the loop.** Keep "too close to call" and the
  uncertainty lists visible; appeals and human correction wait for volume.

## Parked until the loop has real weekly users

Everything below is frozen, not deleted. The code and tests stay green; the
parked surfaces (PvP, friend challenges, voice input, the corpus-validation
pages) are additionally hidden from navigation behind
`NEXT_PUBLIC_EXPERIMENTAL_SURFACES` (default off) — see [docs/status.md](status.md).

### Evaluation corpus

- Staged genuine-debate corpus with `VALIDATION_STAGES` as the threshold
  source of truth: Stage 1 pilot (100+ debates, ≥2 independent ratings),
  Stage 2 calibration (500+, ≥3), Stage 3 mature (1,000+, ≥3, balanced strata).
- Rater guidance, adjudicated disagreements, human consensus labels.
- Real judge-vs-human benchmark. The labelled fixtures in
  `src/lib/humanCorpus.ts` are a regression scaffold, not human truth.

### Model benchmarks & bias testing

- Multi-model ensemble; position-swap, name-removal, verbosity,
  writing-complexity, source-prestige, political-topic,
  ideological-asymmetry, and confidence-calibration testing (most have working
  transforms in `src/lib/judgeInvariance.ts` — the harness survives).
- The weekly CI benchmark run stays alive regardless of parking
  (`npm run benchmark:judges`, gates in `config/judge-gates.json`): it costs
  nothing and keeps the standing judge honest while everything else waits.

### Multiplayer & classroom

- Team debates, classroom debates, teacher-assigned motions, research/prep
  mode. PvP itself (matchmaking, turn clocks, judged verdicts) is built and
  flag-gated; it reopens with the corpus and classroom work.

### Competitive & progression

- Ranked play and tournaments stay behind `eloGate` — mature Stage 3 corpus,
  judge invariance measured on the real model, ≥75% human agreement
  (`config/judge-gates.json`). Skill progression, targeted drills
  (`adaptiveCoach.ts` / `coachLoop.ts`), drill-effectiveness measurement.

### Also parked

- **Speech:** real STT beyond the browser Web Speech API; speech debates.
  (Voice input exists behind the experimental-surfaces flag, Chrome-family.)
- **Sharing:** public shareable debate replay.
- **Citation & evidence depth:** live citation fetching (the offline
  allowlist, quote verification, claim-to-source matching, and source-date
  checking are shipped — see [docs/evidence.md](evidence.md)).
- **Argument-graph depth:** fallacy validation beyond the lexicon,
  dropped-argument detection, burden-of-proof modelling.

## Gating rule (unchanged)

Ranked and tournament modes stay behind the existing gate — a mature Stage 3
corpus, judge invariance measured on the real model, and ≥75% human agreement
against that corpus. Friend challenges are experimental unranked play and are
themselves parked behind the experimental-surfaces flag; neither implies the
competitive ranking gate has passed.

## North star

Daily Debate wins when a player can trust the judge more than the opponent —
"the judge is calibrated, auditable, and can say *too close to call*." Trust is
earned in order: first people run the loop, then the judge is validated on
what they produced, then the gates open. The loop comes first.
