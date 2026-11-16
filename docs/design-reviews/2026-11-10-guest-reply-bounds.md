# 2026-11-10 — guest opponent reply bounds

Local checkout daily-debate, branch feat/guest-first-practice, HEAD daf32c7, expected origin confirmed. Read repository AGENTS.md and README, tracked diff and recent commits; prior history search and local review records establish routine ownership of recovery, grounding and request-bound edits. history_read returned unavailable. Existing onboarding/user edits preserved. No overlapping Daily Debate node process found. Hydration gate already in HEAD; prior desktop/mobile reload walkthrough documented in the retest-recovery record, not repeated here.

## Implemented — medium impact, high confidence, low effort

Source-established protocol mismatch: aiSchema.ts:24-32 accepts opening replies up to 4,000 characters and turn replies up to 6,000. Guest history and stored live-state parsing accept only 2,000 per opponent reply (guestLive.ts). Previously GuestArena accepted any nonempty reply and persisted it. A 2,001-character schema-valid reply therefore broke subsequent history validation and invalidated the entire arena snapshot on reload, losing access to saved answers/repair state. This is established from caller/codec contracts, not a live-provider reproduction.

Added shared isGuestOpponentReply (src/lib/guestLive.ts:21). Guest route applies it to opening, JSON turn and final streamed result before success/milestone recording (src/app/api/guest/turn/route.ts:143,180,193,234). Oversized/empty output uses existing provider-error response. Client checks the same invariant before commit (src/components/GuestArena.tsx:1212). Does not truncate an objection and risk changing what the learner answers. Existing recovery behavior: opening uses guided practice, intermediate failure retains answers and offers retry/guided continuation, retest-generation failure uses its existing generic objection. A valid reply is trimmed before committing and fits both transcript and restore contracts. Streamed provisional text may appear before final validation but is not committed. Existing already-invalid oversized snapshots are not migrated by this prevention fix.

## Verification and limitations

Full lint (zero warnings), type checking, production build (38 static pages) and git diff --check passed. No automated tests added or run. No browser, desktop/mobile, enabled-provider failure injection, account flow, back/forward or reload walkthrough this run. Those runtime paths remain unverified; the prior hydration fix was unchanged. Lexical scoring remains unvalidated. Next coverage should rotate to authenticated repair/provider interruption and persistence.

No server started or left running. Build/TypeScript caches refreshed. Wrote this append-only dated record and appended a Notion summary. Existing work preserved; no commits, pushes, deployments, secret or dependency changes.
