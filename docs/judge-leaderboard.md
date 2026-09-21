# Judge leaderboard (live benchmarks)

Last generated 2026-09-21T10:32:11.826Z by `scripts/judge-benchmark.mjs` over 24 labelled fixture debates.
Pack stratification: 24 fixtures, expected-winner {"a":8,"b":8,"tie":8}, 15 domains, difficulty {"clear":9,"near-tie":8,"subtle":7}.
Judge configuration: temperature 0, prompt v5, scoring engine v1, graph schema v1 (benchmark verdict prompt aligned with the production judging policy; see src/lib/judgeVersioning.ts for the app's versioned judge).
Provider reliability gate: successful/attempted calls ≥ 0.75 (successful / attempted benchmark calls across bases, probes and audits; failures stay in the denominator so a small surviving subset cannot qualify a failing provider). A probe with fewer than half the pack's usable calls reports INSUFFICIENT DATA — it can never pass on a small surviving sample.
Human agreement here is against fixture labels (small n) until the rated corpus supplies consensus.

| Model | Fixtures | Reliability (ok/att) | Agreement (usable n) | ECE | Position mirror | Verbosity stab. | Names stab. | Whitespace stab. | Fake-cit. | Ideology L/R flips | Political flips | Latency p50 | Tokens | Est. cost | PASS/FAIL |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| kiraai:qwen3.8-flash | 24 | 0/24 (0%) | — (n=0) | — | — | — | — | — | — | 0/0 | 0 | — | — | — | FAIL |
| openrouter:nvidia/nemotron-3-super-120b-a12b:free | 24 | 51/192 (27%) | 0.643 (n=14) | 0.175 | — | — | — | — | 0.2 | 0/0 | 1 | 737ms | 24596 | $0 | FAIL |
| unorouter:nemotron-3.5-lightning:free | 24 | 220/312 (71%) | 0.417 (n=24) | 0.305 | 0.619 | 0.5 | 0.524 | 0.524 | 0.45 | 1/3 | 5 | 6199ms | 110936 | $0 | FAIL |

## Per-model gate detail

### openrouter:nvidia/nemotron-3-super-120b-a12b:free — FAIL
- FAIL provider reliability: 51/192 = 0.266 (min 0.75)
- FAIL fixture-label agreement: 0.643 (min 0.75)
- FAIL ECE: 0.175 (max 0.08)
- INSUFFICIENT DATA Position swap [position]: usable 2/24 (min 12)
- INSUFFICIENT DATA Names removed [names]: usable 3/24 (min 12)
- INSUFFICIENT DATA Verbosity inflated [verbosity-up]: usable 3/24 (min 12)
- INSUFFICIENT DATA Style: sophisticated wording [style-fancy]: usable 4/24 (min 12)
- INSUFFICIENT DATA Whitespace normalised [whitespace]: usable 2/24 (min 12)
- INSUFFICIENT DATA Source prestige swapped [prestige]: usable 3/24 (min 12)
- INSUFFICIENT DATA Confidence hedged [confidence-hedge]: usable 2/24 (min 12)
- INSUFFICIENT DATA Confident tone added [confident-tone]: usable 3/24 (min 12)
- INSUFFICIENT DATA Fake citation injected [fake-citation]: usable 5/24 (min 12)
- INSUFFICIENT DATA political-topic stability: usable 4/24 (min 12)
- INSUFFICIENT DATA ideological asymmetry: usable 6 (min 24)
- failure split: 1 provider-reliability, 2 model-quality, 11 insufficient-data (provider problems are never blamed on the model and vice versa)
- diagnostics: 5 accuracy issue(s), 1 calibration bin(s) flagged, 4 invariance flip(s), 261 provider error call(s) — full detail in docs/latest-judge-benchmark.json

### unorouter:nemotron-3.5-lightning:free — FAIL
- FAIL provider reliability: 220/312 = 0.705 (min 0.75)
- FAIL fixture-label agreement: 0.417 (min 0.75)
- FAIL ECE: 0.305 (max 0.08)
- FAIL Position swap [position]: 0.619 vs threshold
- FAIL Names removed [names]: 0.524 vs threshold
- FAIL Verbosity inflated [verbosity-up]: 0.5 vs threshold
- FAIL Style: sophisticated wording [style-fancy]: 0.6 vs threshold
- FAIL Whitespace normalised [whitespace]: 0.524 vs threshold
- FAIL Source prestige swapped [prestige]: 0.579 vs threshold
- FAIL Confidence hedged [confidence-hedge]: 0.4 vs threshold
- FAIL Confident tone added [confident-tone]: 0.381 vs threshold
- FAIL Fake citation injected [fake-citation]: 0.45 vs threshold
- INSUFFICIENT DATA political-topic stability: usable 5/24 (min 12)
- INSUFFICIENT DATA ideological asymmetry: usable 8 (min 24)
- failure split: 1 provider-reliability, 11 model-quality, 2 insufficient-data (provider problems are never blamed on the model and vice versa)
- diagnostics: 14 accuracy issue(s), 3 calibration bin(s) flagged, 88 invariance flip(s), 92 provider error call(s) — full detail in docs/latest-judge-benchmark.json

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

Last run: FAIL (2026-09-21T10:32:11.826Z). Gate status is per-row; a FAIL row means that model must not be trusted for competitive claims until it passes. Run history: docs/judge-benchmark-attempts.json.
