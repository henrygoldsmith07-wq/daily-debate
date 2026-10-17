# Judge leaderboard (live benchmarks)

Last generated 2026-10-12T11:54:21.475Z by `scripts/judge-benchmark.mjs` over 24 labelled fixture debates.
Pack stratification: 24 fixtures, expected-winner {"a":8,"b":8,"tie":8}, 15 domains, difficulty {"clear":9,"near-tie":8,"subtle":7}.
Judge configuration: temperature 0, prompt v5, scoring engine v1, graph schema v1 (benchmark verdict prompt aligned with the production judging policy; see src/lib/judgeVersioning.ts for the app's versioned judge).
Provider reliability gate: successful/attempted calls ≥ 0.75 (successful / attempted benchmark calls across bases, probes and audits; failures stay in the denominator so a small surviving subset cannot qualify a failing provider). A probe with fewer than half the pack's usable calls reports INSUFFICIENT DATA — it can never pass on a small surviving sample.
Human agreement here is against fixture labels (small n) until the rated corpus supplies consensus.

| Model | Fixtures | Reliability (ok/att) | Agreement (usable n) | ECE | Position mirror | Verbosity stab. | Names stab. | Whitespace stab. | Fake-cit. | Ideology L/R flips | Political flips | Latency p50 | Tokens | Est. cost | PASS/FAIL |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| kiraai:qwen3.8-flash | 24 | 0/24 (0%) | — (n=0) | — | — | — | — | — | — | 0/0 | 0 | — | — | — | FAIL |
| openrouter:nvidia/nemotron-3-super-120b-a12b:free | 24 | 72/300 (24%) | 0.696 (n=23) | 0.178 | — | — | — | — | 0 | 0/0 | 0 | 768ms | 34265 | $0 | FAIL |
| unorouter:nemotron-3.5-lightning:free | 24 | 278/312 (89%) | 0.625 (n=24) | 0.105 | 0.455 | 0.619 | 0.591 | 0.5 | 0.5 | 8/8 | 6 | 1647ms | 227675 | $0 | FAIL |

## Per-model gate detail

### openrouter:nvidia/nemotron-3-super-120b-a12b:free — FAIL
- FAIL provider reliability: 72/300 = 0.24 (min 0.75)
- FAIL fixture-label agreement: 0.696 (min 0.75)
- FAIL ECE: 0.178 (max 0.08)
- INSUFFICIENT DATA Position swap [position]: usable 7/24 (min 12)
- INSUFFICIENT DATA Names removed [names]: usable 6/24 (min 12)
- INSUFFICIENT DATA Verbosity inflated [verbosity-up]: usable 6/24 (min 12)
- INSUFFICIENT DATA Style: sophisticated wording [style-fancy]: usable 8/24 (min 12)
- INSUFFICIENT DATA Whitespace normalised [whitespace]: usable 5/24 (min 12)
- INSUFFICIENT DATA Source prestige swapped [prestige]: usable 5/24 (min 12)
- INSUFFICIENT DATA Confidence hedged [confidence-hedge]: usable 3/24 (min 12)
- INSUFFICIENT DATA Confident tone added [confident-tone]: usable 4/24 (min 12)
- INSUFFICIENT DATA Fake citation injected [fake-citation]: usable 5/24 (min 12)
- INSUFFICIENT DATA political-topic stability: usable 0/24 (min 12)
- INSUFFICIENT DATA ideological asymmetry: usable 0 (min 24)
- failure split: 1 provider-reliability, 2 model-quality, 11 insufficient-data (provider problems are never blamed on the model and vice versa)
- diagnostics: 7 accuracy issue(s), 2 calibration bin(s) flagged, 3 invariance flip(s), 240 provider error call(s) — full detail in docs/latest-judge-benchmark.json

### unorouter:nemotron-3.5-lightning:free — FAIL
- PASS provider reliability: 278/312 = 0.891 (min 0.75)
- FAIL fixture-label agreement: 0.625 (min 0.75)
- FAIL ECE: 0.105 (max 0.08)
- FAIL Position swap [position]: 0.455 vs threshold
- FAIL Names removed [names]: 0.591 vs threshold
- FAIL Verbosity inflated [verbosity-up]: 0.619 vs threshold
- FAIL Style: sophisticated wording [style-fancy]: 0.476 vs threshold
- FAIL Whitespace normalised [whitespace]: 0.5 vs threshold
- FAIL Source prestige swapped [prestige]: 0.632 vs threshold
- FAIL Confidence hedged [confidence-hedge]: 0.304 vs threshold
- FAIL Confident tone added [confident-tone]: 0.591 vs threshold
- FAIL Fake citation injected [fake-citation]: 0.5 vs threshold
- FAIL political-topic stability: 6 flip(s) over 22 usable
- PASS ideological asymmetry: left 8 vs right 8 flips (max diff 1)
- failure split: 0 provider-reliability, 12 model-quality, 0 insufficient-data (provider problems are never blamed on the model and vice versa)
- diagnostics: 9 accuracy issue(s), 1 calibration bin(s) flagged, 110 invariance flip(s), 34 provider error call(s) — full detail in docs/latest-judge-benchmark.json

### kiraai:qwen3.8-flash — FAIL
- FAIL provider reliability: 0/24 = 0 (min 0.75)
- INSUFFICIENT DATA fixture-label agreement: insufficient data
- INSUFFICIENT DATA ECE: insufficient data
- INSUFFICIENT DATA Position swap [position]: usable 0/24 (min 12)
- INSUFFICIENT DATA Names removed [names]: usable 0/24 (min 12)
- INSUFFICIENT DATA Verbosity inflated [verbosity-up]: usable 0/24 (min 12)
- INSUFFICIENT DATA Style: sophisticated wording [style-fancy]: usable 0/24 (min 12)
- INSUFFICIENT DATA Whitespace normalised [whitespace]: usable 0/24 (min 12)
- INSUFFICIENT DATA Source prestige swapped [prestige]: usable 0/24 (min 12)
- INSUFFICIENT DATA Confidence hedged [confidence-hedge]: usable 0/24 (min 12)
- INSUFFICIENT DATA Confident tone added [confident-tone]: usable 0/24 (min 12)
- INSUFFICIENT DATA Fake citation injected [fake-citation]: usable 0/24 (min 12)
- INSUFFICIENT DATA political-topic stability: usable 0/24 (min 12)
- INSUFFICIENT DATA ideological asymmetry: usable 0 (min 24)
- failure split: 1 provider-reliability, 0 model-quality, 13 insufficient-data (provider problems are never blamed on the model and vice versa)
- diagnostics: 0 accuracy issue(s), 0 calibration bin(s) flagged, 0 invariance flip(s), 312 provider error call(s) — full detail in docs/latest-judge-benchmark.json

Gates: {"positionMirrorMin":0.97,"verbosityStabilityMin":0.95,"nameStabilityMin":0.97,"whitespaceStabilityMin":0.98,"styleStabilityMin":0.95,"prestigeStabilityMin":0.95,"hedgingFlipMax":0.25,"confidentToneFlipMax":0.25,"falseCitationInfluenceMax":0.05,"humanAgreementMin":0.75,"eceMax":0.08,"providerReliabilityMin":0.75}

Last run: FAIL (2026-10-12T11:54:21.475Z). Gate status is per-row; a FAIL row means that model must not be trusted for competitive claims until it passes. Run history: docs/judge-benchmark-attempts.json.
