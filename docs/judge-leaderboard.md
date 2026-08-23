# Judge leaderboard (live benchmarks)

Last generated 2026-08-23T16:48:07.339Z by `scripts/judge-benchmark.mjs` over 3 labelled fixture debates.
Human agreement here is against fixture labels (small n) until the rated corpus supplies consensus.

| Model | Position mirror | Verbosity stab. | Names stab. | Fake-cit. influence | Human agree | ECE | Tokens | Errors |
|---|---|---|---|---|---|---|---|---|
| nvidia:nvidia/nemotron-3-super-120b-a12b | 1 | 1 | 1 | 0 | 0.667 | 0.367 | 17966 | 5 |
| nvidia:nvidia/nemotron-3-ultra-550b-a55b | 1 | 0 | 1 | 0.333 | 0.667 | 0.317 | 18675 | 6 |

Gates: {"positionMirrorMin":0.97,"verbosityStabilityMin":0.95,"nameStabilityMin":0.97,"whitespaceStabilityMin":0.98,"falseCitationInfluenceMax":0.05,"humanAgreementMin":0.75,"eceMax":0.08}
