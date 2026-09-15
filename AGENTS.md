# Agent notes

## Git workflow (enforced by GitHub, not convention)

`main` is protected by repository ruleset `protect-main`: pull request required,
required checks `verify`, `e2e`, `topic-pipeline` (strict), no force push, no
deletion, **no bypass actors** (admins included). Direct `git push origin main`
fails with GH013 — always:

```text
git switch -c <type>/<topic> → commit → git push -u origin <branch>
→ open PR (REST or gh) → wait for verify+e2e+topic-pipeline green → merge (squash)
→ git checkout main && git pull --ff-only && git branch -d <branch>
```

The weekly judge-benchmark workflow follows the same path for its artifact
commits (chore branch → PR → merges only on green checks).

## Verification commands (the CI contract, run before pushing)

```text
npm run lint -- --max-warnings 100
npm run type-check
npm test
npm run test:scripts
npm run build
node scripts/check-corpus-invariants.mjs   # needs DATABASE_URL
```

Judge experiments: NEVER edit gate thresholds to make something pass;
pre-register (`docs/judge-experiments/registrations/`), then
`npm run benchmark:study -- --registration <file>`. Arms must run serialized
and interleaved - two arms against the same rate-limited provider at once
contaminate both (documented in docs/judge-runs/README.md). Model surveys:
`npm run benchmark:survey -- --provider <label> --models a,b`.

Real-Postgres DB suites (`*.db.test.ts`) auto-skip unless `TEST_DATABASE_URL`
and `DATABASE_URL` are set; CI runs them in the `e2e` job, including the corpus
closure-race and repair-race suites. Never convert those to mocks.

## Non-negotiables from the project's validation discipline

- Judge gate thresholds (`config/judge-gates.json`) never loosen; new gates
  may only tighten. `allPass=false` and `INSUFFICIENT DATA` are honest outputs,
  never to be hidden.
- Prompt changes go through the single-variable experiment protocol
  (`docs/validation.md` § "Judge improvement protocol"); no multi-rule stacking,
  no per-fixture tuning.
- Corpus ratings are append-once; corrections only via the admin route with a
  self-contained audit event.
