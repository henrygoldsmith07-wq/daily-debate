# Human corpus protocol: blinded human-labelled evaluation

This is the path from fixture labels (test infrastructure, not truth) to
real human-grounded judge evidence. Every rule here exists to keep a future
"judge agrees with humans" claim honest.

## Blinding

- Raters receive ONLY the anonymised transcript (`Side A`/`Side B`, round
  numbers, topic). Contributor identity, player names, AI/opponent markers
  and source pointers are stripped at import (`anonymiseTranscript`) and
  never leave the server.
- Raters never see model judgements: `system_verdict` is written by a
  separate admin flow (`system-comparison`) after rating, never served to
  raters. Moderators reviewing items see rater identities as `Rater 1..N`.
- Raters cannot rate their own debates (contributor exclusion, server-side).

## Presentation randomisation (position-bias control)

- Each (rater, item) pair is deterministically assigned which original side
  is shown first (`assignPresentationSide`, FNV-1a hash + avalanche fold —
  stable across refreshes, ~50/50 even for adversarial id patterns).
  `swapTranscriptSides` exchanges the labels for `b`-first presentation.
- **The server owns presentation truth.** The submission handler recomputes
  the assignment from `(userId, corpusId)`; client-supplied side-order
  metadata is ignored, so a forged `presentedFirst` can never invert stored
  coordinates. Ratings arrive in presented coordinates and are normalised to
  original item coordinates before storage (`normalizeRatingToOriginal`:
  scores swap, winner mirrors). Analysis always reads one frame.
- The stored `presented_first` column lets reliability reporting check the
  balance (`presentationBalance` in the reliability endpoint) so a skewed
  assignment cannot silently confound position-bias readings.

## Rubric

- Six dimensions, 1–5 Likert per side (`EVAL_DIMENSIONS` in
  `debateEvaluation.ts`: evidenceQuality, reasoning, relevance,
  rebuttalQuality, logicalValidity, sourceQuality), rendered with labels in
  the rating form; plus overall winner (`a`/`b`/`tie`), confidence 0–1, and
  a ≤1000-char rationale. Missing dimensions fall back at analysis time
  (`completeScores`), never silently.
- One row per (item, rater) (`unique(corpus_id, rater_id)`); re-submission is
  rejected rather than overwritten. Corrections use the audited admin path so
  the original rating and every correction remain reconstructable.

## Reliability before validity

- Minimum 2 raters per item (`MIN_RATERS_PER_ITEM`) is the **Stage 1 pilot
  floor**; items flip to `rated` only then. Stage 2/3 evidence counts only
  items with ≥3 independent ratings.
- Human–human agreement FIRST: per-dimension ICC, pairwise Cohen κ (≥5
  shared items), winner agreement. Disagreements (≥2 raters differ) enter
  the adjudication queue; an admin settles them by majority or moderator
  override with a required note (`adjudicateDebate`).
- **Pilot consensus gate** (`humanGroundTruthReady`, legacy function name):
  ≥100 consensus-ready items, ≥5 independent raters, and mean winner κ ≥0.6.
  Clearing it permits pilot judge-vs-human estimates only; it does **not**
  establish external validity. Every surface labels results below or at this
  stage as provisional.
- System-vs-human accuracy is computed ONLY over agreementReady items
  (unanimous or adjudicated) via the admin `system-comparison` flow, which
  never re-judges an item and records a position-swap stability check.
- Public aggregates (`/metrics`) are sample-gated to null/dash below
  thresholds (`evidenceState` gates); ECE, close-debate accuracy and
  position-swap stability are reported with denominators.

## Authoritative staged validation specification

- **Stage 0 — infrastructure:** fixtures/synthetic data only. Test pipeline and
  annotation machinery; no human-validity claim.
- **Stage 1 — pilot:** ≥100 genuine debates, ≥2 independent ratings/item.
  Debug the rubric, annotation workflow and disagreement patterns. Claims stay provisional.
- **Stage 2 — calibration:** ≥500 genuine debates, ≥3 independent ratings/item.
  Judge calibration, per-dimension validation, subgroup analysis and coaching-target validation.
- **Stage 3 — mature:** ≥1,000 genuine debates, ≥3 independent ratings/item,
  with balanced important strata. Required before ranked/competitive validity claims.

`VALIDATION_STAGES` in `src/lib/corpus.ts` is the source of truth for these
collection thresholds. `POPULATION_TARGET_ITEMS` is the Stage 3 target.

## Population diversity

- Stratification recorded at import: length bucket, ability band, subject,
  dynamics tier (close/decisive/weak_vs_weak), evidence density, style
  bucket, and dev/validation/locked split. Cells below `STRATUM_MINIMUM`
  (30) are flagged in `cellsNeedingCoverage` so recruitment aims at gaps.
- Fixture labels in `humanCorpus.ts` are explicitly NOT human truth
  (`HUMAN_CORPUS_AUDIT.canClaimHumanValidity === false`); they exist for
  offline regression tests only.
