# Study: grounding-two-pass-verbosity

- sealed registration: `grounding-two-pass-verbosity.json` sha256 522cae8e0e646df8 (full text in `registration-snapshot.json`)
- hypothesis: A two-pass judge - pass 1 extracts claims and classifies the supplied evidence, pass 2 scores the grounded representation - raises verbosity stability from the measured 0.200 to >= 0.40 without degrading agreement, ECE, position invariance, or provider reliability, accepting a measured latency and token cost.
- variable: JUDGE ARCHITECTURE: single-pass v5 prompt vs the two-pass grounding pipeline. Identical provider (unorouter), model (nemotron-3.5-lightning:free), fixtures, gates, temperature=0 and transport in both arms. The pass-2 system prompt is byte-identical to shipped v5; only the extraction pass and the user framing are new. The grounding rule is inherent to the architecture, not a wording tweak, so this is one variable and not stacked prompt edits.
- design: registered runs/arm=2, probe-gated serialized interleave, provider=unorouter
- transport: concurrency=1, paceMs=12000 (transport only - same arms, fixtures, gates and verdict rule)
- capacity plan: GO - expected 2340 calls fit within 80% of the declared 3000 budget (expected 2340 calls of budget 3000; see capacity.json)
- executable rule (generated from structured fields; structured fields are authoritative): supported iff usable runs >= 2/arm at reliability >= 0.75 AND target "verbosity stability" moves up by >= 0.2 AND the bootstrap 90% CI lower bound of the signed improvement is > 0 AND no protected metric regresses beyond its cap AND pooled run sd. Fewer usable runs, any unmet condition or missing data => INCONCLUSIVE. Gate thresholds are untouchable.
- prose adoption rule: matches generated rule
- provider: stopped early - provider probe failed before arm baseline; study stops cleanly and stays resumable under the same seal
- verdict: **INCONCLUSIVE**

## Decision inputs (usable = reliability >= 0.75; inference uses usable ONLY)

| arm | total runs | usable | excluded |
|---|---|---|---|
| baseline | 0 | 0 | — |
| candidate | 0 | 0 | — |

## Reasons
- registered requirement not met: usable runs baseline 0/2, candidate 0/2 (reliability >= 0.75); INCONCLUSIVE - fewer usable runs never proceed to inference

## Per-metric uncertainty (all raw values shown; excluded rows marked; stats/CIs from usable rows only)

| Metric | dir | baseline usable mean/med/sd | candidate usable mean/med/sd | Δ cand-base | bootstrap 90% CI |
|---|---|---|---|---|---|
| verbosity stability | up | — | — | — | — |
| provider reliability | up | — | — | — | — |
| fixture agreement | up | — | — | — | — |
| ECE | down | — | — | — | — |
| position stability | up | — | — | — | — |
| names stability | up | — | — | — | — |
| style stability | up | — | — | — | — |
| prestige stability | up | — | — | — | — |
| fake-citation influence | down | — | — | — | — |
| latency p50 ms | down | — | — | — | — |
| prompt tokens | down | — | — | — | — |

## Every raw run

### baseline

### candidate
