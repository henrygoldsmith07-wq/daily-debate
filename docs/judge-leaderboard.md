# Judge leaderboard (live benchmarks)

**Status: BLOCKED — no judge secrets configured.** The 24-fixture pack is
validated and ready (verified 2026-09-10: 24 fixtures, 8/8/8 winners, 15
domains, 3 difficulty classes), and the `judge-benchmark` workflow runs on
schedule and dispatch — but the repository has **zero provider secrets**
(`NVIDIA_API_KEY` / `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY` are all
unset), so every recent "successful" run, including the 2026-09-10 manual
dispatch, was actually a silent skip that rewrote nothing. The numbers below
remain the historical 3-fixture record from 2026-08-23 and must not be
treated as current.

**This is now guarded against:** as of 2026-09-10 the workflow fails fast
when no judge secret exists, and the script exits non-zero without keys
(`--allow-skip` exists for deliberately key-less contexts). A secrets
regression can no longer masquerade as a green validation.

**Last completed run result: `allPass: false` — the gates did NOT pass** (2026-08-23, 3 fixtures):

- fixture-label agreement 0.667 (min 0.75)
- ECE 0.367 (max 0.08)
- verbosity stability 0 for `nemotron-3-ultra` (min 0.95), 0.5 on prestige probe for `nemotron-3-super`

No thresholds were changed to make these pass. Ranked/competitive expansion remains gated.

## Required publication fields (24-fixture run)

The refreshed run must publish, per judge: model/provider, judge version fingerprint
(prompt v3 / scoring engine v1 / graph schema v1 / temperature 0), fixture-label
agreement, ECE, position-mirror stability, name/prestige sensitivity, verbosity and
style sensitivity, false-citation influence, political asymmetry (ideology-left /
ideology-right / political-topic flips), provider/model error counts, latency (mean /
p50 / max), token usage, estimated cost, and the per-model PASS/FAIL gate status.
The benchmark script (2026-09-10) now records all of these; the table below will be
replaced by the workflow's commit when it next runs with keys.

## Refresh procedure

1. **Configure at least one repository secret** (Settings → Secrets → Actions):
   `NVIDIA_API_KEY`, `OPENROUTER_API_KEY`, or `ANTHROPIC_API_KEY`
   (optionally `NVIDIA_MODEL` / `ANTHROPIC_MODEL`).
2. Trigger the **judge-benchmark** workflow (Actions → judge-benchmark → Run
   workflow), or run locally with keys:
   `NVIDIA_API_KEY=… / OPENROUTER_API_KEY=… node scripts/judge-benchmark.mjs --concurrency 3 --enforce`
3. `--enforce` exits non-zero on gate breach; a breach blocks trust claims.
   A missing-key run now also exits non-zero (use `--allow-skip` only in
   deliberately key-less contexts).
4. The run rewrites this file and `docs/latest-judge-benchmark.json` **and
   commits them back to main automatically** (workflow has `contents: write`),
   so the checked-in validation record stays current without manual work.
5. Gates live in `config/judge-gates.json` — they must not be loosened to force
   a pass. Each table row carries its own PASS/FAIL gate status.

## Historical result (2026-08-23, n=3 fixtures — superseded by pending refresh)

Human agreement here is against fixture labels (small n) until the rated corpus supplies consensus.

| Model | Fixtures | Agreement | ECE | Position mirror | Verbosity stab. | Names stab. | Whitespace stab. | Fake-cit. | Ideology L/R flips | Political flips | Errors | Latency p50 | Tokens | Est. cost | PASS/FAIL |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nvidia:nvidia/nemotron-3-super-120b-a12b | 3 | 0.667 | 0.367 | 1 | 1 | 1 | — | 0 | —/— | — | 5 | — | 17966 | — | FAIL |
| nvidia:nvidia/nemotron-3-ultra-550b-a55b | 3 | 0.667 | 0.317 | 1 | 0 | 1 | — | 0.333 | —/— | — | 6 | — | 18675 | — | FAIL |

Gates: {"positionMirrorMin":0.97,"verbosityStabilityMin":0.95,"nameStabilityMin":0.97,"whitespaceStabilityMin":0.98,"falseCitationInfluenceMax":0.05,"humanAgreementMin":0.75,"eceMax":0.08}
