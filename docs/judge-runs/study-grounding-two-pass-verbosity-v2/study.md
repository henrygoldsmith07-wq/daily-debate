# Study: grounding-two-pass-verbosity-v2

- sealed registration: `grounding-two-pass-verbosity-v2.json` sha256 cbd4f04ae095e728 (full text in `registration-snapshot.json`)
- hypothesis: A two-pass judge - pass 1 extracts claims and classifies the supplied evidence, pass 2 scores the grounded representation - raises verbosity stability by at least 0.20 over the single-pass baseline measured in the same study on the same transport, without degrading agreement, ECE, position invariance, or provider reliability, accepting a measured latency and token cost.
- variable: JUDGE ARCHITECTURE: single-pass v5 prompt vs the two-pass grounding pipeline. Identical provider (cerebras), model (gpt-oss-120b), fixtures, gates, temperature=0 and transport in both arms, with the request-rate gate identical in both arms. The pass-2 system prompt is byte-identical to shipped v5; only the extraction pass and the user framing are new. The grounding rule is inherent to the architecture, not a wording tweak, so this is one variable and not stacked prompt edits.
- design: registered runs/arm=2, probe-gated serialized interleave, provider=cerebras
- transport: concurrency=1, paceMs=15000 (transport only - same arms, fixtures, gates and verdict rule)
- capacity plan: GO - expected 2340 calls fit within 80% of the declared 3000 budget (expected 2340 calls of budget 3000; see capacity.json)
- executable rule (generated from structured fields; structured fields are authoritative): supported iff usable runs >= 2/arm at reliability >= 0.75 AND target "verbosity stability" moves up by >= 0.2 AND the bootstrap 90% CI lower bound of the signed improvement is > 0 AND no protected metric regresses beyond its cap AND pooled run sd. Fewer usable runs, any unmet condition or missing data => INCONCLUSIVE. Gate thresholds are untouchable.
- prose adoption rule: matches generated rule
- provider: stopped early - dispatch stopped after 1 of 3 planned arms (--max-arms); the study remains resumable and undecided
- verdict: **INCONCLUSIVE**

## Decision inputs (usable = reliability >= 0.75; inference uses usable ONLY)

| arm | total runs | usable | excluded |
|---|---|---|---|
| baseline | 1 | 1 | — |
| candidate | 1 | 0 | 2026-10-21T193929911Z-cerebras.json (reliability 0.519 < registered minimum 0.75) |

## Reasons
- registered requirement not met: usable runs baseline 1/2, candidate 0/2 (reliability >= 0.75); INCONCLUSIVE - fewer usable runs never proceed to inference

## Per-metric uncertainty (all raw values shown; excluded rows marked; stats/CIs from usable rows only)

| Metric | dir | baseline usable mean/med/sd | candidate usable mean/med/sd | Δ cand-base | bootstrap 90% CI |
|---|---|---|---|---|---|
| verbosity stability | up | 0.636/0.636/0 (n=1) | — | — | — |
| provider reliability | up | 0.983/0.983/0 (n=1) | — | — | — |
| fixture agreement | up | 0.522/0.522/0 (n=1) | — | — | — |
| ECE | down | 0.25/0.25/0 (n=1) | — | — | — |
| position stability | up | 0.652/0.652/0 (n=1) | — | — | — |
| names stability | up | 0.565/0.565/0 (n=1) | — | — | — |
| style stability | up | 0.609/0.609/0 (n=1) | — | — | — |
| prestige stability | up | 0.565/0.565/0 (n=1) | — | — | — |
| fake-citation influence | down | 0.174/0.174/0 (n=1) | — | — | — |
| latency p50 ms | down | 12002/12002/0 (n=1) | — | — | — |
| prompt tokens | down | 144842/144842/0 (n=1) | — | — | — |

## Every raw run

### baseline
- [USABLE] `2026-10-21T085123210Z-cerebras.json` 2026-10-21T08:51:23.210Z model=cerebras:gpt-oss-120b reliability=0.983 gates={"provider":0,"quality":13,"insufficient":0} metrics={"verbosity stability":0.636,"provider reliability":0.983,"fixture agreement":0.522,"ECE":0.25,"position stability":0.652,"names stability":0.565,"style stability":0.609,"prestige stability":0.565,"fake-citation influence":0.174,"latency p50 ms":12002,"prompt tokens":144842}

### candidate
- [EXCLUDED] `2026-10-21T193929911Z-cerebras.json` 2026-10-21T19:39:29.911Z model=cerebras:gpt-oss-120b reliability=0.519 reason: reliability 0.519 < registered minimum 0.75 gates={"provider":1,"quality":9,"insufficient":4} metrics={"verbosity stability":0.615,"provider reliability":0.519,"fixture agreement":0.4,"ECE":0.244,"position stability":0.5,"names stability":0.571,"style stability":0.786,"prestige stability":0.846,"fake-citation influence":0.385,"latency p50 ms":29968,"prompt tokens":150203}
