# Study registrations — errata and authority

**Structured fields are the executable rule.** Since schema v2
(`scripts/lib/judge-registration.mjs`), registrations are validated before a
study can be sealed or executed, and the human-readable adoption rule is
*generated* from the structured fields. A hand-written `adoptionRule` string
is prose, never policy.

## Erratum 2026-09-15/16 — schema v1 registrations

Two sealed studies predate the validator. Their free-text `adoptionRule`
strings are inconsistent with what the (now strict) engine would do:

| registration | sealed hash (canonical today) | prose said | authoritative fields say |
|---|---|---|---|
| `grounding-two-pass` (kiraai) | see `docs/judge-runs/study-grounding-two-pass-2026-09-15/registration-snapshot.json` | "…inconclusive if usable runs < 2/arm" | `runsPerArm: 3` + `minimumUsableReliability: 0.75` → **<3 usable/arm is INCONCLUSIVE** (the engine was fixed same day) |
| `grounding-two-pass-unorouter` | see its study `registration-snapshot.json` | same legacy clause | same; study PAUSED cleanly after 1/3 usable runs (probe failure), and resuming it needs an explicit `--reseal` justification because its snapshot predates canonical hashing |

Handling (per the no-rewrite policy):

- **Sealed snapshots are never edited.** Their stored contents and hashes
  stand as run-time evidence of what was actually executed.
- The live registration files are likewise left byte-intact for history;
  where a v1 registration needs to run again, the runner re-validates with a
  *warning* (legacy prose mismatch) rather than an error, and the derived
  rule in `study.md` is authoritative.
- The historical kiraai study verdict remains **INCONCLUSIVE** — its audit
  block shows 1/3 usable baseline runs, which under the corrected strict
  rule could never have been anything else.

## Erratum 2026-10-16 — whitespace probe was inert; published whitespace numbers measure provider noise

**Instrument failure.** `normalizeWhitespace` (in `src/lib/judgeInvariance.ts`
and its 1:1 port `scripts/lib/judge-transforms.mjs`) was
`t.replaceAll("  ", " ").trim()`. All 24 fixtures in
`scripts/lib/judge-fixtures.mjs` are newline-separated, single-spaced and
already trimmed — 0/24 contain a double space or a trimmable edge — so the
probe fed the judge a **byte-identical transcript** on 100% of the pack and
reported the result as "Whitespace normalised".

**Read the gates as flips.** Stability = 1 − flipRate. A "stability" of 0.667
is not mildly bad: it is 1 in 3 verdicts changing on identical input.

**Published numbers absorbed (not rewritten, per the no-rewrite policy):**

| artifact | whitespace figure | what it actually measured |
|---|---|---|
| `docs/latest-judge-benchmark.json` @ 2026-10-04, `unorouter:nemotron-3.5-lightning:free` | stability 0.667 (6 flips of 18 usable, flipRate 0.333) vs gate 0.98 | provider nondeterminism on identical inputs, **not** formatting sensitivity |
| same run, `openrouter:nvidia/nemotron-3-super-120b-a12b:free` | INSUFFICIENT DATA, usable 7/24 | uninterpretable (below the 12-call floor); the 7 surviving calls were also byte-identical pairs |
| same run, `kiraai:qwen3.8-flash` | INSUFFICIENT DATA, usable 0/24 | no measurement at all |

Because the whitespace gate (`whitespaceStabilityMin: 0.98`) is the strictest
gate in `config/judge-gates.json`, ordinary endpoint sampling noise was being
charged to every model, and every model's failed-invariance count was inflated
by up to 6 flips.

**Fix (this change, no gate touched):**

- `normalizeWhitespace` now collapses every whitespace run
  (`t.replace(/\s+/g, " ").trim()`), folding newlines/tabs/multiple spaces —
  24/24 fixtures change, words preserved (guarded in
  `scripts/lib/judge-transforms.test.mjs`).
- The offline mock (`mockWinner`) now splits on speaker markers
  (`splitTranscriptClauses`), not physical lines: the old line-split mock
  flipped on 11/24 folded transcripts (probe-on-mock interaction); the
  clause-split mock flips on 0/24 and is identical to the old mock on
  un-folded input (guarded in `src/lib/judgeInvariance.test.ts`).
- The 1:1 port is restored where it had drifted: `sophisticateWording` regains
  `but→however,` / `so→consequently,` (coverage 11/24 → 21/24),
  `addConfidentTone` regains the `and leaves no doubt` suffix,
  `swapPrestige` regains `Stanford HAI`, `deflateVerbosity` regains the
  `arguably` strip.

**Consequence for studies.** A study whose baseline is provider
nondeterminism cannot support a verdict: **no whitespace-targeted study may
be sealed until the probe is re-baselined on live traffic.** The largest
genuine gap in the same run is verbosity stability 0.200 vs the 0.95 gate
(16 flips of 20 usable — 4 in 5 verdicts move when filler is added); any
retargeted formatting-robustness study starts there.
