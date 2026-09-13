# Judge leaderboard (live benchmarks)

Last generated 2026-09-13T19:10:24.624Z by `scripts/judge-benchmark.mjs` over 24 labelled fixture debates.
Pack stratification: 24 fixtures, expected-winner {"a":8,"b":8,"tie":8}, 15 domains, difficulty {"clear":9,"near-tie":8,"subtle":7}.
Judge configuration: temperature 0, prompt v4, scoring engine v1, graph schema v1 (benchmark verdict prompt aligned with the production judging policy; see src/lib/judgeVersioning.ts for the app's versioned judge).
Human agreement here is against fixture labels (small n) until the rated corpus supplies consensus.

| Model | Fixtures | Agreement (usable n) | ECE | Position mirror | Verbosity stab. | Names stab. | Whitespace stab. | Fake-cit. | Ideology L/R flips | Political flips | Errors | Latency p50 | Tokens | Est. cost | PASS/FAIL |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| kiraai:qwen3.8-flash-free | 24 | 0.583 (n=24) | 0.156 | 0.75 | 1 | 0.667 | 0.4 | 0 | 1/0 | 0 | 251 | 11393ms | 32926 | $0 | FAIL |
| openrouter:nvidia/nemotron-3-super-120b-a12b:free | 24 | 0.708 (n=24) | 0.175 | 0.833 | 0.667 | 0.833 | 1 | 0 | 0/0 | 0 | 235 | 1079ms | 19501 | $0 | FAIL |
| unorouter:nemotron-3.5-lightning:free | 24 | 0.478 (n=23) | 0.328 | 0 | 0 | 1 | — | — | 0/0 | 3 | 274 | 2068ms | 2870 | $0 | FAIL |

Gates: {"positionMirrorMin":0.97,"verbosityStabilityMin":0.95,"nameStabilityMin":0.97,"whitespaceStabilityMin":0.98,"falseCitationInfluenceMax":0.05,"humanAgreementMin":0.75,"eceMax":0.08}

Last run: FAIL (2026-09-13T19:10:24.624Z). Gate status is per-row; a FAIL row means that model must not be trusted for competitive claims until it passes.
