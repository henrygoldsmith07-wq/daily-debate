# Judge leaderboard (live benchmarks)

Last generated 2026-09-14T18:46:02.637Z by `scripts/judge-benchmark.mjs` over 24 labelled fixture debates.
Pack stratification: 24 fixtures, expected-winner {"a":8,"b":8,"tie":8}, 15 domains, difficulty {"clear":9,"near-tie":8,"subtle":7}.
Judge configuration: temperature 0, prompt v5, scoring engine v1, graph schema v1 (benchmark verdict prompt aligned with the production judging policy; see src/lib/judgeVersioning.ts for the app's versioned judge).
Provider reliability gate: successful/attempted calls ≥ 0.75 (successful / attempted benchmark calls across bases, probes and audits; failures stay in the denominator so a small surviving subset cannot qualify a failing provider). A probe with fewer than half the pack's usable calls reports INSUFFICIENT DATA — it can never pass on a small surviving sample.
Human agreement here is against fixture labels (small n) until the rated corpus supplies consensus.

| Model | Fixtures | Reliability (ok/att) | Agreement (usable n) | ECE | Position mirror | Verbosity stab. | Names stab. | Whitespace stab. | Fake-cit. | Ideology L/R flips | Political flips | Latency p50 | Tokens | Est. cost | PASS/FAIL |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| kiraai:qwen3.8-flash-free | 24 | 304/312 (97%) | 0.583 (n=24) | 0.189 | 0.792 | 0.783 | 0.875 | 0.833 | 0.381 | 6/4 | 4 | 15606ms | 507927 | $0 | FAIL |
| openrouter:nvidia/nemotron-3-super-120b-a12b:free | 24 | 4/72 (6%) | — (n=4) | — | — | — | — | — | — | 0/0 | 0 | 1124ms | 1800 | $0 | FAIL |
| unorouter:nemotron-3.5-lightning:free | 24 | 243/312 (78%) | 0.542 (n=24) | 0.201 | 0.444 | 0.529 | 0.65 | 0.412 | 0.353 | 4/5 | 9 | 1453ms | 117745 | $0 | FAIL |

## Per-model gate detail

### openrouter:nvidia/nemotron-3-super-120b-a12b:free — FAIL
- FAIL provider reliability: 4/72 = 0.056 (min 0.75)
- FAIL fixture-label agreement: insufficient data
- FAIL ECE: insufficient data
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
- diagnostics: 0 accuracy issue(s), 2 calibration bin(s) flagged, 0 invariance flip(s), 308 provider error call(s) — full detail in docs/latest-judge-benchmark.json

### unorouter:nemotron-3.5-lightning:free — FAIL
- PASS provider reliability: 243/312 = 0.779 (min 0.75)
- FAIL fixture-label agreement: 0.542 (min 0.75)
- FAIL ECE: 0.201 (max 0.08)
- FAIL Position swap [position]: 0.444 vs threshold
- FAIL Names removed [names]: 0.65 vs threshold
- FAIL Verbosity inflated [verbosity-up]: 0.529 vs threshold
- FAIL Style: sophisticated wording [style-fancy]: 0.5 vs threshold
- FAIL Whitespace normalised [whitespace]: 0.412 vs threshold
- FAIL Source prestige swapped [prestige]: 0.437 vs threshold
- FAIL Confidence hedged [confidence-hedge]: 0.389 vs threshold
- FAIL Confident tone added [confident-tone]: 0.429 vs threshold
- FAIL Fake citation injected [fake-citation]: 0.353 vs threshold
- FAIL political-topic stability: 9 flip(s) over 19 usable
- PASS ideological asymmetry: left 4 vs right 5 flips (max diff 1)
- failure split: 0 provider-reliability, 12 model-quality, 0 insufficient-data (provider problems are never blamed on the model and vice versa)
- diagnostics: 11 accuracy issue(s), 2 calibration bin(s) flagged, 94 invariance flip(s), 69 provider error call(s) — full detail in docs/latest-judge-benchmark.json

### kiraai:qwen3.8-flash-free — FAIL
- PASS provider reliability: 304/312 = 0.974 (min 0.75)
- FAIL fixture-label agreement: 0.583 (min 0.75)
- FAIL ECE: 0.189 (max 0.08)
- FAIL Position swap [position]: 0.792 vs threshold
- FAIL Names removed [names]: 0.875 vs threshold
- FAIL Verbosity inflated [verbosity-up]: 0.783 vs threshold
- FAIL Style: sophisticated wording [style-fancy]: 0.75 vs threshold
- FAIL Whitespace normalised [whitespace]: 0.833 vs threshold
- FAIL Source prestige swapped [prestige]: 0.818 vs threshold
- PASS Confidence hedged [confidence-hedge]: 0.25 vs threshold
- FAIL Confident tone added [confident-tone]: 0.273 vs threshold
- FAIL Fake citation injected [fake-citation]: 0.381 vs threshold
- FAIL political-topic stability: 4 flip(s) over 24 usable
- FAIL ideological asymmetry: left 6 vs right 4 flips (max diff 1)
- failure split: 0 provider-reliability, 12 model-quality, 0 insufficient-data (provider problems are never blamed on the model and vice versa)
- diagnostics: 10 accuracy issue(s), 2 calibration bin(s) flagged, 61 invariance flip(s), 8 provider error call(s) — full detail in docs/latest-judge-benchmark.json

Gates: {"positionMirrorMin":0.97,"verbosityStabilityMin":0.95,"nameStabilityMin":0.97,"whitespaceStabilityMin":0.98,"styleStabilityMin":0.95,"prestigeStabilityMin":0.95,"hedgingFlipMax":0.25,"confidentToneFlipMax":0.25,"falseCitationInfluenceMax":0.05,"humanAgreementMin":0.75,"eceMax":0.08,"providerReliabilityMin":0.75}

Last run: FAIL (2026-09-14T18:46:02.637Z). Gate status is per-row; a FAIL row means that model must not be trusted for competitive claims until it passes. Run history: docs/judge-benchmark-attempts.json.
