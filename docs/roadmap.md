# Daily Debate — Roadmap

A backlog for growing Daily Debate from a daily game into a trustworthy
debate-training and competition platform. The headline is **evidence**: before
ranked play, tournaments, or classroom use can ship, the judge must be
validated against a large, provenance-audited human-labelled corpus and shown
to be unbiased.

Items marked *(extend)* already have a working baseline in `src/lib/` and need
depth rather than a new subsystem. The current labelled fixture corpus is not
provenance-audited human data; it is a regression scaffold until moderated
annotations are imported. Order within each group is not priority order.

## Progress (2026-08-15)

Shipped in the first implementation pass: rater-guidance/consensus-label
scaffolding + adjudication helpers (`corpusAdjudication.ts`), source-date checking +
original-source detection (`citationVerifier.ts`), political-topic / ideological
asymmetry / writing-complexity / source-prestige bias audit (`judgeInvariance.ts`),
team debates / classroom debates / teacher-assigned motions (`classroom.ts`), and
judge uncertainty in the UI — every PvP verdict now stores confidence, a
score-gap 95% CI, the winner posterior, per-judge agreement, and a "too close to
call" result (`ensembleJudge.ts` → `verdictFromEnsemble` → `VerdictExplainPanel`).
Still open: the 1,000+ debate data collection, live-model benchmark runs (need API
keys), and better STT (needs a transcription service).

Second pass (§4 citation & evidence integrity): quote verification
(`quoteVerification.ts`) — quoted spans in evidence are checked against the cited
source's excerpt and classified verbatim → verified, close → paraphrase, partial →
misquoted, absent → fabricated — plus evidence-quality scoring that adds quote +
date dimensions to the source tier (`evidenceQualityScore`, composing
`sourceQualityScore` and `sourceDateCheck`). The graph evidence report now counts
fabricated quotes and docks its score for them (`evidenceVerification.ts` →
`GraphEvidenceReport.quoteIssueCount` / `fabricatedQuoteCount`).

Third pass (§4 citation & evidence integrity): claim-to-source matching
(`claimSourceMatch` in `quoteVerification.ts`) — a claim's content is checked
against the best-matching cited excerpt and graded supported → weak → mismatched
(no excerpt = unverifiable, not a violation). The graph evidence report now
counts claims whose citations don't support them (`claimMismatchCount`), demotes
those links to tangential, and docks its score for decorative citations
(`evidenceVerification.ts` → `GraphEvidenceReport.claimMismatchCount` /
`weakClaimSourceCount`).

## Baseline already shipped

| Capability | Where |
|------------|-------|
| Argument graph `claim → evidence → counterclaim → rebuttal → impact` | `src/lib/argGraph.ts` |
| Source-grounded evidence + citation allowlist / quality score | `src/lib/citationVerifier.ts` |
| User-attached evidence (URL inference) | `src/lib/evidence.ts` |
| Judge invariance transforms (swap labels, strip names, verbosity, hedge, fake source) | `src/lib/judgeInvariance.ts` |
| Labelled fixture corpus (provenance currently unverified) | `src/lib/humanCorpus.ts` |
| Heuristic enrichers (repetition, rebuttal coverage, fallacy hints) | `src/lib/argHeuristics.ts` |
| Targeted drills + weakness profile | `src/lib/drills.ts` |
| Elo gating + matchmaking | `src/lib/competitive.ts` |
| Transcripts / replay / async scaffold | `src/lib/transcript.ts` |
| Voice input/output (Web Speech API, Chrome-family) | `src/components` |

## 1. Evaluation corpus — the headline

- Large genuine debate corpus.
- 1,000+ debates.
- 3+ independent raters/debate.
- Rater guidance.
- Adjudicated disagreements.
- Human consensus labels.
- Real judge-vs-human benchmark *(extend — `humanCorpus.ts` is 9 debates; scale to
  1,000+ with multi-rater consensus and use `judgeVsHumanAgreement` as the metric)*.

## 2. Model benchmarks & bias testing

- Gemini benchmark.
- Anthropic benchmark.
- Multi-model ensemble.
- Position-swap testing *(extend — `swapLabels`)*.
- Name-removal testing *(extend — `stripNames`)*.
- Verbosity testing *(extend — `inflateVerbosity`)*.
- Writing-complexity testing.
- Source-prestige testing *(extend — `injectFakeSource` probes hallucination;
  add prestige-gradient sources)*.
- Political-topic testing.
- Ideological asymmetry testing.
- Confidence calibration *(extend — `addConfidenceHedge` + `calibrationCurve`)*.

## 3. Judge transparency & human-in-the-loop

- "Too close to call." (a legitimate third verdict, not a forced win).
- Judge uncertainty display.
- Appeals.
- Human correction.

## 4. Citation & evidence integrity

- Better real citation fetching *(extend — live homepage reachability is the
  known gap; the offline allowlist is the floor)*.
- Claim-to-source matching — *shipped (third pass)*: `claimSourceMatch` in
  `quoteVerification.ts`.
- Quote verification — *shipped (second pass)*: `quoteVerification.ts`.
- Source-date checking — *shipped (first pass)*: `sourceDateCheck` in
  `citationVerifier.ts`.
- Evidence-quality scoring — *shipped (second pass)*: `evidenceQualityScore`
  (source tier + quote fidelity + date recency).
- Original-source detection — *shipped (first pass)*: `originalSourceGap` in
  `citationVerifier.ts`.

## 5. Argument graph & fallacy

- Argument graph corrections.
- Stronger fallacy validation *(extend — `fallacyHints` is lexicon-based)*.
- Better dropped-argument detection.
- Better burden-of-proof modelling — *shipped*: `burdenOfProof.ts` models the
  burden from the claim's own logical form (universal / causal / normative /
  existential / descriptive) rather than from whether anyone said "you must
  prove", grades whether the support present is proportionate to that form, and
  distinguishes a legitimate demand for proof from an **improper burden shift**
  — demanding disproof of the speaker's own still-unsupported claim. Surfaced in
  `VerdictExplainPanel` → `BurdenPanel`.
- Better rebuttal matching *(extend — `rebuttalCoverage` /
  `rebuttalAddressesTargets`)*.

## 6. Speech

- Speech debates *(extend — voice input/output exists, Chrome-family only)*.
- Better STT (beyond the browser Web Speech API: real speech-to-text for
  Safari/Firefox and higher-accuracy transcription).

## 7. Multiplayer & classroom

- Team debates.
- Classroom debates.
- Teacher-assigned motions.
- Research/prep mode.

## 8. Competitive & progression (gated)

- Tournament mode after judge validation *(extend — gated by `eloGate`)*.
- Ranked mode after validation *(extend — gated by `eloGate`)*.
- Skill progression.
- Targeted drills *(extend — `drillsFor` / `weaknessProfile`)*.
- Measure drill effectiveness.

## 9. Sharing

- Shareable debate replay *(extend — `transcriptForReplay` exists)*.

## Gating rule (unchanged)

Ranked, tournament, and challenge modes stay behind the existing gate — judge
invariance measured on the real model **and** ≥70% human agreement against the
Section 1 corpus. Sections 1–3 are the unlock path for everything in Section 8:
no large labelled corpus, no ranked play.

## North star

Daily Debate wins when a player can trust the judge more than the opponent —
"the judge is calibrated, auditable, and can say *too close to call*." The corpus
and bias benchmarks in Sections 1–2 are what earn that trust; the classroom and
competition features in Sections 7–8 are what it unlocks.

