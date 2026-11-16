# 2026-11-10 — guest retest recovery

Branch: `feat/guest-first-practice`, HEAD `daf32c7`, expected Daily Debate origin. Existing onboarding changes in GuestArena.tsx/globals.css and the High Taste Apps note belong to the preceding user request and were preserved. No Daily Debate editor/server process was running when work began.

## Implemented

High confidence, medium impact: GuestRetest held its draft and submitted flag exclusively in child useState; the saved arena contained neither. Reloading the retest or returning to results and re-entering reset the attempt. Lifted both fields into the arena and persisted them in the existing same-tab session snapshot. The optional codec field preserves compatibility with older snapshots and bounds response length/validates submitted state. A changed repair and a fresh practice clear the old attempt. Feedback is recomputed from the restored writing and frozen challenge rather than trusting a saved verdict.

Evidence: src/components/GuestArena.tsx:64,81,856-878,926,937,1121,1157,1380-1388,1408; src/lib/guestLoop.ts:162,225-233,251. No scoring rules changed.

The earlier hydration repair is already in HEAD: storage access is gated until hydration, with persistence blocked for the server/first browser session. Production-browser reload of the final submitted round retained all three responses and See my result; result -> accepted repair -> retest remained available.

## Checks performed

- Full `npm.cmd run lint -- --max-warnings 0`: passed.
- `npm.cmd run type-check`: passed.
- `npm.cmd run build`: passed, 38 static pages generated.
- `git diff --check`: passed.
- Production browser at 1280x900: manually completed three guided rounds; reloaded the last submitted round; reached result; repaired; entered a retest draft; navigated/reloaded; draft retained. Back to result then re-enter retest retained the draft. Submitted and reloaded: feedback and Finish remained.
- Mobile at 390x844: reloaded submitted feedback, finished, reloaded completion: final state retained; no horizontal overflow measured. Browser diagnostics contained no hydration errors.
- Initial browser fill viewport had no clickable bounds; explicitly setting desktop viewport restored working interaction. Initial Python invocation was unavailable and PowerShell blocked npm.ps1; no edit occurred from that command. Used apply_patch and the normal Windows npm.cmd entry point without changing policy.
- No automated tests added or run. No account, provider-failure, blocked-storage, corrupt-cache, old-snapshot runtime or changed-repair reset runtime check. Back/forward history was not separately exercised. Older snapshot compatibility and reset paths were reviewed in source.
- Local production preview stopped; created browser tab closed. Build refreshed .next and TypeScript caches. Existing prior artifacts preserved. Nothing committed, pushed or deployed.

## New material finding for the next run

Scoring remains partial/unvalidated: the guided retest objection was about newer staff learning by observing colleagues. The submitted response instead answered service degradation and back-office service targets. The lexical checker still displayed Observed under pressure / Observed in a live debate: rebuttal. This is a concrete false-positive candidate plus inaccurate live-debate wording for guided mode; do not interpret the recovery walkthrough as evidence of transfer or learning. Next: inspect assessGuestRepair/assessGuestRetest and surrounding evidence checks before changing the rubric. No benchmark gates were altered.
