# Judge leaderboard (live benchmarks)

Last generated 2026-09-13T17:57:09.219Z by `scripts/judge-benchmark.mjs` over 24 labelled fixture debates.
Pack stratification: 24 fixtures, expected-winner {"a":8,"b":8,"tie":8}, 15 domains, difficulty {"clear":9,"near-tie":8,"subtle":7}.
Judge configuration: temperature 0, prompt v4, scoring engine v1, graph schema v1 (benchmark verdict prompt aligned with the production judging policy; see src/lib/judgeVersioning.ts for the app's versioned judge).
Human agreement here is against fixture labels (small n) until the rated corpus supplies consensus.

| Model | Fixtures | Agreement | ECE | Position mirror | Verbosity stab. | Names stab. | Whitespace stab. | Fake-cit. | Ideology L/R flips | Political flips | Errors | Latency p50 | Tokens | Est. cost | PASS/FAIL |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| kiraai:qwen3.8-flash-free | 24 | 0.65 | 0.119 | 0.895 | 0.947 | 0.85 | 0.889 | 0.2 | 2/3 | 1 | 58 | 12161ms | 243396 | $0 | FAIL |
| nvidia:nvidia/nemotron-3-super-120b-a12b | 3 | 0.667 | 0.367 | 1 | 1 | 1 | — | 0 | —/— | — | 5 | — | 17966 | — | FAIL |
| nvidia:nvidia/nemotron-3-ultra-550b-a55b | 3 | 0.667 | 0.317 | 1 | 0 | 1 | — | 0.333 | —/— | — | 6 | — | 18675 | — | FAIL |
| openrouter:nvidia/nemotron-3.5-lightning:free | 24 | — | — | — | — | — | — | — | 0/0 | 0 | 312 | — | — | $0 | FAIL |
| unorouter:nemotron-3.5-lightning:free | 24 | 0.75 | 0.244 | — | 0 | — | 0 | — | 0/0 | 0 | 298 | 4413ms | 805 | $0 | FAIL |

Gates: {"positionMirrorMin":0.97,"verbosityStabilityMin":0.95,"nameStabilityMin":0.97,"whitespaceStabilityMin":0.98,"falseCitationInfluenceMax":0.05,"humanAgreementMin":0.75,"eceMax":0.08}

Last run: FAIL (2026-09-13T17:57:09.219Z). Gate status is per-row; a FAIL row means that model must not be trusted for competitive claims until it passes.
