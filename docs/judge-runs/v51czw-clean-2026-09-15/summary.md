# Judge variance — experiment `citation-zero-weight`

2 full-pack raw run(s), all preserved in `docs/judge-runs/v51czw-clean-2026-09-15/`.
Prompt hash(es): c3675bd73e6b2fcc

Failures are never averaged away: dispersion is descriptive, gate decisions stay per-run.

## kiraai:qwen3.8-flash-free

| Metric | n | mean | median | min | max | sd |
|---|---|---|---|---|---|---|
| provider reliability | 2 | 0.925 | 0.925 | 0.88 | 0.97 | 0.064 |
| fixture agreement | 2 | 0.576 | 0.576 | 0.5 | 0.652 | 0.107 |
| ECE | 2 | 0.171 | 0.171 | 0.087 | 0.256 | 0.12 |
| fake-citation influence | 2 | 0.256 | 0.256 | 0.25 | 0.261 | 0.008 |
| position stability | 2 | 0.802 | 0.802 | 0.692 | 0.913 | 0.156 |
| names stability | 2 | 0.82 | 0.82 | 0.769 | 0.87 | 0.071 |
| verbosity stability | 2 | 0.829 | 0.829 | 0.826 | 0.833 | 0.005 |
| style stability | 2 | 0.885 | 0.885 | 0.857 | 0.913 | 0.04 |
| whitespace stability | 2 | 0.918 | 0.918 | 0.913 | 0.923 | 0.007 |
| prestige stability | 2 | 0.901 | 0.901 | 0.846 | 0.957 | 0.078 |

Gate pass frequency (per run, never averaged):

- `provider reliability`: 2/2 PASS (states: PASS, PASS)
- `fixture-label agreement`: 0/2 PASS (states: FAIL, FAIL)
- `ECE`: 0/2 PASS (states: FAIL, FAIL)
- `Position swap [position]`: 0/2 PASS (states: FAIL, FAIL)
- `Names removed [names]`: 0/2 PASS (states: FAIL, FAIL)
- `Verbosity inflated [verbosity-up]`: 0/2 PASS (states: FAIL, FAIL)
- `Style: sophisticated wording [style-fancy]`: 0/2 PASS (states: FAIL, FAIL)
- `Whitespace normalised [whitespace]`: 0/2 PASS (states: FAIL, FAIL)
- `Source prestige swapped [prestige]`: 1/2 PASS (states: FAIL, PASS)
- `Confidence hedged [confidence-hedge]`: 1/2 PASS (states: INSUFFICIENT DATA, PASS)
- `Confident tone added [confident-tone]`: 2/2 PASS (states: PASS, PASS)
- `Fake citation injected [fake-citation]`: 0/2 PASS (states: FAIL, FAIL)
- `political-topic stability`: 0/2 PASS (states: FAIL, FAIL)
- `ideological asymmetry`: 2/2 PASS (states: PASS, PASS)
