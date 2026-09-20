## Summary

Repairs the production topic-generation store path, fixes the operational-evidence null logging defect, adds provider/timestamp telemetry fidelity, and moves classifier judge-shortcutting into shadow-only mode behind preregistered adoption gates.

## Production blocker fixed

Every AI-generated topic failed the production write with `invalid input syntax for type json`, while the curated fallback stored fine. Cause: the Neon HTTP transport serialises a JS array as a Postgres array literal (`{a,b}`), which a `jsonb` column rejects. The fallback only ever succeeded because its `sources` was empty (`[]` -> `{}`, which happens to parse as JSON). `sources`/`checks` are now explicitly serialised and cast. Regression tests enforce real jsonb semantics and reproduce the exact production failure without the fix.

## Observability

- `Persist operational evidence` no longer reads nested `.generator.*` / `.freshness.*` paths that only exist in the assembled summary; the field mapping now lives in a tested module (`scripts/topic-run-evidence.mjs`).
- `runCreatedAt` and `runStartedAt` are kept distinct (queue delay vs scheduler delay); both resolved from the Actions run API.
- Telemetry separates **availability** (stored/fresh/before-03:00) from **generator result** (ai | fallback-after-provider-failure | fallback-by-policy | failure) from **provider health** (success | invalid-response | timeout | rate-limit | authentication | quota | other), so a green fallback run is not reported as provider health.
- Telemetry adapts to whichever columns exist, so it cannot break before the new migration is applied.
- Explicit `actions: read` permission.

## Provider resilience

Deterministic JSON repair for safe syntax defects only (smart quotes, trailing commas, stray control chars), always revalidated against the same schema. Per-model attempt telemetry with bucketed outcome and measured latency.

## Classifier shadow mode

The structural route previously short-circuited the ensemble and returned its own result as authoritative. It now runs alongside the ensemble and is retained as `shadowRouting` evidence only; the ensemble result is always what is returned. All judge-avoidance routes default to `shadow`, gates are preregistered and hash-sealed, and promotion to `eligible` is a separate deliberate act.

## Also fixed

`https://localhost/internal` (and private/link-local/dotless hosts) were accepted as evidence citations, letting a fake citation borrow a real source's authority. A single shared `isPublicEvidenceHost` rule now rejects them in both the deterministic graph and user-evidence validation.

## Verification

`lint`, `type-check`, 847 unit tests, and 67 script tests pass. Adds canonical-semantics invariants for `buildDeterministicArgumentGraph` (reusing `opportunity.ts` rules rather than restating them) and adversarial classifier cases asserting no classifier mistake can alter the production winner while routes remain shadow-only.

## Not yet proven

Real production idempotence, a subsequent scheduled run, and the before-03:00 deadline proof require real runs after this merges. Those remain outstanding.
