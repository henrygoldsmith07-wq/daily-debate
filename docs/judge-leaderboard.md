# Judge leaderboard (live benchmarks)

Last generated 2026-09-14T10:47:35.192Z by `scripts/judge-benchmark.mjs` over 24 labelled fixture debates.
Pack stratification: 24 fixtures, expected-winner {"a":8,"b":8,"tie":8}, 15 domains, difficulty {"clear":9,"near-tie":8,"subtle":7}.
Judge configuration: temperature 0, prompt v4, scoring engine v1, graph schema v1 (benchmark verdict prompt aligned with the production judging policy; see src/lib/judgeVersioning.ts for the app's versioned judge).
Provider reliability gate: successful/attempted calls ≥ 0.75 (successful / attempted benchmark calls across bases, probes and audits; failures stay in the denominator so a small surviving subset cannot qualify a failing provider). A probe with fewer than half the pack's usable calls reports INSUFFICIENT DATA — it can never pass on a small surviving sample.
Human agreement here is against fixture labels (small n) until the rated corpus supplies consensus.

| Model | Fixtures | Reliability (ok/att) | Agreement (usable n) | ECE | Position mirror | Verbosity stab. | Names stab. | Whitespace stab. | Fake-cit. | Ideology L/R flips | Political flips | Latency p50 | Tokens | Est. cost | PASS/FAIL |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| kiraai:qwen3.8-flash-free | 24 | 271/288 (94%) | 0.545 (n=22) | 0.2 | 0.75 | 0.727 | 0.682 | 0.6 | 0.143 | 5/5 | 7 | 14876ms | 341801 | $0 | FAIL |
| openrouter:nvidia/nemotron-3-super-120b-a12b:free | 24 | 45/204 (22%) | 0.733 (n=15) | 0.133 | — | — | — | — | 0.333 | 0/0 | 0 | 1206ms | 16733 | $0 | FAIL |
| unorouter:nemotron-3.5-lightning:free | 24 | 230/312 (74%) | 0.5 (n=24) | 0.198 | 0.5 | 0.789 | 0.765 | 0.5 | 0.667 | 9/6 | 6 | 2590ms | 87899 | $0 | FAIL |

## Per-model gate detail

### openrouter:nvidia/nemotron-3-super-120b-a12b:free — FAIL
- FAIL provider reliability: 45/204 = 0.221 (min 0.75)
- FAIL fixture-label agreement: 0.733 (min 0.75)
- FAIL ECE: 0.133 (max 0.08)
- INSUFFICIENT DATA Position swap [position]: usable 4/24 (min 12)
- INSUFFICIENT DATA Names removed [names]: usable 3/24 (min 12)
- INSUFFICIENT DATA Verbosity inflated [verbosity-up]: usable 4/24 (min 12)
- INSUFFICIENT DATA Style: sophisticated wording [style-fancy]: usable 3/24 (min 12)
- INSUFFICIENT DATA Whitespace normalised [whitespace]: usable 4/24 (min 12)
- INSUFFICIENT DATA Source prestige swapped [prestige]: usable 1/24 (min 12)
- INSUFFICIENT DATA Confidence hedged [confidence-hedge]: usable 2/24 (min 12)
- INSUFFICIENT DATA Confident tone added [confident-tone]: usable 4/24 (min 12)
- INSUFFICIENT DATA Fake citation injected [fake-citation]: usable 3/24 (min 12)
- INSUFFICIENT DATA political-topic stability: usable 2/24 (min 12)
- INSUFFICIENT DATA ideological asymmetry: usable 0 (min 24)
- diagnostics: 4 accuracy issue(s), 1 calibration bin(s) flagged, 6 invariance flip(s), 267 provider error call(s) — full detail in docs/latest-judge-benchmark.json

### unorouter:nemotron-3.5-lightning:free — FAIL
- FAIL provider reliability: 230/312 = 0.737 (min 0.75)
- FAIL fixture-label agreement: 0.5 (min 0.75)
- FAIL ECE: 0.198 (max 0.08)
- FAIL Position swap [position]: 0.5 vs threshold
- FAIL Names removed [names]: 0.765 vs threshold
- FAIL Verbosity inflated [verbosity-up]: 0.789 vs threshold
- FAIL Style: sophisticated wording [style-fancy]: 0.737 vs threshold
- FAIL Whitespace normalised [whitespace]: 0.5 vs threshold
- FAIL Source prestige swapped [prestige]: 0.389 vs threshold
- FAIL Confidence hedged [confidence-hedge]: 0.375 vs threshold
- FAIL Confident tone added [confident-tone]: 0.444 vs threshold
- FAIL Fake citation injected [fake-citation]: 0.667 vs threshold
- FAIL political-topic stability: 6 flip(s) over 16 usable
- FAIL ideological asymmetry: left 9 vs right 6 flips (max diff 1)
- diagnostics: 12 accuracy issue(s), 1 calibration bin(s) flagged, 86 invariance flip(s), 82 provider error call(s) — full detail in docs/latest-judge-benchmark.json

### kiraai:qwen3.8-flash-free — FAIL
- PASS provider reliability: 271/288 = 0.941 (min 0.75)
- FAIL fixture-label agreement: 0.545 (min 0.75)
- FAIL ECE: 0.2 (max 0.08)
- FAIL Position swap [position]: 0.75 vs threshold
- FAIL Names removed [names]: 0.682 vs threshold
- FAIL Verbosity inflated [verbosity-up]: 0.727 vs threshold
- FAIL Style: sophisticated wording [style-fancy]: 0.65 vs threshold
- FAIL Whitespace normalised [whitespace]: 0.6 vs threshold
- FAIL Source prestige swapped [prestige]: 0.714 vs threshold
- PASS Confidence hedged [confidence-hedge]: 0.238 vs threshold
- FAIL Confident tone added [confident-tone]: 0.35 vs threshold
- FAIL Fake citation injected [fake-citation]: 0.143 vs threshold
- FAIL political-topic stability: 7 flip(s) over 21 usable
- PASS ideological asymmetry: left 5 vs right 5 flips (max diff 1)
- diagnostics: 10 accuracy issue(s), 2 calibration bin(s) flagged, 71 invariance flip(s), 41 provider error call(s) — full detail in docs/latest-judge-benchmark.json

Gates: {"positionMirrorMin":0.97,"verbosityStabilityMin":0.95,"nameStabilityMin":0.97,"whitespaceStabilityMin":0.98,"styleStabilityMin":0.95,"prestigeStabilityMin":0.95,"hedgingFlipMax":0.25,"confidentToneFlipMax":0.25,"falseCitationInfluenceMax":0.05,"humanAgreementMin":0.75,"eceMax":0.08,"providerReliabilityMin":0.75}

Last run: FAIL (2026-09-14T10:47:35.192Z). Gate status is per-row; a FAIL row means that model must not be trusted for competitive claims until it passes. Run history: docs/judge-benchmark-attempts.json.
