# Study: grounding-two-pass

- registration: `grounding-two-pass.json` (sha256 b8dd1fdfdd5a76e5) sealed before execution
- hypothesis: A two-pass judge (extract claims + classify each supplied evidence item supported/unsupported/unverifiable, then verdict on the grounded representation with unverifiable citations scoring nothing) reduces fake-citation influence to <= 0.15 mean without degrading verdict quality, accepting a measured latency/token cost.
- variable: JUDGE ARCHITECTURE: single-pass v5 prompt vs two-pass grounding pipeline. Same model/provider/fixtures/gates/temperature=0/transport. Pass-2 system prompt is byte-identical to shipped v5; only the user framing and the extraction pass are new (the grounding rule is inherent to the architecture, not a wording tweak).
- design: 3 reps/arm, serialized interleaved A,B,A,B; models=kiraai
- verdict: **INCONCLUSIVE**

## Reasons
- insufficient usable runs (reliability >= 0.75): baseline 1/3 usable, candidate 0/3 usable (registration requires 3 per arm)

## Per-metric uncertainty (every raw value preserved; nothing hidden behind a mean)

| Metric | dir | baseline raw | baseline mean/med/sd | candidate raw | candidate mean/med/sd | Δ cand-base | bootstrap 90% CI |
|---|---|---|---|---|---|---|---|
| fake-citation influence | down | 0.292 | 0.292/0.292/0 (n=1) | 0.286 | 0.286/0.286/0 (n=1) | -0.006 | [-0.006, -0.006] |
| provider reliability | up | 0.987, 0, 0 | 0.329/0/0.5698 (n=3) | 0.285, 0, 0 | 0.095/0/0.1645 (n=3) | -0.234 | [-0.658, 0.19] |
| fixture agreement | up | 0.583 | 0.583/0.583/0 (n=1) | 0.625 | 0.625/0.625/0 (n=1) | 0.042 | [0.042, 0.042] |
| ECE | down | 0.107 | 0.107/0.107/0 (n=1) | 0.075 | 0.075/0.075/0 (n=1) | -0.032 | [-0.032, -0.032] |
| position stability | up | 0.783 | 0.783/0.783/0 (n=1) | — | — | — | — |
| names stability | up | 0.826 | 0.826/0.826/0 (n=1) | — | — | — | — |
| verbosity stability | up | 0.87 | 0.87/0.87/0 (n=1) | — | — | — | — |
| style stability | up | 0.792 | 0.792/0.792/0 (n=1) | — | — | — | — |
| whitespace stability | up | 0.792 | 0.792/0.792/0 (n=1) | — | — | — | — |
| prestige stability | up | 0.708 | 0.708/0.708/0 (n=1) | — | — | — | — |
| latency p50 ms | down | 15945 | 15945/15945/0 (n=1) | 27164 | 27164/27164/0 (n=1) | 11219 | [11219, 11219] |
| prompt tokens | down | 146591 | 146591/146591/0 (n=1) | 93011 | 93011/93011/0 (n=1) | -53580 | [-53580, -53580] |

## Raw runs

### baseline
- `2026-09-15T160428396Z-kiraai.json` 2026-09-15T16:04:28.396Z model=kiraai:qwen3.8-flash-free reliability=0.987 gates={"provider":0,"quality":12,"insufficient":0} metrics={"fake-citation influence":0.292,"provider reliability":0.987,"fixture agreement":0.583,"ECE":0.107,"position stability":0.783,"names stability":0.826,"verbosity stability":0.87,"style stability":0.792,"whitespace stability":0.792,"prestige stability":0.708,"latency p50 ms":15945,"prompt tokens":146591}
- `2026-09-15T170445880Z-kiraai.json` 2026-09-15T17:04:45.880Z model=kiraai:qwen3.8-flash-free reliability=0 gates={"provider":1,"quality":0,"insufficient":13} metrics={"fake-citation influence":null,"provider reliability":0,"fixture agreement":null,"ECE":null,"position stability":null,"names stability":null,"verbosity stability":null,"style stability":null,"whitespace stability":null,"prestige stability":null,"latency p50 ms":null,"prompt tokens":null}
- `2026-09-15T170552923Z-kiraai.json` 2026-09-15T17:05:52.923Z model=kiraai:qwen3.8-flash-free reliability=0 gates={"provider":1,"quality":0,"insufficient":13} metrics={"fake-citation influence":null,"provider reliability":0,"fixture agreement":null,"ECE":null,"position stability":null,"names stability":null,"verbosity stability":null,"style stability":null,"whitespace stability":null,"prestige stability":null,"latency p50 ms":null,"prompt tokens":null}

### candidate
- `2026-09-15T170403904Z-kiraai.json` 2026-09-15T17:04:03.904Z model=kiraai:qwen3.8-flash-free reliability=0.285 gates={"provider":1,"quality":1,"insufficient":11} metrics={"fake-citation influence":0.286,"provider reliability":0.285,"fixture agreement":0.625,"ECE":0.075,"position stability":null,"names stability":null,"verbosity stability":null,"style stability":null,"whitespace stability":null,"prestige stability":null,"latency p50 ms":27164,"prompt tokens":93011}
- `2026-09-15T170520531Z-kiraai.json` 2026-09-15T17:05:20.531Z model=kiraai:qwen3.8-flash-free reliability=0 gates={"provider":1,"quality":0,"insufficient":13} metrics={"fake-citation influence":null,"provider reliability":0,"fixture agreement":null,"ECE":null,"position stability":null,"names stability":null,"verbosity stability":null,"style stability":null,"whitespace stability":null,"prestige stability":null,"latency p50 ms":null,"prompt tokens":null}
- `2026-09-15T170626513Z-kiraai.json` 2026-09-15T17:06:26.513Z model=kiraai:qwen3.8-flash-free reliability=0 gates={"provider":1,"quality":0,"insufficient":13} metrics={"fake-citation influence":null,"provider reliability":0,"fixture agreement":null,"ECE":null,"position stability":null,"names stability":null,"verbosity stability":null,"style stability":null,"whitespace stability":null,"prestige stability":null,"latency p50 ms":null,"prompt tokens":null}
