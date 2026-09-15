# Judge variance — experiment `citation-zero-weight`

2 full-pack raw run(s), all preserved in `docs/judge-runs/v51czw-2026-09-15/`.
Prompt hash(es): c3675bd73e6b2fcc

Failures are never averaged away: dispersion is descriptive, gate decisions stay per-run.

## kiraai:qwen3.8-flash-free

| Metric | n | mean | median | min | max | sd |
|---|---|---|---|---|---|---|
| provider reliability | 2 | 0.217 | 0.217 | 0 | 0.434 | 0.307 |
| fixture agreement | 1 | 0.529 | 0.529 | 0.529 | 0.529 | 0 |
| ECE | 1 | 0.187 | 0.187 | 0.187 | 0.187 | 0 |
| fake-citation influence | 1 | 0.143 | 0.143 | 0.143 | 0.143 | 0 |
| position stability | 0 | — | — | — | — | — |
| names stability | 0 | — | — | — | — | — |
| verbosity stability | 0 | — | — | — | — | — |
| style stability | 0 | — | — | — | — | — |
| whitespace stability | 0 | — | — | — | — | — |
| prestige stability | 0 | — | — | — | — | — |

Gate pass frequency (per run, never averaged):

- `provider reliability`: 0/2 PASS (states: FAIL, FAIL)
- `fixture-label agreement`: 0/2 PASS (states: MISSING, INSUFFICIENT DATA)
- `ECE`: 0/2 PASS (states: MISSING, INSUFFICIENT DATA)
- `Position swap [position]`: 0/2 PASS (states: INSUFFICIENT DATA, INSUFFICIENT DATA)
- `Names removed [names]`: 0/2 PASS (states: INSUFFICIENT DATA, INSUFFICIENT DATA)
- `Verbosity inflated [verbosity-up]`: 0/2 PASS (states: INSUFFICIENT DATA, INSUFFICIENT DATA)
- `Style: sophisticated wording [style-fancy]`: 0/2 PASS (states: INSUFFICIENT DATA, INSUFFICIENT DATA)
- `Whitespace normalised [whitespace]`: 0/2 PASS (states: INSUFFICIENT DATA, INSUFFICIENT DATA)
- `Source prestige swapped [prestige]`: 0/2 PASS (states: INSUFFICIENT DATA, INSUFFICIENT DATA)
- `Confidence hedged [confidence-hedge]`: 0/2 PASS (states: INSUFFICIENT DATA, INSUFFICIENT DATA)
- `Confident tone added [confident-tone]`: 0/2 PASS (states: INSUFFICIENT DATA, INSUFFICIENT DATA)
- `Fake citation injected [fake-citation]`: 0/2 PASS (states: INSUFFICIENT DATA, INSUFFICIENT DATA)
- `political-topic stability`: 0/2 PASS (states: INSUFFICIENT DATA, INSUFFICIENT DATA)
- `ideological asymmetry`: 0/2 PASS (states: INSUFFICIENT DATA, INSUFFICIENT DATA)
