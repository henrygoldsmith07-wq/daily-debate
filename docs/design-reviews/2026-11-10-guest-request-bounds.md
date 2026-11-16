# 2026-11-10 — public guest request bounds

Local branch feat/guest-first-practice, HEAD daf32c7, expected Daily Debate origin. Read AGENTS.md, README, full tracked diff, all three existing design-review notes and recent commits. History search returned prior outcomes; history_read returned unavailable, so used supplied transcript and local records. Existing onboarding, recovery and grounding work preserved. fix/guest-final-round-recovery points at the same HEAD; hydration gate already implemented (server snapshot false, client restore only after hydration), not re-reported as unresolved. No overlapping Daily Debate server identified.

## Implemented — medium impact, high confidence, small scope

Public guest turn prepare previously called request.json() before transcript validation and rate limiting. The six-message / 2,000-character limits therefore did not bound allocation or parsing of arbitrary request bodies. Added an 80,000-byte pre-parse cap, enforced against declared length and actual streamed bytes. The valid maximal transcript fits even using six-byte JSON escapes (72,000 bytes plus structure). Missing/false Content-Length cannot bypass streamed counting. Oversize returns 413; malformed JSON returns 400, both no-store, before provider/limiter work. Existing unavailable-provider path still returns guided fallback before consuming the body.

Extracted the existing repair body reader to src/lib/readBoundedJson.ts:2 and reused it. Authenticated repair keeps its exact 8,192-byte cap and error behavior; no scoring, authorization, provider or benchmark gates changed. Evidence: src/app/api/guest/turn/route.ts:41,65-70; src/app/api/solo/[debateId]/repair/route.ts:14,181-183.

## Verification and limits

Full lint with zero warnings, TypeScript, production build (38 static pages) and git diff --check passed. No automated tests added or run. Source-reviewed chunk counting, early cancellation, invalid JSON, absent body and oversized declared length. Runtime HTTP rejection, provider-enabled requests, desktop/mobile browser, account flow and limiter outages were not exercised this run; this is a source-established failure and compiled fix, not runtime security validation. Prior hydration/reload walkthrough not repeated because its code is unchanged.

Build and TypeScript caches refreshed. No server started, no process left running by this run, no commits/push/deploy/secret or dependency changes. Initial Python edit failed before writes (Python unavailable); used PowerShell. Existing user work preserved. Remaining: manually verify enabled guest protocol boundaries and provider/limiter failures; scoring validity remains unresolved.
