# Study: grounding-two-pass-unorouter

- sealed registration: `grounding-two-pass-unorouter.json` sha256 247e205453283996 (full text in `registration-snapshot.json`)
- hypothesis: A two-pass judge (extract claims + classify each supplied evidence item supported/unsupported/unverifiable, then verdict on the grounded representation with unverifiable citations scoring nothing) reduces fake-citation influence to <= 0.15 mean without degrading verdict quality, accepting a measured latency/token cost.
- variable: JUDGE ARCHITECTURE: single-pass v5 prompt vs two-pass grounding pipeline. Same model/provider/fixtures/gates/temperature=0/transport. Pass-2 system prompt is byte-identical to shipped v5; only the user framing and the extraction pass are new (the grounding rule is inherent to the architecture, not a wording tweak).
- design: registered runs/arm=3, probe-gated serialized interleave, provider=unorouter
- provider: stopped early - provider probe failed before arm candidate; study stops cleanly and stays resumable under the same seal
- verdict: **INCONCLUSIVE**

## Decision inputs (usable = reliability >= 0.75; inference uses usable ONLY)

| arm | total runs | usable | excluded |
|---|---|---|---|
| baseline | 1 | 1 | — |
| candidate | 0 | 0 | — |

## Reasons
- registered requirement not met: usable runs baseline 1/3, candidate 0/3 (reliability >= 0.75); INCONCLUSIVE - fewer usable runs never proceed to inference

## Per-metric uncertainty (all raw values shown; excluded rows marked; stats/CIs from usable rows only)

| Metric | dir | baseline usable mean/med/sd | candidate usable mean/med/sd | Δ cand-base | bootstrap 90% CI |
|---|---|---|---|---|---|
| fake-citation influence | down | 0.278/0.278/0 (n=1) | — | — | — |
| provider reliability | up | 0.82/0.82/0 (n=1) | — | — | — |
| fixture agreement | up | 0.435/0.435/0 (n=1) | — | — | — |
| ECE | down | 0.243/0.243/0 (n=1) | — | — | — |
| position stability | up | 0.722/0.722/0 (n=1) | — | — | — |
| names stability | up | 0.5/0.5/0 (n=1) | — | — | — |
| verbosity stability | up | 0.579/0.579/0 (n=1) | — | — | — |
| style stability | up | 0.526/0.526/0 (n=1) | — | — | — |
| whitespace stability | up | 0.6/0.6/0 (n=1) | — | — | — |
| prestige stability | up | 0.5/0.5/0 (n=1) | — | — | — |
| latency p50 ms | down | 1230/1230/0 (n=1) | — | — | — |
| prompt tokens | down | 110080/110080/0 (n=1) | — | — | — |

## Every raw run

### baseline
- [USABLE] `2026-09-15T220044421Z-unorouter.json` 2026-09-15T22:00:44.421Z model=unorouter:nemotron-3.5-lightning:free reliability=0.82 gates={"provider":0,"quality":13,"insufficient":0} metrics={"fake-citation influence":0.278,"provider reliability":0.82,"fixture agreement":0.435,"ECE":0.243,"position stability":0.722,"names stability":0.5,"verbosity stability":0.579,"style stability":0.526,"whitespace stability":0.6,"prestige stability":0.5,"latency p50 ms":1230,"prompt tokens":110080}

### candidate
