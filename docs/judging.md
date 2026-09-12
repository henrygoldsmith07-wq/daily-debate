# Judging: argument graphs and the observable assessment

## The argument graph

Every turn is extracted into a structured graph: `claim → evidence → counterclaim → rebuttal → impact` (`src/lib/argGraph.ts`). Nodes carry owner (`a`/`b`/`ai`), round, evidence strength, citations, rebuttal targets, and fallacy tags. The graph as a whole lets the scorer explain *why* a score is what it is instead of returning a bare number.

## The scoring policy

A model may extract a graph, but it does not choose the score. `src/lib/observableAssessment.ts` recomputes observable features deterministically and produces the score with:

- explicit weights (`SCORE_WEIGHTS`, they sum to 100);
- per-component evidence references into the graph;
- extraction-confidence + uncertainty records;
- a five-point tie threshold;
- an explicit `insufficient_evidence` outcome instead of a forced verdict.

Scored features: `claimsMade`, `claimsDirectlySupported`, `evidenceActuallyCited`, `evidenceRelevance`, `directRebuttals`, `rebuttalCoverage`, `droppedArguments`, `contradictions`, `unsupportedAssertions`, `concededPoints`, `argumentResponses`, `impactHandling`/`impactComparison`, `confidentlyDetectableFallacies`. Text length and raw source counts buy nothing.

## Engine findings

`src/lib/argumentEvaluation.ts` adds deterministic detectors surfaced as `assessment.engine`: causal overclaims (unhedged causation over associational-only citations), fake precision (decimal-exact figures without attribution), rebuttal-quality scoring (valid-target discipline × evidence backing × valid counterclaim engagement × specificity), and steelman-quality scoring. Impact weighing stays separate from rebuttal coverage.

## PvP judging

PvP verdicts come from the ensemble harness — OpenRouter's free NVIDIA Nemotron chain is the configured judge (the ensemble supports a second judge in parallel only when another provider key is present; with one key it runs single-judge); the graph drives winner/scores via `finalizePvpAssessment`. Verdicts carry judge fingerprints (provider, model, prompt version, scoring engine version, temperature, ensemble) and the evaluation envelope stamp (`src/lib/evaluationEnvelope.ts`), so any stored result is attributable to the exact policy that produced it.

## Judge invariance and health

- `src/lib/judgeInvariance.ts` — transforms probing position bias, name bias, verbosity bias, confidence bias, and fake-source hallucination.
- `src/lib/judgeHealth.ts` — logged judge health with gates; retired judges stop judging.
- `npm run benchmark:judges` — weekly live-model benchmark; gates in `config/judge-gates.json`; results in `docs/judge-leaderboard.md`.

Competitive expansion (Elo, ranked, tournaments) stays gated behind invariance + ≥70% human agreement until the benchmark and corpus support it.
