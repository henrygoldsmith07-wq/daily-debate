# Audit: where the training path actually depends on a model

Required by `docs/validation.md` § "Judge improvement protocol" ("write the audit
before changing anything"). This audit was commissioned on the belief that the
training loop ran largely on an unvalidated judge, and that pushing it "further
onto deterministic features" was the highest-leverage fix available.

**That premise was wrong.** The audit below found the opposite, and the finding
is more useful than the change it was going to authorise.

## Method

Traced every user-visible number on the solo training path back to its origin,
following imports from the result screen down to the first function that is
neither pure nor synchronous.

## What the training path actually is

The whole solo training path is **deterministic recomputation over the
transcript**. There is no model call anywhere in it.

| Stage | Module | Nature |
|---|---|---|
| Transcript → argument graph | `observableAssessment/turnExtraction.ts` → `graphFromTurn` | **pure, synchronous.** No model, no I/O. |
| Fallacy / concession / contradiction / dropped detection | `graphEnrichers.ts` | pure functions over text and graph |
| Unanswered opportunities | `opportunity.ts` | pure |
| Graph → observable features | `observableAssessment/features.ts` | pure |
| Features → scores + 7 skill dimensions | `observableAssessment/scoring.ts` | pure, versioned policy |
| Scores → skill ledger + trajectory | `skillLedger.ts` | pure |
| Ledger → focus selection, drill, attempt score | `adaptiveCoach.ts` | pure |
| Graph → the single flagged weakness | `argumentRepair.ts` → `pickRepairTarget` | pure |
| Repair rewrite scoring | `argumentRepair.ts` → `scoreRepair` | pure |
| Goal → result story | `coachingGoal.ts`, `resultSnapshot.ts` | pure |

`turnProjection.ts`, which drives this for a turn, imports only `argGraph`,
`assess`, `graphEnrichment` and `turnExtraction` — no provider client, no
`fetch`, no `await`.

## Where the model genuinely enters

1. **The opponent's arguments** — `debate_opening` and `debate_turn` in
   `openrouter.ts`. Irreducible: the opponent has to be someone.
2. **PvP verdicts** — `ensembleJudge.ts`. Already gated: the repo's own rule is
   that a failing benchmark row must not be trusted for competitive claims.
3. **Structure routing** — `classify_argument_structure` (classifier.dev).
   Already documented as non-authoritative: routing "never labels a viewpoint as
   true, correct, preferable, or the winner", and low-confidence, `other` and
   fallback classifications all keep the deterministic path open.

## Correction to the prior review

The earlier review asserted that the judge "fails every gate" and therefore
"the training loop runs on the same unvalidated judge and is not gated anywhere."

**The second half of that is not accurate.** The judge's failing gates measure
*verdict* quality — winner agreement, calibration, and invariance of the
verdict under cosmetic perturbations. Those numbers come from
`judge-benchmark.mjs` judging labelled fixtures, which is the PvP/corpus path.
They do not flow into the solo training numbers, because those numbers are
recomputed deterministically from what the learner wrote.

This changes the risk picture materially, in Daily Debate's favour:

- The **seven skill dimensions, trend arrows, weakness detection and repair
  targeting are not judge outputs.** They are reproducible functions of the
  learner's own text. Their weakness is not "the judge is wrong about them";
  it is the tier-3 problem `docs/validation.md` already names — deterministic,
  reproducible, **not yet validated** against human raters.
- The remaining unvalidated-judge exposure on the product is **PvP verdicts**
  (already gated) and **the corpus benchmark itself** (Stage 0, synthetic).

So the priority is *not* an architectural move to de-judge the training path.
That work is already done.

## What this does not excuse

- `docs/validation.md` tier 3 still holds: deterministic scores are
  *reproducible, not yet validated*. The corpus needs human agreement before
  any skill number can be called a measurement.
- The **opponent's text is model output** and enters the graph as context. A
  provider that produces weak or off-topic arguments degrades the input the
  learner's own moves are scored against. That is a real, unmeasured coupling.
- The default judge provider is returning **6% usable calls** and PvP verdicts
  are already degraded by that.

## Recommended next step (unchanged by this audit)

The remaining lever is the one this audit confirms: **human agreement on real
debates** (`docs/human-corpus-protocol.md`, Stage 1). Not an architectural
de-judging pass — that is finished.