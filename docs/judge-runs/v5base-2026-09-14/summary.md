# Judge variance — experiment `baseline`

2 full-pack raw run(s), all preserved in `docs/judge-runs/v5base-2026-09-14/`.
Prompt hash(es): 317311691c6b78a6

Failures are never averaged away: dispersion is descriptive, gate decisions stay per-run.

## kiraai:qwen3.8-flash-free

| Metric | n | mean | median | min | max | sd |
|---|---|---|---|---|---|---|
| provider reliability | 2 | 0.871 | 0.871 | 0.774 | 0.967 | 0.136 |
| fixture agreement | 2 | 0.556 | 0.556 | 0.522 | 0.591 | 0.049 |
| ECE | 2 | 0.192 | 0.192 | 0.185 | 0.198 | 0.009 |
| fake-citation influence | 2 | 0.233 | 0.233 | 0.217 | 0.25 | 0.023 |
| position stability | 2 | 0.697 | 0.697 | 0.667 | 0.727 | 0.042 |
| names stability | 2 | 0.777 | 0.777 | 0.737 | 0.818 | 0.057 |
| verbosity stability | 2 | 0.72 | 0.72 | 0.7 | 0.739 | 0.028 |
| style stability | 2 | 0.877 | 0.877 | 0.842 | 0.913 | 0.05 |
| whitespace stability | 2 | 0.764 | 0.764 | 0.696 | 0.833 | 0.097 |
| prestige stability | 2 | 0.78 | 0.78 | 0.778 | 0.783 | 0.004 |

Gate pass frequency (per run, never averaged):

- `provider reliability`: 2/2 PASS (states: PASS, PASS)
- `fixture-label agreement`: 0/2 PASS (states: FAIL, FAIL)
- `ECE`: 0/2 PASS (states: FAIL, FAIL)
- `Position swap [position]`: 0/2 PASS (states: FAIL, FAIL)
- `Names removed [names]`: 0/2 PASS (states: FAIL, FAIL)
- `Verbosity inflated [verbosity-up]`: 0/2 PASS (states: FAIL, FAIL)
- `Style: sophisticated wording [style-fancy]`: 0/2 PASS (states: FAIL, FAIL)
- `Whitespace normalised [whitespace]`: 0/2 PASS (states: FAIL, FAIL)
- `Source prestige swapped [prestige]`: 0/2 PASS (states: FAIL, FAIL)
- `Confidence hedged [confidence-hedge]`: 2/2 PASS (states: PASS, PASS)
- `Confident tone added [confident-tone]`: 0/2 PASS (states: FAIL, FAIL)
- `Fake citation injected [fake-citation]`: 0/2 PASS (states: FAIL, FAIL)
- `political-topic stability`: 0/2 PASS (states: FAIL, FAIL)
- `ideological asymmetry`: 1/2 PASS (states: PASS, INSUFFICIENT DATA)
