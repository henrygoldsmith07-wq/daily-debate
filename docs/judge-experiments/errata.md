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
