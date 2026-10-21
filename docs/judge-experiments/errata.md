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

**Correction (2026-10-20).** The window above was stated as "before 2026-10-05",
which is the date the *erratum* was written, not the date the *fix* landed. The
fix reached `main` in commit `6c7227e` on **2026-10-16**, so every run
published between those two dates also used the inert probe — including the
**2026-10-12** run, whose `whitespace` 0.500 was endpoint nondeterminism rather
than formatting sensitivity. The affected window is therefore **every whitespace
value published before 2026-10-16**, i.e. through and including the 2026-10-12
artifact. The first run on `main` whose whitespace value is a real measurement
is the 2026-10-19 one — and it reports **INSUFFICIENT DATA** (no model produced
enough usable responses to measure it), which is the honest state, not a
regression.

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

## Erratum 2026-10-20 — the registered transport was retired; the throttle counted the wrong thing

Two independent defects surfaced together when the CI study workflow was
dispatched for real on 2026-10-20. Both concern the TRANSPORT, and both had
been silently mis-scored as judge quality.

**Defect 1: the throttle paced judge CALLS, not provider REQUESTS.**
`--pace-ms` was applied once per judge call. But one judge call can issue
several HTTP requests: the chain walks each model in turn (a retired model
answers 404 and the walk continues) and each model may be retried on a
transport error. With a three-model chain the real request rate was several
times the configured ceiling, so the provider answered 429 — and 429 was
recorded as a judge-quality failure. The fix moves the gate inside `chat()`,
immediately before each `fetch`, so it counts exactly the requests the
provider sees. The gate stays process-global and provider-agnostic: one shared
account is one shared budget, and the study runs one provider at a time.
`scripts/lib/judge-request-gate.test.mjs` pins this, and was proven
non-vacuous by removing the gate and watching the tests fail.

**Defect 2: unorouter's registered model was retired upstream.**
The live quota probe on 2026-10-20 showed `nemotron-3.5-lightning:free`
answering **404 model_not_found** — the slug was withdrawn from the
provider's catalogue, the same failure mode that killed the kiraai slugs on
2026-09-15. The chain walked past it to `nemotron-3-super-120b-a12b:free` and
`nemotron-3-ultra-550b-a55b:free`, both of which answered **429**: the free
tier allows 5 requests per minute. `config/ai-providers.json` still listed
the dead slug as unorouter's `defaultModel`, so the app's own production
chain was burning a request on a model that cannot answer. The slug is
demoted to last in the chain rather than deleted, so it costs nothing if the
provider restores it and is skipped entirely while it is dead.

**What this invalidates.** The registration `grounding-two-pass-verbosity`
named `nemotron-3.5-lightning:free` in its `singleVariable`, and its whole
design rests on a 0.200 verbosity-stability baseline measured on that
transport. That transport no longer serves the model, so the study could
never have measured what it was registered to measure. It is **withdrawn,
unexecuted**, with a substantive withdrawal reason; it was never sealed under
its new status and produced no verdict. The QUESTION is not withdrawn: it is
re-registered as `grounding-two-pass-verbosity-v2` against cerebras, the only
transport that answered a live probe on 2026-10-20, with the same arms, the
same fixtures, the same gates, the same protected caps, the same adoption
rule and the same threshold — only the transport changes, and the baseline is
now measured inside the study, so the comparison is internally controlled.

**Why cerebras.** On 2026-10-20 a live probe found cerebras the only provider
answering (`PROBE-OK`); openrouter answered a 429 `free-models-per-day` cap
(a daily cap, not a per-minute one); groq, gemini and nvidia have no keys
configured in this repository at all. The 2026-10-19 artifact independently
shows cerebras's failures were **150 rate-limits and zero judge-quality
errors** — a transport fact. cerebras is also a single-model chain, so both
arms necessarily run the same model.

**Nothing else is invalidated.** No verdict depended on any of this: the
withdrawn registration was never executed, and the 2026-10-19 artifact's
"no usable measurement" verdicts were already the honest outcome for the
same underlying reason (rate-limits, not judge defects).

## Erratum 2026-10-21 — the first real judge measurement, and three more instrument defects

The v2 study was dispatched in CI on 2026-10-21 and **produced the first genuinely
measurable judge data this repository has ever had**. It also exposed three more
defects, all of them in the instrumentation rather than in the judge.

### The baseline arm measured something real

`cerebras:gpt-oss-120b`, 312 calls, **provider reliability 0.983** (295/300, gate
min 0.75 — PASS), and **every one of the nine invariance probes became measurable**
(22–23 usable samples each, against a minimum of 12). For comparison, on
2026-10-19 every one of those gates read INSUFFICIENT DATA. The stability values
measured, all FAILING their gates:

| probe | stability | gate | verdict |
|---|---|---|---|
| position swap | 0.652 | min 0.97 | FAIL |
| names removed | 0.565 | min 0.97 | FAIL |
| verbosity inflated | 0.636 | min 0.95 | FAIL |
| style: sophisticated wording | 0.609 | min 0.95 | FAIL |
| confidence hedged | 0.565 | flip max 0.25 | FAIL |
| confident tone added | 0.609 | flip max 0.25 | FAIL |
| source prestige swapped | 0.565 | min 0.95 | FAIL |
| whitespace normalised | 0.696 | min 0.98 | FAIL |
| fake citation injected | 0.826 | influence max 0.05 | FAIL |

plus fixture-label agreement 0.522 (n=23, min 0.75) and ECE 0.25 (max 0.08). Both
FAIL. **This is a measurement, not a verdict**: the candidate arm never ran, so the
study is still INCONCLUSIVE and the architecture question is still open. But it
establishes that the instrument works and that the judge, on a live transport, is
still close to a coin flip on most invariances — 36% of verdicts flip when a
sentence of pure emphasis is appended, 35% when the players are swapped.

### Defect 3: the free tier's ceiling can be per HOUR, not per minute

The study stopped after the baseline arm with `STOPPING: provider probe failed
before arm candidate`, and the probe's own detail is the finding:

```
429: {"message":"Requests per hour limit exceeded - too many requests sent."}
```

**cerebras caps at roughly 300 requests per HOUR**, not per minute. The study was
paced at 12000 ms per request, which is exactly 300 requests/hour — so the run sat
precisely on the ceiling and the hour rollover answered 429. The baseline arm
itself had already consumed 312 calls in 59.8 minutes (313/hour).

Two lessons, and the first is the general one:

1. **A free tier's rate ceiling is not a single number, and "requests per minute"
   is only one shape of it.** The throttle must sit comfortably UNDER the ceiling
   that actually applies, whatever its window. A pace that exactly equals the
   ceiling has zero headroom and fails at the boundary — which is the worst
   possible place to fail, because it fails *after* the expensive calls have been
   spent. The default pace is now 15000 ms (240/hour, 80% of the observed cap).
2. **The failure lands in the wrong place.** The arm's own calls were the last
   ones to be admitted; the 429 landed on the *probe* that runs before the next
   arm. So the study blamed the transport for a budget that the transport had
   already spent, and stopped. The arm that had just measured the judge was
   nearly thrown away with it.

**The window was never read — it was guessed.** The probe printed the provider's raw
429 body and left the window to be inferred later, and the three providers this
repository actually uses disagree about it:

| provider | verbatim error body | window |
|---|---|---|
| cerebras | `Requests per hour limit exceeded - too many requests sent.` | **hour** |
| unorouter | `The free tier allows 5 request(s) every 1 min per account` | **minute** |
| openrouter | `Rate limit exceeded: free-models-per-day.` | **day** |

`scripts/lib/rate-limit.mjs` now classifies a 429 body into its window, the ceiling
when the provider states it, and the minimum pace that stays under that ceiling, and
`scripts/quota-probe.mjs` states it in the `PROBE-FAIL` line
(`limit=window=hour limit=240 (default) pace>=15000ms`). The pace is now *derived*
rather than guessed. Two things it deliberately does not do: it never recommends a pace
that exactly equals a ceiling, and it never invents a window it cannot find — a daily
ceiling is reported as "no pace can satisfy it", because recommending a pace that cannot
work would be worse than saying so.

### Defect 4: the second dispatch could not have saved its state

The persistence step did `git checkout -B "$branch"` with no start point, which
resets the branch to the current HEAD — **main**. The first dispatch pushed a
commit whose parent was main, so a second dispatch would have committed on top
of a *different* main commit and tried to push a **non-fast-forward**, which
GitHub rejects. The result: the second dispatch would have measured the whole
candidate arm and then lost every run of it, and the study could never have
reached a verdict. The study is resumable **by design**; this defect made the
resume path untested and, on the first real use, broken. The step now builds on
`origin/$branch` when the branch exists.

### Defect 5: the v2 study wrote into the v1 study directory

The workflow's `study_dir` default still named the withdrawn v1 study
(`docs/judge-runs/study-grounding-two-pass-verbosity`), so the v2 study wrote its
seal and its baseline run into the v1 directory. The two studies then shared one
directory on two different branches, each with its own `registration-snapshot.json`
— a genuine collision waiting to be misread as drift. The default is now
`.../study-grounding-two-pass-verbosity-v2`.

**What this invalidates.** Nothing published. The v2 study has no verdict: the
candidate arm never ran, so the verdict is INCONCLUSIVE by construction, and the
registration was correctly NOT written back (the runner's `stoppedEarly` guard
held). The baseline arm's data is preserved raw on the runs branch and is
excluded from any inference, exactly as the protocol requires for an incomplete
plan. **No gate was loosened and no threshold was touched to produce these
numbers** — they are measurements that FAIL, which is the point of measuring.

### Defect 7: the weekly benchmark never turned the request gate on

Found while fixing the study, and it is the same defect as #1 in a different place.

The request gate added on 2026-10-21 sits inside `chat()`, immediately before each
`fetch`, and it counts exactly the requests a provider receives. It is enabled by
`--pace-ms`, and **`--pace-ms` defaults to 0, which disables the gate entirely.**

The weekly `judge-benchmark` workflow ran:

```yaml
run: node scripts/judge-benchmark.mjs --concurrency 3 --enforce
```

— no `--pace-ms`, so the gate was **off** for every weekly run. The real request
rate ran several times over the free tier's ceiling, the provider answered **429**,
and a 429 lands in the reliability **denominator** — so it was scored as a
**judge-quality failure**.

**This is what the 2026-10-19 artifact actually was.** It recorded cerebras at
provider reliability **0.219** with **150 rate-limits and zero judge-quality
errors**, and every model failing the reliability floor (cerebras 0.219, openrouter
0.244, unorouter 0.000, kiraai 0.000). Those numbers were a measurement of the
**rate limiter**, published in a column that reads as judge quality — which is
precisely why the erratum had to say "the 2026-10-19 record shows free-tier
availability, not judge quality". Now the cause is fixed at the source rather than
explained away after the fact.

The weekly run now passes `--pace-ms 15000` (240 requests/hour, 80% of the ~300/hour
ceiling that **both** paceable free tiers use — unorouter at 5/minute is 300/hour,
cerebras at ~300/hour). A paced full pack across the three providers this repository
has keys for is ~936 requests, i.e. ~4 hours of wall-clock, so the job's
`timeout-minutes` is now explicit at 350 — under GitHub's 6-hour ceiling and above
the paced runtime, because a job killed at the default timeout publishes **nothing**.

`scripts/lib/judge-benchmark-workflow.test.mjs` states the invariant over the
workflows rather than over one file: **any workflow that runs the live judge
benchmark must pace provider requests.** A new workflow cannot silently skip it.

**What this invalidates.** The 2026-10-19 artifact's *provider reliability* column is
now explained rather than merely annotated, and it should be read as a rate-limit
record. Its quality columns remain valid. The 2026-10-21 cerebras baseline in this
erratum is the first reliability figure in the repository that was measured with the
gate on, and it read **0.983** — against 0.219 for the same provider two days
earlier. That gap is the size of this defect.

## Erratum 2026-10-21 — the candidate arm ran, and the pace was still the wrong instrument

### The candidate arm completed and was EXCLUDED

The second dispatch of the v2 study (run `39643927833`, `pace_ms=15000`,
`concurrency=1`) ran the **candidate** arm to completion and exited 0. The study
remains **INCONCLUSIVE**, because the candidate arm did not clear the registered
reliability floor:

```
reliability 0.519 < registered minimum 0.75
usable runs baseline 1/2, candidate 0/2
```

The raw run is preserved at
`docs/judge-runs/study-grounding-two-pass-verbosity-v2/runs-candidate/2026-10-21T193929911Z-cerebras.json`
on branch `runs/study-grounding-two-pass-verbosity-v2`. **It is excluded from
inference** — the protocol says excluded runs stay in the raw evidence and never in
inference, so nothing below is a result about the architecture.

Its error mix: **117 rate-limits**, 48 `no-base` cascades (a probe whose base call
failed), 8 malformed model JSON, 2 truncated responses. Every gate, probe, resume
and persistence path worked; the failure was transport.

### Defect 8: the request rate was never the whole story — the ceiling was inferred, not read

Two numbers from the same day, same provider, same account, cannot both be explained
by a request-rate cap:

| arm | requests | duration | rate | rejected |
|---|---|---|---|---|
| baseline (single pass) | 300 | 59.8 min | **300/hour** | **3** |
| candidate (two passes) | 528 | 131.8 min | **240/hour** | **117** (22%) |

The candidate ran at a **lower** rate and lost **22%** of its requests; the baseline
ran at a **higher** rate and lost **1%**. Token rates do not reconcile it either —
the candidate used **119,000 tokens/hour** against the baseline's **209,000**.

The candidate really was paced evenly: the run log's per-phase ticks show 312 calls
in 131.8 minutes (**25.3s per call**), and the fast segments are explained by
`no-base` short-circuits — a fixture whose base call failed has its 12 probe and
audit calls skip their request — not by bursts. The request gate did its job.

**So the ceiling is not a plain requests-per-hour count, and the pace had been
derived from a ceiling *inferred* from a prose error message.** The provider states
its ceiling itself, in two places that were not being read:

- the **structured error code** — cerebras's body carries `"code":"requests_per_hour"`,
  which names the window outright and survives the prose being truncated;
- the **rate-limit response headers** — the limit, the remaining count and the reset.

**The fix (PR #201).** `chat()` carries the rate-limit headers on the error it
throws. `classifyRateLimit()` reads the *window* from the code or the prose and the
*magnitude* from the headers, and the quota probe prints both. The benchmark keeps
the headers on each failed row and the run artifact records them, so an arm that
hits the ceiling now **states** it instead of leaving the next run to infer it.

A provider that names no window is still reported as `unknown` rather than assumed,
and a per-day ceiling is still reported as unpaceable, because no request rate
avoids it.

**What this invalidates.** Nothing published. The v2 study has no verdict, and the
registered reliability floor was **not** lowered to rescue the arm. The candidate
arm's raw numbers — verbosity stability 0.615 against the baseline's 0.636, style
0.786, prestige 0.846, position 0.500, fake-citation influence 0.385 — are **not**
evidence about two-pass grounding and must not be quoted as such. If that run had
been usable, the registered target (verbosity stability **+0.2** over the in-study
baseline, i.e. 0.636 → 0.836) would have been **missed** and the verdict would have
been **rejected**. It was not usable, so the verdict is **inconclusive** — a verdict
about the transport, not about the architecture.

**Why the excluded run still matters.** The fake-citation influence *rising* under an
evidence-grounding architecture is the opposite of what that architecture is for, and
it is worth a usable run before anyone concludes anything about grounding. Getting
one needs a pace derived from the provider's stated ceiling — which is now
readable — and enough wall-clock per arm, since the two-pass arm issues roughly
twice the requests of the single-pass arm.


