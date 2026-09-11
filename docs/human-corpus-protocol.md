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
- One row per (item, rater) (`unique(corpus_id, rater_id)`); re-submission
  overwrites rather than duplicates.

## Reliability before validity

- Minimum 2 raters per item (`MIN_RATERS_PER_ITEM`); items flip to `rated`
  only then.
- Human–human agreement FIRST: per-dimension ICC, pairwise Cohen κ (≥5
  shared items), winner agreement. Disagreements (≥2 raters differ) enter
  the adjudication queue; an admin settles them by majority or moderator
  override with a required note (`adjudicateDebate`).
- **Ground-truth gate** (`humanGroundTruthReady`): the corpus may be used as
  judge ground truth only with ≥30 consensus-ready items, ≥5 independent
  raters, and mean winner κ ≥0.6. Every surface (public `/metrics`, admin
  reliability, ops health) shows the same explicit not-yet/ready verdict —
  agreement claims below the gate are labelled provisional.
- System-vs-human accuracy is computed ONLY over agreementReady items
  (unanimous or adjudicated) via the admin `system-comparison` flow, which
  never re-judges an item and records a position-swap stability check.
- Public aggregates (`/metrics`) are sample-gated to null/dash below
  thresholds (`evidenceState` gates); ECE, close-debate accuracy and
  position-swap stability are reported with denominators.

## Population diversity

- Target: 500 items (`POPULATION_TARGET_ITEMS`), ≥2 blind raters each.
- Stratification recorded at import: length bucket, ability band, subject,
  dynamics tier (close/decisive/weak_vs_weak), evidence density, style
  bucket, and dev/validation/locked split. Cells below `STRATUM_MINIMUM`
  (30) are flagged in `cellsNeedingCoverage` so recruitment aims at gaps.
- Fixture labels in `humanCorpus.ts` are explicitly NOT human truth
  (`HUMAN_CORPUS_AUDIT.canClaimHumanValidity === false`); they exist for
  offline regression tests only.
