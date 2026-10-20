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

## Erratum 2026-10-17 — the live transform port drifted from the offline library

**What was wrong.** `scripts/lib/judge-transforms.mjs` claimed "ported 1:1 from
`src/lib/judgeInvariance.ts`" in its head comment, but the port had silently
diverged in four places. The offline library (canonical, unit-tested) and the
live benchmark were measuring different rewrites:

| transform | offline (`judgeInvariance.ts`) | live port (before this fix) | live-measured under |
|---|---|---|---|
| `sophisticateWording` | rewrites `but→however,` and `so→consequently,` too | kept only the first four swaps | `style-fancy` |
| `addConfidentTone` | appends " This is absolutely certain **and leaves no doubt**." | truncated suffix | `confident-tone` |
| `swapPrestige` | known-source regex includes `Stanford HAI` | missing → a fixture citing Stanford HAI took the fall-back branch (appended citation instead of a replaced source) | `prestige` |
| `deflateVerbosity` | also strips " arguably" | missing that one `replaceAll` | nothing live (no `PROBES` id wires it) |

**Why it mattered.** Two of the four transforms sit inside measured live probes:
every live `stability["style-fancy"]`, `stability["confident-tone"]` and
`stability["prestige"]` value published **before 2026-10-17** was measured under
the drifted rewrite — a different transcript reached the judge than the offline
library's name for the transform implies. Unlike the inert-whitespace case the
probes still perturbed the pack and the numbers are honest flip-rate
measurements of whatever rewrite that commit shipped, so they are not
meaningless — but per-probe values do **not** compare cleanly across this date:
the boundary mixes two different transforms under one probe id. Trend read
across the boundary is confounded; same-side comparison is fine.
`deflateVerbosity` affected no live number (the live `PROBES` list never wired
it); it only made the two libraries disagree about what a deflation does.

**Affected record.** `docs/latest-judge-benchmark.json` up to and including the
2026-10-12 run, the `style-fancy` / `confident-tone` / `prestige` columns of
`docs/judge-leaderboard.md`, and archived runs under `docs/judge-runs/` — left
byte-intact per the no-rewrite policy.

**Fix.** The live file is ported 1:1 again (TS remains canonical), and the
parity is now **enforced, not claimed**:
`src/lib/judgeTransformParity.test.ts` imports both implementations and fails
on any byte difference over the whole 24-fixture pack plus branch-exercising
hand transcripts, including assertions that the live `PROBES` and
`AUDIT_TRANSFORMS` entries wire the same functions their offline names do.

**Why nothing caught it.** Both sides had their own tests — the offline suite
tested the offline library, the live suite tested that probes *do* something —
but nothing compared the two implementations to each other. A port is an
implementation, not a comment; the parity contract now lives in the test suite
so the next rename or added transform must update both sides consciously.

## Erratum 2026-10-17 — `ensemble-two-model-agreement` registration text updated before any seal

**What changed.** The arm is now implemented
(`scripts/lib/judge-providers.mjs`, `makeEnsembleJudge`): exactly two provider
legs judge the SAME transcript with the byte-identical shipped v5 prompt, each
leg keeping its own full chain + retry policy; the ensemble verdict is
deterministic — mean scores, the production tie rule on the MEAN gap, mean
confidence halved (`ENSEMBLE_DISAGREEMENT_DISCOUNT = 0.5`) when the legs
disagree on the winner — and a failed leg fails the fixture (the surviving
leg's verdict is never served as "the ensemble").

**Registration text edits (pre-first-seal).** To match reality: the stale
"Arm is implementation-pending; validator refuses execution until it exists"
sentence and the `executionStatus` clause claiming the arm is unimplemented
were replaced; `providerNote`'s "separate model families" claim was corrected
to what the registered legs actually are (unorouter + openrouter, distinct
providers, distinct model sizes within the same nemotron-3 family — family
independence is partial and the study measures it). No structured, executable
field changed: arms, `models`, `runsPerArm`, `minimumUsableReliability`,
target/protected thresholds and `adoptionRule` are byte-identical to before.

**Authority.** No study of this registration had ever been sealed or executed
when the text changed, so no prior snapshot's hash is invalidated; the
first-ever seal of this registration is canonical hash `5e85f07ca84de6bd`
(observed during runner verification, 2026-10-17 — the run itself stayed
resumable and inconclusive on its capacity/probe gates, as designed).

**Validator consequences.** The disk-sweep test no longer assumes every
BLOCKED registration carries an unimplemented arm: an unimplemented arm
remains the only permitted validation failure, but capacity-blocked
registrations with implemented arms now validate structurally (the runner's
own capacity gate still refuses to execute without a declared budget).

## Erratum 2026-10-17 — direct CLI invocations guarded by URL-string comparisons were silent no-ops on Windows paths containing spaces

**What was wrong.** Three scripts guarded their CLI body by comparing
`process.argv[1]` against a string derived from `import.meta.url`:

- `scripts/quota-probe.mjs` and `scripts/judge-capacity.mjs` compared
  `path.resolve(argv[1])` against a URL `pathname` that still carries
  `%20`-encoding;
- `scripts/topic-run-evidence.mjs` built its own `file://` template by
  replacing backslashes — a template that can never match a percent-encoded
  absolute path (a space in the checkout path) *or* a Windows drive letter
  (`file://C:/...` lacks the required third slash).

In each case the guard mismatched, nothing ran, no output was printed, and
the script exited **0**: `node scripts/quota-probe.mjs` printed nothing
instead of probing, `node scripts/judge-capacity.mjs --registration X
--budget-calls N` exited 0 without printing a decision (any operator reading
"exit 0" was told nothing at all), and `node scripts/topic-run-evidence.mjs`
wrote no evidence file. Studies were never affected: `judge-study.mjs`
imports `estimateCapacity` directly, and the topic pipeline runs the
evidence script on Linux runners where all three guards happened to match.

**Fix.** All three guards now use `fileURLToPath(import.meta.url)` (the
URL→path API that decodes percent-encoding), each behind
`path.resolve` on both sides. The probe was additionally refactored into
`runQuotaProbe` (unit-tested in `scripts/lib/quota-probe.test.mjs`) and
multi-label aware: an arm naming several providers ("unorouter,openrouter")
probes EVERY named provider and fails on the first dead leg — a probe miss
for a named provider is NO-KEY, never a fallback to a different provider's
judge. `topic-run-evidence` gained a spawn-based regression test
(`scripts/lib/topic-run-evidence.test.mjs`) that runs the real CLI in this
checkout and fails when the body again produces no output; verified to catch
the bug by temporarily reverting the guard.

**Why nothing caught it.** CI runs on Linux paths without spaces, where the
legacy guards worked; the local checkout path contains a space. The probe's
CLI output is only read by the study runner (which had always seen it work),
the capacity CLI had no test, and the evidence script's local CLI path was
only ever exercised by operators who had no test pinning the script contract.

## Erratum 2026-10-18 — a registration on a removed provider validated as READY

**What was wrong.** `pinned-paid-judge-default.json` (pre-registered 2026-10-06)
pins its candidate arm to the paid `anthropic claude-sonnet-5` judge. PR #135
removed the paid Anthropic transport entirely — there is no `anthropic` entry in
`scripts/lib/judge-providers.mjs` — but the registration kept naming it, and
`validateRegistration` had no opinion about whether the provider labels an arm
names actually exist. It returned `ok: true` with no errors and no warnings,
and the file still advertised:

> `executionStatus: "READY - both arms implemented (anthropic judge selectable via --models anthropic …)"`

Both halves of that sentence had become false. Measured on the current tree:

| step | result |
|---|---|
| `validateRegistration(reg, { experiments })` | `ok: true`, `errors: []`, `warnings: []` |
| `node scripts/quota-probe.mjs anthropic` (what the runner gates the arm on) | `NO-KEY anthropic`, exit 3 |
| `node scripts/judge-benchmark.mjs --models anthropic` | `matched no configured provider`, exit 2 |

**Why it mattered.** The study was unrunnable by construction, and the record
said otherwise. `judge-study.mjs` probes before every arm, so the failure mode
is safe — the probe fails, `stoppedEarly` is set, the study stops cleanly and
stays resumable, and no calls are burned — but "safe" is not "honest": the
registration advertised READY, and nothing in the validator, the runner or the
test suite contradicted it. An operator reading `executionStatus` would have
believed the study was executable and waited for a verdict that could never
arrive. This is the same defect class as the inert whitespace probe: a record
that describes work the system cannot actually do.

**Why nothing caught it.** The disk-sweep test asserted that every registration
file *validates*, and it did — validation simply never looked at provider
identity. `--models` matching nothing is a runtime condition, so only a live
run would reveal it, and a live run was never made (no study directory, no
`registration-snapshot.json`: the file was never sealed).

**Fix.** `validateRegistration` now resolves every provider label named by
`models` and by each arm's own `models` against the live `PROVIDERS` registry,
and refuses a registration naming a transport that does not exist:

```
arms.candidate.models names unknown provider "anthropic" (known: nvidia,
openrouter, unorouter, groq, cerebras, gemini, kiraai); an arm on a removed
provider can never be probed or benchmarked
```

Comma-separated ensemble labels are checked individually, so the registered
ensemble arm (`unorouter,openrouter`) still validates. `knownProviderLabels()`
is exported so tests assert against the registry rather than a copied list.

**Reconciliation.** The registration is marked `status: "withdrawn"` with a
`withdrawalReason`, not silently edited to a free provider: swapping the judge
provider IS the registered single variable, so substituting one would be a new
study, not an edit (same reasoning as the whitespace withdrawal above). Its
structured fields are otherwise byte-intact for history. Nothing is invalidated
by this: no study of it was ever sealed or executed, so no snapshot hash
depends on its contents.

**Validator consequence.** A `withdrawn` registration is exempt from execution
validation — the defect that withdrew it may itself be a validation error —
but must carry a substantive `withdrawalReason` (>= 40 chars), and every
non-withdrawn registration still must validate. `scripts/lib/judge-registration.test.mjs`
asserts both, and that no known registry label is ever rejected.

**Superseded in part by erratum 2026-10-20 below**, which tightens this
exemption: a withdrawn registration is now refused by the validator and by the
runner, and the disk-sweep test holds it to a stricter standard rather than
skipping it.

## Erratum 2026-10-20 — a withdrawn registration could still be sealed and planned

**What was wrong.** The erratum above introduced a `withdrawn` status as the
honest way to retire `pinned-paid-judge-default`, and exempted withdrawn
registrations from execution validation (the defect that withdrew a study may
itself be a validation failure). But that exemption was the **only** place a
registration could dodge validation, and nothing actually stopped a withdrawn
study from being RUN:

- `validateRegistration` never looked at `status` at all;
- `judge-study.mjs` never looked at `status` at all.

Measured on the tree before the fix, using a withdrawn copy of a *healthy*
registration (every other field valid, so nothing but the marker differed):

```
validateRegistration(reg, { experiments })  -> ok: true, errors: []
node scripts/judge-study.mjs --registration <that file> --budget-calls 100000
  -> exit 0
  -> "sealed registration grounding-two-pass-verbosity canonical hash=6257be1db2f98cb3"
  -> "resume counts: baseline=0 candidate=0; plan=baseline,candidate,baseline,candidate"
  -> "STOPPING: provider probe failed before arm baseline"
```

The runner **sealed** the withdrawn registration, created a study directory and
a `registration-snapshot.json`, planned four arm runs, and never once mentioned
the withdrawal. The only thing that stopped it was the provider probe — the
same probe that would have failed for an unrelated reason, so the withdrawal
was invisible in the output. The study directory that remained looked exactly
like real evidence for a study nobody was running.

**Why it mattered.** A withdrawal is a statement that a study is NOT running.
If the tooling can still seal, plan and (once the provider is healthy) execute
one, the withdrawal is decorative, and the record disagrees with the system —
the same defect class as an inert probe. It also makes the exemption
dangerous: a registration could be marked withdrawn to escape validation, and
the escape hatch would double as a way to *run* something that should be inert.

**Fix.** Two independent guards, because either alone is insufficient:

1. `validateRegistration` now reports `withdrawn: true` and **refuses** a
   withdrawn registration ("registration is WITHDRAWN - it is a historical
   record and must never be sealed or executed"), and requires a substantive
   `withdrawalReason` (>= 40 chars) — a withdrawal without a stated reason is
   not an honest withdrawal.
2. `judge-study.mjs` refuses a withdrawn registration **before it creates
   anything** — no study dir, no seal, no snapshot, no calls — and names the
   recorded reason in the refusal.

The disk-sweep test was also tightened: a withdrawn registration is now held to
a **stricter** standard than a live one, not a looser one. It must state why,
it must be refused by the validator, it must fail ONLY for its own withdrawal
reasons (an unknown provider, an unimplemented arm, a missing reason) — so a
withdrawal cannot become a hiding place for an otherwise broken record — and
every other field, including the byte-exact `adoptionRule` prose, must still
hold.

**Why nothing caught it.** The exemption was introduced one erratum earlier
and was never exercised: no test ran a withdrawn registration through the real
runner, and the validator had no concept of withdrawal to assert against. The
new regression test spawns the real `scripts/judge-study.mjs` against a
withdrawn copy of a healthy registration and asserts exit 2, an explicit
withdrawal message, and that no study directory, seal or plan was produced.
Both guards were proven non-vacuous by removing them one at a time and
watching the test fail.

**Nothing else is invalidated.** No study of any withdrawn registration was
ever sealed or executed, so no snapshot hash or published verdict depends on
this.

## Erratum 2026-10-05 — whitespace study withdrawn; verbosity study registered

The study `grounding-two-pass-whitespace` was registered but not executed, and
is withdrawn: its target metric was meaningless under erratum 2026-10-05
above. A replacement pre-registration, `grounding-two-pass-verbosity`, is
sealed in place. It targets the largest genuine invariance gap (verbosity
stability 0.200 vs a 0.95 gate). No verdict changes as a result — both
studies were unexecuted and therefore inconclusive by construction.
