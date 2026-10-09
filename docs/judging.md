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

PvP verdicts come from the ensemble harness — the default judge is ONE pinned paid model via a single provider (Anthropic `claude-sonnet-5` over `@anthropic-ai/sdk`, `ANTHROPIC_MODEL` override); the free OpenAI-style chain serves as a second leg only when `JUDGE_ALLOW_FREE_PROVIDERS=1` (dev/e2e) or as an emergency production override, and UnoRouter/Kirai never participate by default. The graph drives winner/scores via `finalizePvpAssessment`. Verdicts carry judge fingerprints (provider, model, prompt version, scoring engine version, temperature, ensemble) and the evaluation envelope stamp (`src/lib/evaluationEnvelope.ts`) — the exact model id is copied into the stamp itself (`judgeProvider`/`judgeModel`/`judgeEnsemble`), so any stored result is attributable to the exact policy and model that produced it.

## Judge invariance and health

- `src/lib/judgeInvariance.ts` — transforms probing position bias, name bias, verbosity bias, confidence bias, and fake-source hallucination.
- `src/lib/judgeHealth.ts` — logged judge health with gates; retired judges stop judging.
- `npm run benchmark:judges` — weekly live-model benchmark; gates in `config/judge-gates.json`; results in `docs/judge-leaderboard.md`.

Competitive expansion (Elo, ranked, tournaments) stays gated behind invariance + ≥70% human agreement until the benchmark and corpus support it.

## Assessment and evidence contract

Every learner-facing claim distinguishes how it was produced. The product never collapses these into one "ability score":

- **Observable behaviour** — counted directly from the moves in the argument graph (dropped arguments, unsupported claims, rebuttal coverage). Reliable within a debate.
- **Model-extracted structure** — identified by a model reading the debate's structure (steelman quality, causal overclaims). Useful, not certain.
- **Deterministic score** — a fixed formula over observed signals; no model opinion in the number.
- **Provisional interpretation** — an early heuristic over limited data (judge-agreement estimates). Directional, not settled.
- **Insufficient evidence** — an explicit outcome when the data cannot support a claim. Never a zero, never an invented weakness.
- **Externally validated** — reserved for a claim that passed an external quality gate (a judge benchmark clearing every gate). **Currently almost nothing reaches this level.**

A deterministic calculation is not "externally validated" merely because it is reproducible. Each skill reading also inherits the uncertainty of its least-certain input (see `src/lib/skillTaxonomy.ts`, `src/lib/learnerModel.ts`).

## Abstention policy

When the evidence does not support a conclusion, the system withholds the conclusion and says so:

- A side with no claims is never scored — it returns `insufficient_evidence`, not 0 (`src/lib/observableAssessment/scoring.ts`).
- A skill needs a minimum sample (`MIN_SKILL_SAMPLE`, `MIN_PROFILE_DEBATES`, `REPAIR_MIN_SAMPLE`) before it is called a strength, weakness, or effectiveness claim; below that it is labelled provisional/low-confidence with its sample size.
- A failed judge parse or an un-scoreable graph produces an explicit `insufficient_evidence` verdict, not a forced winner.
- Insufficient evidence always surfaces with a useful next action (e.g. "debate one more round so there is enough to assess").

## Judge reliability contract

The judge's model output is the one artefact that must not pass unvalidated, because the application derives scores from it:

- **Schema-validated at the boundary.** `src/lib/aiSchema.ts` → `isValidJudgeExtraction` validates the extracted argument graph (nodes/edges/ownership/round + a rationale) at the provider call site (`judgePvpMatch` in `src/lib/openrouter.ts`). A parse that does not match the schema is a **retryable failure**, never a returned result.
- **Malformed output cannot become a favourable verdict or a valid-looking score.** Invalid JSON and schema-invalid output are both failures in the bounded retry loop; they fall through to the next model in the chain and ultimately to an explicit `insufficient_evidence` outcome.
- **Bounded retries.** Retries are limited by attempt count, a total time budget, and the daily spend cap; only retryable failures (transport, 429, 5xx, invalid output) are retried.
- **Stored-verdict guardrail.** `verdictFromEnsemble` (`src/lib/ensembleJudge.ts`) refuses to persist a winner/score that is not a valid comparison: a non-finite score or an out-of-set winner is written as an explicit `insufficient_evidence` tie, never a result.

## Validation status (honest)

The judge does **not** currently pass its own quality gates. The latest published benchmark (`docs/latest-judge-benchmark.json`, `docs/judge-leaderboard.md`) reports no benchmarked model clearing every gate — best fixture-label agreement and calibration sit below the floors, and the invariance probes (position, verbosity, names, fake-citation) fail. Therefore:

- Training surfaces (solo, repair, guest) are **provisional practice feedback**, not validated ability scores.
- Competitive verdicts stay **gated off** (PvP, rankings, tournaments) — `src/lib/judgeValidation.ts` is the single source of truth a UI reads for what a surface may claim.
- Nothing here should be described as production-ready measurement until a benchmark run clears every gate in `config/judge-gates.json`.
