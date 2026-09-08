# Judge leaderboard (live benchmarks)

**Status: STALE — refresh pending.** The run below was generated 2026-08-23T16:48:07.339Z
by `scripts/judge-benchmark.mjs` over only **3** labelled fixtures (the pre-expansion
pack). The fixture pack has since expanded to **12 fixtures** across 11 domains and 3
difficulty classes (validated by `node scripts/judge-benchmark.mjs --pack-only`), so the
numbers below must be treated as historical, not current. A fresh live run over the full
pack is required before any trust claim is updated.

**Last run result: `allPass: false` — the gates did NOT pass.** Failing checks were:

- fixture-label agreement 0.667 (min 0.75)
- ECE 0.367 (max 0.08)
- verbosity stability 0 for `nemotron-3-ultra` (min 0.95), 0.5 on prestige probe for `nemotron-3-super`

No thresholds were changed to make these pass. Ranked/competitive expansion remains gated.

## Refresh procedure

1. Trigger the **judge-benchmark** workflow (Actions → judge-benchmark → Run
   workflow), or run locally with keys:
   `NVIDIA_API_KEY=… / OPENROUTER_API_KEY=… node scripts/judge-benchmark.mjs --concurrency 3 --enforce`
2. `--enforce` exits non-zero on gate breach; a breach blocks trust claims.
3. The run rewrites this file and `docs/latest-judge-benchmark.json`.
4. Gates live in `config/judge-gates.json` — they must not be loosened to force a pass.

## Historical result (2026-08-23, n=3 fixtures — superseded by pending refresh)

Human agreement here is against fixture labels (small n) until the rated corpus supplies consensus.

| Model | Position mirror | Verbosity stab. | Names stab. | Fake-cit. influence | Human agree | ECE | Tokens | Errors |
|---|---|---|---|---|---|---|---|---|
| nvidia:nvidia/nemotron-3-super-120b-a12b | 1 | 1 | 1 | 0 | 0.667 | 0.367 | 17966 | 5 |
| nvidia:nvidia/nemotron-3-ultra-550b-a55b | 1 | 0 | 1 | 0.333 | 0.667 | 0.317 | 18675 | 6 |

Gates: {"positionMirrorMin":0.97,"verbosityStabilityMin":0.95,"nameStabilityMin":0.97,"whitespaceStabilityMin":0.98,"falseCitationInfluenceMax":0.05,"humanAgreementMin":0.75,"eceMax":0.08}
