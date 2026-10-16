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

## Erratum 2026-10-05 — the whitespace probe was inert

**What was wrong.** The `whitespace` invariance probe was
`t.replaceAll("  ", " ").trim()`. No fixture transcript contains a double
space or surrounding whitespace — they are newline-separated with single
spaces — so the transform changed **0 of 24** fixtures and sent the judge a
byte-identical transcript. The result was published as "Whitespace normalised".

**Why it mattered.** The probe measured endpoint run-to-run nondeterminism, not
formatting sensitivity. `whitespaceStabilityMin` is `0.98`, the strictest gate
in `config/judge-gates.json`, so ordinary sampling noise was charged as a real
judge defect and counted toward every model's failed-invariance list.

**Affected record.** Every `stability.whitespace` value, every
`Whitespace normalised [whitespace]` gate line, and the whitespace column of
`docs/judge-leaderboard.md` published **before 2026-10-05** are meaningless.
That includes `docs/latest-judge-benchmark.json` up to and including the
2026-10-04 run, and the archived runs under `docs/judge-runs/`. They are left
byte-intact (the no-rewrite policy applies to published artifacts) but must not
be read as formatting sensitivity.

**Fix.** The probe now collapses runs of whitespace and folds newlines — the
invariance it always claimed to test — and changes 24/24 fixtures. Ported 1:1
to `src/lib/judgeInvariance.ts`.

**Why nothing caught it.** No test asserted that the probes *do* anything; they
were only tested for how their results are *scored*. A probe that measures
nothing is not a weak probe, it is a mislabelled one, and it corrupts the
record it writes. `scripts/lib/judge-transforms.test.mjs` now asserts that no
probe is inert across the pack, and that the whitespace probe reflows every
transcript without altering its words.

**Consequence for open work.** The registered study
`grounding-two-pass-whitespace` targeted this probe and was withdrawn
unexecuted — a baseline of 0.667 was sampling noise, so it could not support a
verdict. It is replaced by `grounding-two-pass-verbosity`, which targets
verbosity stability (measured 0.200 against a 0.95 gate), the largest genuine
invariance failure on the pack.

## Erratum 2026-10-05 — whitespace study withdrawn; verbosity study registered

The study `grounding-two-pass-whitespace` was registered but not executed, and
is withdrawn: its target metric was meaningless under erratum 2026-10-05
above. A replacement pre-registration, `grounding-two-pass-verbosity`, is
sealed in place. It targets the largest genuine invariance gap (verbosity
stability 0.200 vs a 0.95 gate). No verdict changes as a result — both
studies were unexecuted and therefore inconclusive by construction.
